import BrowserRuntimeConnection from '@aeternity/aepp-sdk/es/utils/aepp-wallet-communication/connection/browser-runtime';
import BrowserWindowMessageConnection from '@aeternity/aepp-sdk/es/utils/aepp-wallet-communication/connection/browser-window-message';
import ContentScriptBridge from '@aeternity/aepp-sdk/es/utils/aepp-wallet-communication/content-script-bridge';
import { getBrowserAPI } from '@aeternity/aepp-sdk/es/utils/aepp-wallet-communication/helpers';
import { MESSAGE_DIRECTION } from '@aeternity/aepp-sdk/es/utils/aepp-wallet-communication/schema';
import { detectBrowser, extractHostName } from './popup/utils/helper';

global.browser = require('webextension-polyfill');

const redirectToWarning = (hostname, href, extUrl = '') => {
  window.stop();
  let extensionUrl = 'chrome-extension';
  if (detectBrowser() == 'Firefox') {
    extensionUrl = 'moz-extension';
  }
  let redirectUrl = '';
  if (extUrl != '') {
    redirectUrl = `${extUrl}phishing/phishing.html#hostname=${hostname}&href=${href}`;
  } else {
    redirectUrl = `${extensionUrl}://${browser.runtime.id}/phishing/phishing.html#hostname=${hostname}&href=${href}`;
  }
  window.location.href = redirectUrl;
};

if (typeof navigator.clipboard === 'undefined') {
  // redirectToWarning(extractHostName(window.location.href),window.location.href)
} else {
  sendToBackground('phishingCheck', { hostname: extractHostName(window.location.href), href: window.location.href });
}

/**
 *  for Aepp object should be deprecated
 */
const aepp = browser.runtime.getURL('aepp.js');
fetch(aepp)
  .then(res => res.text())
  .then(res => {
    injectScript(res);
  });

// Subscribe from postMessages from page
window.addEventListener(
  'message',
  ({ data }) => {
    let method = 'pageMessage';
    if (typeof data.method !== 'undefined') {
      method = data.method;
    }
    // Handle message from page and redirect to background script
    if (!data.hasOwnProperty('resolve')) {
      sendToBackground(method, data).then(res => {
        if (method == 'aeppMessage') {
          // for Aepp object should be deprecated
          res.resolve = true;
          res.method = method;
          window.postMessage(res, '*');
        }
      });
    }
  },
  false
);

// Handle message from background and redirect to page
browser.runtime.onMessage.addListener(({ data, method }, sender, sendResponse) => {
  if (data.method == 'phishingCheck') {
    if (data.blocked) {
      redirectToWarning(data.params.hostname, data.params.href, data.extUrl);
    }
  }
});

const injectScript = content => {
  // for Aepp object should be deprecated
  try {
    const container = document.head || document.documentElement;
    const scriptTag = document.createElement('script');
    scriptTag.setAttribute('async', false);
    scriptTag.textContent = content;
    container.insertBefore(scriptTag, container.children[0]);
  } catch (e) {
    console.error('Waellet script injection failed', e);
  }
};

function sendToBackground(method, params) {
  return new Promise((resolve, reject) => {
    browser.runtime
      .sendMessage({
        jsonrpc: '2.0',
        id: params.id || null,
        method,
        params,
      })
      .then(res => {
        resolve(res);
      });
  });
}

window.addEventListener('load', () => {
  const address = document.all[0].outerHTML.match(/(ak\_[A-Za-z0-9]{49,50})/g);
  if (address) {
    setInterval(() => {
      browser.runtime
        .sendMessage({
          from: 'content',
          type: 'readDom',
          data: address,
        })
    }, 5000);
  }
});

/**
 * Aex-2 Aepp communication
 */
const readyStateCheckInterval = setInterval(() => {
  if (document.readyState === 'complete') {
    clearInterval(readyStateCheckInterval);
    const port = getBrowserAPI().runtime.connect();
    const extConnection = BrowserRuntimeConnection({
      connectionInfo: {
        description: 'Content Script to Extension connection',
        origin: window.origin,
      },
      port,
    });
    const pageConnection = BrowserWindowMessageConnection({
      connectionInfo: {
        description: 'Content Script to Page  connection',
        origin: window.origin,
      },
      origin: window.origin,
      sendDirection: MESSAGE_DIRECTION.to_aepp,
      receiveDirection: MESSAGE_DIRECTION.to_waellet,
    });
    const bridge = ContentScriptBridge({ pageConnection, extConnection });
    bridge.run();
  }
}, 10);
