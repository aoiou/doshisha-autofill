/**
 * Doshisha Autofill
 * Content script for automating login on doshisha.ex-tic.com
 */

(() => {
  'use strict';

  // ターゲットとなるセレクタ（ログインフォーム内の可視テキスト入力欄）
  const TARGET_SELECTOR = 'form#login input#identifier[type="text"]';
  const SUBMIT_BUTTON_SELECTOR = 'form#login button[type="submit"]';
  const FIDO2_BUTTON_SELECTOR = 'form#fido2-form button[type="submit"]';

  // ストレージから設定を取得
  async function getSettings() {
    try {
      const result = await chrome.storage.sync.get(['savedUsername', 'autoSubmit', 'autoFido2']);
      return {
        username: result.savedUsername || '',
        autoSubmit: !!result.autoSubmit,
        autoFido2: !!result.autoFido2
      };
    } catch (e) {
      // syncが使えない場合はlocalにフォールバック
      try {
        const localResult = await chrome.storage.local.get(['savedUsername', 'autoSubmit', 'autoFido2']);
        return {
          username: localResult.savedUsername || '',
          autoSubmit: !!localResult.autoSubmit,
          autoFido2: !!localResult.autoFido2
        };
      } catch (err) {
        console.error('[Doshisha Autofill] Failed to load settings:', err);
        return { username: '', autoSubmit: false, autoFido2: false };
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

  // 「次へ」ボタンを自動クリック
  let hasSubmitted = false;
  function clickNextButton() {
    if (hasSubmitted) return;

    const nextBtn = document.querySelector(SUBMIT_BUTTON_SELECTOR);
    const loginForm = document.querySelector('form#login');

    if (!nextBtn || !loginForm) return;

    // 既にStep 2（パスワード画面）に移行している場合はスキップ
    if (loginForm.getAttribute('data-step') === 'second') return;

    // ボタンが無効化されている場合はスキップ
    if (nextBtn.disabled) return;

    hasSubmitted = true;

    // イベント伝播とフォーム状態更新を待ってからクリック（150ms）
    setTimeout(() => {
      if (loginForm.getAttribute('data-step') !== 'second' && !nextBtn.disabled) {
        nextBtn.click();
      }
    }, 150);
  }

  // 「パスワードレス認証」ボタンを自動クリック
  let hasFido2Clicked = false;
  async function attemptFido2Click(force = false) {
    if (hasFido2Clicked && !force) return;

    const settings = await getSettings();
    if (!settings.autoFido2 && !force) return;

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

  // DOM監視（動的レンダリング・遅延ロード・画面切り替え対応）
  let observer = null;
  function startObserver() {
    if (observer) return;

    // 初回チェック
    attemptAutofill();
    attemptFido2Click();

    observer = new MutationObserver((mutations, obs) => {
      attemptAutofill();
      attemptFido2Click();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'data-step']
    });

    // ページロードから30秒後に監視を停止（無駄な負荷防止）
    setTimeout(() => {
      if (observer && (hasFido2Clicked || (isFilled && document.querySelector('form#login')?.getAttribute('data-step') === 'second'))) {
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
