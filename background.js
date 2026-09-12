/**
 * Doshisha Autofill
 * Background Service Worker
 */

const LOGIN_URL = 'https://doshisha.ex-tic.com/auth/session';

// ショートカットキー押下時のハンドラ
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-login-page') {
    chrome.tabs.create({ url: LOGIN_URL });
  }
});
