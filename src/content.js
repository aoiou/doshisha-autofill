/**
 * Doshisha Autofill
 * Content script for automating login on doshisha.ex-tic.com
 */

(() => {
  'use strict';

  // /auth/* 以外のページでは実行しない（念のための二重チェック）
  if (!window.location.pathname.startsWith('/auth/')) {
    return;
  }

  // ターゲットとなるセレクタ（ログインフォーム内の可視テキスト入力欄）
  const TARGET_SELECTOR = 'form#login input#identifier[type="text"]';
  const SUBMIT_BUTTON_SELECTOR = 'form#login button[type="submit"]';
  const FIDO2_BUTTON_SELECTOR = 'form#fido2-form button[type="submit"]';
  const PASSWORD_TAB_SELECTOR = '#password-form-selector';

  // =====================================================================
  // ストレージヘルパー（sync → local フォールバック）
  // popup.js にも同一実装あり。コンテントスクリプトとポップアップは実行コンテキストが
  // 異なりモジュール共有不可のため、意図的な複製。
  // =====================================================================
  async function storageGet(keys) {
    try {
      return await browser.storage.sync.get(keys);
    } catch (e) {
      return await browser.storage.local.get(keys);
    }
  }

  // =====================================================================
  // 設定キャッシュ（IPC 通信を最小化）
  // =====================================================================
  const SETTINGS_KEYS = ['savedUsername', 'autoSubmit', 'autoFido2', 'autoPasswordTab'];
  const DEFAULT_SETTINGS = {
    savedUsername: '',
    autoSubmit: false,
    autoFido2: false,
    autoPasswordTab: false
  };

  let cachedSettings = null;

  function parseSettings(raw) {
    return {
      username: raw.savedUsername || '',
      autoSubmit: !!raw.autoSubmit,
      autoFido2: !!raw.autoFido2,
      autoPasswordTab: !!raw.autoPasswordTab
    };
  }

  // 初回のみストレージから読み込み、以降はキャッシュを返す
  async function getSettings() {
    if (cachedSettings) return cachedSettings;

    try {
      const result = await storageGet(SETTINGS_KEYS);
      cachedSettings = parseSettings(result);
    } catch (err) {
      console.error('[Doshisha Autofill] Failed to load settings:', err);
      cachedSettings = parseSettings(DEFAULT_SETTINGS);
    }
    return cachedSettings;
  }



  // =====================================================================
  // DOM ユーティリティ
  // =====================================================================

  // React/Vueなどのフレームワーク対応を含めてinputに値を設定・イベント発火
  function fillInputValue(inputElement, value) {
    if (!inputElement || !value) return false;

    // 現在の値と一致している場合は不要な発火を避ける
    if (inputElement.value === value) return true;

    // HTMLInputElementのネイティブプロトタイプsetterを取得
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(inputElement, value);
    } else {
      inputElement.value = value;
    }

    // フォームバリデーションやフレームワークの状態更新用イベントを発火
    inputElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inputElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    return true;
  }

  // Step 2（パスワード/FIDO2認証画面）に移行しているかをDOMから判定
  function isStepTwo() {
    const loginForm = document.querySelector('form#login');
    if (!loginForm) return false;

    // Extic.html は jQuery の .data('step', 'second') を使用しているため
    // HTML属性の data-step は更新されない。DOM要素の表示状態から確実に判定する。
    const idFieldWrapper = document.getElementById('identifier-field-wrapper');
    if (idFieldWrapper && idFieldWrapper.style.display === 'none') {
      return true;
    }

    const pwdFieldWrapper = document.getElementById('password-field-wrapper');
    const idInput = document.querySelector(TARGET_SELECTOR);
    if (pwdFieldWrapper && !pwdFieldWrapper.classList.contains('move-off-screen') &&
        idInput && idInput.offsetParent === null) {
      return true;
    }

    const idWrapper = document.getElementById('identifier-wrapper');
    if (idWrapper && idWrapper.style.display !== 'none' && idWrapper.textContent.trim() !== '') {
      return true;
    }

    const fido2Wrapper = document.getElementById('fido2-form-wrapper');
    if (fido2Wrapper && fido2Wrapper.style.display !== 'none') {
      return true;
    }

    return false;
  }

  // =====================================================================
  // 自動操作の状態管理
  // =====================================================================
  const state = {
    filled: false,
    submitted: false,
    fido2Clicked: false,
    switchedToPasswordTab: false,
    focusedPassword: false,
  };

  // 「次へ」ボタンを自動クリック
  function clickNextButton() {
    if (state.submitted) return;

    const nextBtn = document.querySelector(SUBMIT_BUTTON_SELECTOR);
    const loginForm = document.querySelector('form#login');

    if (!nextBtn || !loginForm) return;

    // 既にStep 2（パスワード画面）に移行している場合はスキップ
    if (isStepTwo()) return;

    // ボタンが無効化されている場合はスキップ
    if (nextBtn.disabled) return;

    state.submitted = true;

    // イベント伝播とフォーム状態更新を待ってからクリック（150ms）
    setTimeout(() => {
      if (!isStepTwo() && !nextBtn.disabled) {
        nextBtn.click();
      }
    }, 150);
  }

  // 「パスワードレス認証」ボタンを自動クリック
  function attemptFido2Click(settings, force = false) {
    if (state.fido2Clicked && !force) return;

    // パスワードタブ優先設定が有効な場合、またはFIDO2自動開始が無効な場合はスキップ
    if ((!settings.autoFido2 || settings.autoPasswordTab) && !force) return;

    const fido2Wrapper = document.getElementById('fido2-form-wrapper');
    const fido2Btn = document.querySelector(FIDO2_BUTTON_SELECTOR);

    if (!fido2Btn || !fido2Wrapper) return;

    // fido2-form-wrapper またはボタンが非表示の場合はスキップ
    if (fido2Wrapper.style.display === 'none' || fido2Btn.offsetParent === null) {
      return;
    }

    // ボタンが無効化されている場合はスキップ
    if (fido2Btn.disabled) return;

    // エラー・警告が表示されている場合は無限ループ防止のためスキップ
    const warning = document.querySelector('#fido2-form .warning, #fido2-unavailable');
    if (warning && warning.style.display !== 'none') {
      return;
    }

    state.fido2Clicked = true;

    // 画面切り替えのアニメーションと初期化待ち（200ms）
    setTimeout(() => {
      if (fido2Btn.offsetParent !== null && !fido2Btn.disabled) {
        fido2Btn.click();
      }
    }, 200);
  }

  // 「パスワード」タブを自動選択（FIDO2画面よりパスワード入力を優先）
  function attemptSwitchToPasswordTab(settings, force = false) {
    if (state.switchedToPasswordTab && !force) return;

    if (!settings.autoPasswordTab && !force) return;

    if (!isStepTwo()) return;

    const passwordTab = document.querySelector(PASSWORD_TAB_SELECTOR);
    const formSelector = document.getElementById('login-form-selector');
    if (!passwordTab || !formSelector) return;

    // タブ選択バーが表示されており、かつまだパスワードタブがactiveでない場合
    if (formSelector.style.display !== 'none' && !passwordTab.classList.contains('active')) {
      state.switchedToPasswordTab = true;
      passwordTab.click();
    }
  }

  // パスワード入力欄へ自動フォーカス（標準機能）
  function attemptFocusPassword(force = false) {
    if (state.focusedPassword && !force) return;

    if (!isStepTwo()) return;

    const pwdInput = document.getElementById('password');
    if (!pwdInput) return;

    const pwdWrapper = document.getElementById('password-field-wrapper');
    const loginForm = document.querySelector('form#login');

    // ログインフォーム自体が非表示（FIDO2タブ表示中など）の場合はフォーカスしない
    if (loginForm && loginForm.style.display === 'none') {
      return;
    }

    // パスワード入力エリアが画面外にある場合はフォーカスしない
    if (pwdWrapper && pwdWrapper.classList.contains('move-off-screen')) {
      return;
    }

    if (pwdInput.offsetParent === null) {
      return;
    }

    state.focusedPassword = true;
    setTimeout(() => {
      if (pwdInput.offsetParent !== null && document.activeElement !== pwdInput) {
        pwdInput.focus();
      }
    }, 50);
  }

  // 入力処理（要素を探して入力）
  async function attemptAutofill(settings) {
    if (state.filled) return false;

    const username = settings.username;
    if (!username) return false;

    const input = document.querySelector(TARGET_SELECTOR);
    if (!input) return false;

    // 要素が非表示（Step 2のパスワード入力中など）の場合はスキップ
    if (input.offsetParent === null) return false;

    // 既に手動入力されている場合はスキップ
    if (input.value && input.value !== username && document.activeElement === input) {
      return false;
    }

    const success = fillInputValue(input, username);
    if (success) {
      state.filled = true;
      if (settings.autoSubmit) {
        clickNextButton();
      }
    }
    return success;
  }

  // =====================================================================
  // MutationObserver と DOM 変更ハンドリング
  // =====================================================================

  let observer = null;

  // 全ての自動処理が完了したかを判定し、完了時に Observer を停止
  function checkAndStopObserver() {
    if (!observer) return;

    // Step 1: ユーザー名入力＋送信が完了 → Step 2 に遷移済み
    const step1Done = state.filled && isStepTwo();

    // Step 2: FIDO2 クリック済み、またはパスワードタブ切替＋フォーカス完了
    const step2Done = state.fido2Clicked ||
                      state.switchedToPasswordTab ||
                      state.focusedPassword;

    if (step1Done && step2Done) {
      observer.disconnect();
      observer = null;
    }
  }

  // debounce 用のタイマー ID
  let debounceTimer = null;

  async function handleDomChanges() {
    if (!observer) return;

    const settings = await getSettings();

    if (!state.filled) {
      await attemptAutofill(settings);
    }
    if (!state.fido2Clicked) {
      attemptFido2Click(settings);
    }
    if (!state.switchedToPasswordTab) {
      attemptSwitchToPasswordTab(settings);
    }
    if (!state.focusedPassword) {
      attemptFocusPassword();
    }

    // 全処理完了時に Observer を即時停止
    checkAndStopObserver();
  }

  // debounce でラップした DOM 変更ハンドラ
  function debouncedHandleDomChanges() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      handleDomChanges();
    }, 50);
  }

  // DOM監視（動的レンダリング・遅延ロード・画面切り替え対応）
  function startObserver() {
    if (observer) return;

    observer = new MutationObserver(() => {
      debouncedHandleDomChanges();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-step']
    });

    // 初回チェック（observer セットアップ後に実行）
    handleDomChanges();

    // 安全策: ページロードから30秒後に未停止なら強制停止
    setTimeout(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }, 30000);
  }

  // 初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();
