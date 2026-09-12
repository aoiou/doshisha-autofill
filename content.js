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

  // ストレージから設定を取得
  async function getSettings() {
    const defaultSettings = {
      username: '',
      autoSubmit: false,
      autoFido2: false,
      autoPasswordTab: false
    };
    try {
      const result = await chrome.storage.sync.get([
        'savedUsername',
        'autoSubmit',
        'autoFido2',
        'autoPasswordTab'
      ]);
      return {
        username: result.savedUsername || '',
        autoSubmit: !!result.autoSubmit,
        autoFido2: !!result.autoFido2,
        autoPasswordTab: !!result.autoPasswordTab
      };
    } catch (e) {
      // syncが使えない場合はlocalにフォールバック
      try {
        const localResult = await chrome.storage.local.get([
          'savedUsername',
          'autoSubmit',
          'autoFido2',
          'autoPasswordTab'
        ]);
        return {
          username: localResult.savedUsername || '',
          autoSubmit: !!localResult.autoSubmit,
          autoFido2: !!localResult.autoFido2,
          autoPasswordTab: !!localResult.autoPasswordTab
        };
      } catch (err) {
        console.error('[Doshisha Autofill] Failed to load settings:', err);
        return defaultSettings;
      }
    }
  }

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
    if (pwdFieldWrapper && !pwdFieldWrapper.classList.contains('move-off-screen')) {
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

  // 「次へ」ボタンを自動クリック
  let hasSubmitted = false;
  function clickNextButton() {
    if (hasSubmitted) return;

    const nextBtn = document.querySelector(SUBMIT_BUTTON_SELECTOR);
    const loginForm = document.querySelector('form#login');

    if (!nextBtn || !loginForm) return;

    // 既にStep 2（パスワード画面）に移行している場合はスキップ
    if (isStepTwo()) return;

    // ボタンが無効化されている場合はスキップ
    if (nextBtn.disabled) return;

    hasSubmitted = true;

    // イベント伝播とフォーム状態更新を待ってからクリック（150ms）
    setTimeout(() => {
      if (!isStepTwo() && !nextBtn.disabled) {
        nextBtn.click();
      }
    }, 150);
  }

  // 「パスワードレス認証」ボタンを自動クリック
  let hasFido2Clicked = false;
  async function attemptFido2Click(force = false) {
    if (hasFido2Clicked && !force) return;

    const settings = await getSettings();
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

    hasFido2Clicked = true;

    // 画面切り替えのアニメーションと初期化待ち（200ms）
    setTimeout(() => {
      if (fido2Btn.offsetParent !== null && !fido2Btn.disabled) {
        fido2Btn.click();
      }
    }, 200);
  }

  // 「パスワード」タブを自動選択（FIDO2画面よりパスワード入力を優先）
  let hasSwitchedToPasswordTab = false;
  async function attemptSwitchToPasswordTab(force = false) {
    if (hasSwitchedToPasswordTab && !force) return;

    const settings = await getSettings();
    if (!settings.autoPasswordTab && !force) return;

    if (!isStepTwo()) return;

    const passwordTab = document.querySelector(PASSWORD_TAB_SELECTOR);
    const formSelector = document.getElementById('login-form-selector');
    if (!passwordTab || !formSelector) return;

    // タブ選択バーが表示されており、かつまだパスワードタブがactiveでない場合
    if (formSelector.style.display !== 'none' && !passwordTab.classList.contains('active')) {
      hasSwitchedToPasswordTab = true;
      passwordTab.click();
    }
  }

  // パスワード入力欄へ自動フォーカス（標準機能）
  let hasFocusedPassword = false;
  function attemptFocusPassword(force = false) {
    if (hasFocusedPassword && !force) return;

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

    hasFocusedPassword = true;
    setTimeout(() => {
      if (pwdInput.offsetParent !== null && document.activeElement !== pwdInput) {
        pwdInput.focus();
      }
    }, 50);
  }

  // 入力処理（要素を探して入力）
  let isFilled = false;
  async function attemptAutofill(force = false, triggerSubmit = null) {
    const settings = await getSettings();
    const username = settings.username;
    const shouldSubmit = triggerSubmit !== null ? triggerSubmit : settings.autoSubmit;

    if (!username) {
      return false;
    }

    const input = document.querySelector(TARGET_SELECTOR);
    if (!input) {
      return false;
    }

    // 要素が非表示（Step 2のパスワード入力中など）の場合はスキップ（強制入力時を除く）
    if (!force && input.offsetParent === null) {
      return false;
    }

    // 既に手動入力されている、かつ強制上書きでない場合はスキップ
    if (!force && input.value && input.value !== username && document.activeElement === input) {
      return false;
    }

    const success = fillInputValue(input, username);
    if (success) {
      isFilled = true;
      if (shouldSubmit) {
        clickNextButton();
      }
    }
    return success;
  }

  function handleDomChanges() {
    attemptAutofill();
    attemptFido2Click();
    attemptSwitchToPasswordTab();
    attemptFocusPassword();
  }

  // DOM監視（動的レンダリング・遅延ロード・画面切り替え対応）
  let observer = null;
  function startObserver() {
    if (observer) return;

    // 初回チェック
    handleDomChanges();

    observer = new MutationObserver((mutations, obs) => {
      handleDomChanges();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-step']
    });

    // ページロードから30秒後に監視を停止（無駄な負荷防止）
    setTimeout(() => {
      if (observer && (hasFido2Clicked || (isFilled && isStepTwo()))) {
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
