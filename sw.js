import {
  getPolicyState, refreshAfterInstall, refreshPolicy, refreshPolicyIfDue, savePolicyUrl
} from './policy-refresh.js';

const { whatsappOrigin, decideDownload } = globalThis.WADownloadGuard;
const REFRESH_ALARM = 'wa-dl-guard-refresh-policy';
const REFRESH_PERIOD_MINUTES = 60;
const RECENT_DOWNLOAD_LIMIT = 256;
const pendingChecks = new Map();
const checkedDownloads = new Set();

function logError(error) {
  console.debug('[WA Download Guard]', error);
}

function isFromWhatsApp(item) {
  return item && item.byExtensionId !== chrome.runtime.id &&
    [item.url, item.finalUrl, item.referrer].some(whatsappOrigin);
}

function toastOrigin(item) {
  if (item.referrer) return whatsappOrigin(item.referrer);
  return [item.url, item.finalUrl].filter(url => url?.startsWith('blob:'))
    .map(whatsappOrigin).find(Boolean);
}

async function notifyDownload(item, message) {
  const origin = toastOrigin(item);
  if (origin) {
    try {
      const { protocol, hostname } = new URL(origin);
      const tabs = await chrome.tabs.query({ url: `${protocol}//${hostname}/*` });
      const matchingTabs = tabs.filter(tab => whatsappOrigin(tab.url) === origin &&
        tab.incognito === item.incognito && Number.isInteger(tab.id));
      if (matchingTabs.length === 1) {
        const result = await chrome.tabs.sendMessage(
          matchingTabs[0].id, { type: 'download-notice', message, origin }, { frameId: 0 }
        );
        if (result?.shown) return;
      }
    } catch (error) { logError(error); }
  }

  await chrome.notifications.create(`wa-download-${item.id}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/128.png'),
    title: 'WA - Download Guard',
    message
  });
}

async function cancelDownload(id) {
  try { await chrome.downloads.cancel(id); }
  catch (error) { logError(error); }

  try {
    const [item] = await chrome.downloads.search({ id });
    if (item?.state === 'complete') return 'complete';
    if (item?.state === 'interrupted' && item.error === 'USER_CANCELED') return 'canceled';
  } catch (error) { logError(error); }
  return 'unconfirmed';
}

async function reviewDownload(item, completed = false) {
  let state;
  try { state = await getPolicyState(); }
  catch (error) { logError(error); }
  if (state?.enabled === false) return '';
  if (state) refreshPolicyIfDue(state)?.catch(logError);

  const decision = decideDownload(state?.policy, {
    filename: item.filename,
    url: item.finalUrl || item.url,
    mime: item.mime
  });
  if (decision.allow) return '';

  const result = completed ? 'complete' : await cancelDownload(item.id);
  if (result === 'canceled') return `Download bloqueado. ${decision.reason}`;
  if (result === 'complete') {
    return `O download já foi concluído e o arquivo pode estar no disco. ${decision.reason}`;
  }
  return `Não foi possível confirmar o bloqueio. Confira o download no navegador. ${decision.reason}`;
}

function rememberCheck(id) {
  checkedDownloads.add(id);
  if (checkedDownloads.size > RECENT_DOWNLOAD_LIMIT) {
    checkedDownloads.delete(checkedDownloads.values().next().value);
  }
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!isFromWhatsApp(item)) {
    suggest();
    return;
  }

  const check = reviewDownload(item).then(message => {
    rememberCheck(item.id);
    if (message) notifyDownload(item, message).catch(logError);
  }).catch(logError).finally(() => {
    pendingChecks.delete(item.id);
    suggest();
  });
  pendingChecks.set(item.id, check);
  return true;
});

async function reviewCompletedDownload(id) {
  await pendingChecks.get(id);
  if (checkedDownloads.delete(id)) return;

  // Alguns downloads podem chegar ao estado final sem passar pelo listener de nome.
  const [item] = await chrome.downloads.search({ id });
  if (!isFromWhatsApp(item)) return;
  const message = await reviewDownload(item, true);
  if (message) await notifyDownload(item, message);
}

chrome.downloads.onChanged.addListener(delta => {
  if (delta.state?.current === 'complete') reviewCompletedDownload(delta.id).catch(logError);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.url !== chrome.runtime.getURL('options/options.html')) return;

  let operation;
  if (message?.type === 'save-policy-url') operation = savePolicyUrl(message.url);
  if (message?.type === 'refresh-policy') {
    operation = getPolicyState().then(state => refreshPolicy(state.url));
  }
  if (!operation) return;

  operation.then(sendResponse, error => {
    logError(error);
    sendResponse({ ok: false, error: 'Não foi possível acessar a configuração da extensão.' });
  });
  return true;
});

async function ensureRefreshAlarm() {
  if (!(await chrome.alarms.get(REFRESH_ALARM))) {
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFRESH_ALARM) {
    getPolicyState().then(state => refreshPolicy(state.url)).catch(logError);
  }
});

chrome.runtime.onInstalled.addListener(details => {
  ensureRefreshAlarm().catch(logError);
  refreshAfterInstall(details).catch(logError);
});

chrome.runtime.onStartup.addListener(() => {
  ensureRefreshAlarm().catch(logError);
  getPolicyState().then(refreshPolicyIfDue).catch(logError);
});
