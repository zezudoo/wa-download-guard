(() => {
  const { readPolicyState, extensionFromFilename, decideDownload } = globalThis.WADownloadGuard;
  const policyKeys = ['enabled', 'configUrl', 'policy', 'policySourceUrl'];
  let state;
  let loadVersion = 0;

  async function loadPolicy() {
    const version = ++loadVersion;
    state = undefined;
    try {
      const data = await chrome.storage.local.get(policyKeys);
      if (version === loadVersion) state = readPolicyState(data);
    } catch {
      // O service worker continua responsável pela decisão do download.
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && policyKeys.some(key => key in changes)) {
      void loadPolicy();
    }
  });
  void loadPolicy();

  function getToastHost() {
    const existing = document.getElementById('wa-dl-guard-toast-host');
    if (existing) return existing;
    if (!document.documentElement) return null;

    const host = document.createElement('div');
    host.id = 'wa-dl-guard-toast-host';
    host.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;pointer-events:none';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { display: grid; gap: 8px; }
      .toast {
        box-sizing: border-box;
        width: min(360px, calc(100vw - 40px));
        padding: 14px 16px;
        border-radius: 12px;
        background: #991b1b;
        color: white;
        box-shadow: 0 6px 24px rgb(0 0 0 / 24%);
        font: 14px/1.45 system-ui, sans-serif;
        overflow-wrap: anywhere;
      }
      strong { display: block; margin-bottom: 4px; }
    `;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
    return host;
  }

  function showToast(message) {
    const shadow = getToastHost()?.shadowRoot;
    if (!shadow) return false;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'alert');
    const title = document.createElement('strong');
    title.textContent = 'WA - Download Guard';
    const body = document.createElement('span');
    body.textContent = message;
    toast.append(title, body);
    shadow.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id === chrome.runtime.id && message?.type === 'download-notice' &&
        message.origin === location.origin) {
      sendResponse({ shown: showToast(message.message) });
    }
  });

  function isLocalBlob(url) {
    return url.startsWith('blob:') && new URL(url).origin === location.origin;
  }

  function getDataMime(url) {
    const comma = url.indexOf(',', 5);
    return comma === -1 ? '' : url.slice(5, comma).split(';', 1)[0] || 'text/plain';
  }

  // O atributo download é efetivo para blobs da própria página e URLs data.
  window.addEventListener('click', event => {
    if (!state?.enabled || event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        !event.cancelable) return;

    const anchor = event.composedPath().find(node =>
      node instanceof HTMLAnchorElement && node.hasAttribute('href') && node.hasAttribute('download'));
    if (!anchor) return;

    const { href, download: filename } = anchor;
    const isData = href.startsWith('data:');
    if (!isData && !isLocalBlob(href)) return;

    const mime = isData ? getDataMime(href) : '';
    if (state.policy && !mime && !extensionFromFilename(filename)) return;

    const decision = decideDownload(state.policy, { filename, mime });
    if (decision.allow) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast(`Download bloqueado. ${decision.reason}`);
  }, true);
})();
