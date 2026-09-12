/**
 * Popup Script for Doshisha Autofill
 * 完全自動保存対応
 */

document.addEventListener('DOMContentLoaded', async () => {
  const usernameInput = document.getElementById('username-input');
  const clearBtn = document.getElementById('clear-btn');
  const saveIndicator = document.getElementById('save-indicator');
  const autoSubmitToggle = document.getElementById('auto-submit-toggle');
  const autoFido2Toggle = document.getElementById('auto-fido2-toggle');
  const autoPasswordTabToggle = document.getElementById('auto-password-tab-toggle');
  const themeToggle = document.getElementById('theme-toggle');
  const targetDomainLink = document.getElementById('target-domain-link');
  const versionText = document.getElementById('version-text');

  let feedbackTimeout = null;
  let debounceTimeout = null;

  // 直前に保存された状態をキャッシュ
  let lastSavedState = {
    username: '',
    autoSubmit: false,
    autoFido2: false,
    autoPasswordTab: false
  };

  // テーマ管理
  function getEffectiveTheme() {
    const explicitTheme = document.documentElement.getAttribute('data-theme');
    if (explicitTheme === 'light' || explicitTheme === 'dark') {
      return explicitTheme;
    }
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  async function toggleTheme() {
    const current = getEffectiveTheme();
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);

    try {
      await chrome.storage.sync.set({ theme: nextTheme });
    } catch (e) {
      try {
        await chrome.storage.local.set({ theme: nextTheme });
      } catch (err) {
        console.error('Failed to save theme:', err);
      }
    }
  }

  // トグルカードの非言語保存パルス演出
  function triggerOptionPulse(inputElement) {
    const item = inputElement.closest('.option-item');
    if (!item) return;
    item.classList.remove('saved-pulse');
    void item.offsetWidth; // リフロー強制でアニメーション再トリガー
    item.classList.add('saved-pulse');
  }

  // 入力欄の保存完了フィードバック演出（枠線の緑発光 & ✓アイコン）
  function showSaveFeedback(duration = 1800) {
    if (feedbackTimeout) {
      clearTimeout(feedbackTimeout);
    }

    usernameInput.classList.add('is-saved');
    saveIndicator.classList.add('visible');

    feedbackTimeout = setTimeout(() => {
      usernameInput.classList.remove('is-saved');
      saveIndicator.classList.remove('visible');
    }, duration);
  }

  // クリアボタンの表示切り替え
  function updateClearButton() {
    if (usernameInput.value.length > 0) {
      clearBtn.classList.add('visible');
    } else {
      clearBtn.classList.remove('visible');
    }
  }

  // バージョン番号の動的反映 (manifest.json から取得)
  function renderVersion() {
    if (!versionText) return;
    try {
      const manifest = chrome.runtime?.getManifest?.();
      if (manifest && manifest.version) {
        versionText.textContent = `v${manifest.version}`;
      } else {
        versionText.textContent = '';
      }
    } catch (err) {
      console.warn('Failed to load version from manifest:', err);
      versionText.textContent = '';
    }
  }

  // ストレージから設定を取得
  async function loadSettings() {
    try {
      const res = await chrome.storage.sync.get(['savedUsername', 'autoSubmit', 'autoFido2', 'autoPasswordTab', 'theme']);
      if (res.theme) {
        applyTheme(res.theme);
      }
      const username = res.savedUsername || '';
      const autoSubmit = !!res.autoSubmit;
      const autoFido2 = !!res.autoFido2;
      const autoPasswordTab = !!res.autoPasswordTab;

      usernameInput.value = username;
      autoSubmitToggle.checked = autoSubmit;
      autoFido2Toggle.checked = autoFido2;
      autoPasswordTabToggle.checked = autoPasswordTab;

      lastSavedState = { username, autoSubmit, autoFido2, autoPasswordTab };
      updateClearButton();
    } catch (e) {
      try {
        const localRes = await chrome.storage.local.get(['savedUsername', 'autoSubmit', 'autoFido2', 'autoPasswordTab', 'theme']);
        if (localRes.theme) {
          applyTheme(localRes.theme);
        }
        const username = localRes.savedUsername || '';
        const autoSubmit = !!localRes.autoSubmit;
        const autoFido2 = !!localRes.autoFido2;
        const autoPasswordTab = !!localRes.autoPasswordTab;

        usernameInput.value = username;
        autoSubmitToggle.checked = autoSubmit;
        autoFido2Toggle.checked = autoFido2;
        autoPasswordTabToggle.checked = autoPasswordTab;

        lastSavedState = { username, autoSubmit, autoFido2, autoPasswordTab };
        updateClearButton();
      } catch (err) {
        console.error('Failed to load storage:', err);
      }
    }
  }

  // ストレージに保存
  async function saveSettings(options = { showFeedback: true }) {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }

    const username = usernameInput.value.trim();
    const autoSubmit = autoSubmitToggle.checked;
    const autoFido2 = autoFido2Toggle.checked;
    const autoPasswordTab = autoPasswordTabToggle.checked;

    // 前回の保存内容と同一なら無駄な書き込みをスキップ
    const isUsernameChanged = username !== lastSavedState.username;
    const isOptionsChanged =
      autoSubmit !== lastSavedState.autoSubmit ||
      autoFido2 !== lastSavedState.autoFido2 ||
      autoPasswordTab !== lastSavedState.autoPasswordTab;

    if (!isUsernameChanged && !isOptionsChanged) {
      return;
    }

    const settings = { savedUsername: username, autoSubmit, autoFido2, autoPasswordTab };
    lastSavedState = { username, autoSubmit, autoFido2, autoPasswordTab };

    try {
      await chrome.storage.sync.set(settings);
    } catch (e) {
      try {
        await chrome.storage.local.set(settings);
      } catch (err) {
        console.error('Failed to save settings:', err);
      }
    }

    if (options.showFeedback && isUsernameChanged) {
      showSaveFeedback();
    }
  }

  // 入力停止検知（デバウンス保存: 1500ms）
  function triggerDebouncedSave() {
    updateClearButton();
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    debounceTimeout = setTimeout(() => {
      saveSettings({ showFeedback: true });
    }, 1500);
  }

  // イベントリスナー登録

  // 1. 入力中：クリアボタン表示切替 ＆ デバウンス保存（1500ms）
  usernameInput.addEventListener('input', triggerDebouncedSave);

  // 2. フォーカスが外れた時（blur）：即時保存
  usernameInput.addEventListener('blur', () => {
    saveSettings({ showFeedback: true });
  });

  // 3. Enterキー：即時保存してフォーカスを外す
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveSettings({ showFeedback: true });
      usernameInput.blur();
    }
  });

  // 4. クリアボタン押下：入力値を空にして即時保存
  clearBtn.addEventListener('click', () => {
    usernameInput.value = '';
    updateClearButton();
    saveSettings({ showFeedback: true });
    usernameInput.focus();
  });

  // 5. 「自動で次へ」トグル：即時保存 ＆ 非言語パルス
  autoSubmitToggle.addEventListener('change', () => {
    saveSettings({ showFeedback: false });
    triggerOptionPulse(autoSubmitToggle);
  });

  // 6. 「パスワードレス認証」トグル：即時保存 ＆ 非言語パルス（パスワードタブ自動選択がONならOFFにする）
  autoFido2Toggle.addEventListener('change', () => {
    if (autoFido2Toggle.checked && autoPasswordTabToggle.checked) {
      autoPasswordTabToggle.checked = false;
      triggerOptionPulse(autoPasswordTabToggle);
    }
    saveSettings({ showFeedback: false });
    triggerOptionPulse(autoFido2Toggle);
  });

  // 6-2. 「パスワード」タブ自動選択トグル：即時保存 ＆ 非言語パルス（パスワードレス自動開始がONならOFFにする）
  autoPasswordTabToggle.addEventListener('change', () => {
    if (autoPasswordTabToggle.checked && autoFido2Toggle.checked) {
      autoFido2Toggle.checked = false;
      triggerOptionPulse(autoFido2Toggle);
    }
    saveSettings({ showFeedback: false });
    triggerOptionPulse(autoPasswordTabToggle);
  });

  // 7. 外観テーマ切り替え（ライト / ダーク）
  themeToggle.addEventListener('click', toggleTheme);

  // 8. 対象ドメインクリック：ログインページを新規タブで開く
  if (targetDomainLink) {
    targetDomainLink.addEventListener('click', (e) => {
      e.preventDefault();
      const targetUrl = targetDomainLink.href || 'https://doshisha.ex-tic.com/auth/session';
      chrome.tabs.create({ url: targetUrl });
    });
  }

  // 初期ロード
  renderVersion();
  await loadSettings();
  usernameInput.focus();
});
