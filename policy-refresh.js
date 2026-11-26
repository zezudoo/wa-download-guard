import './policy-rules.js';

const { STATE_KEYS, parseConfigUrl, resolvePolicyUrl, normalizePolicy, readPolicyState } =
  globalThis.WADownloadGuard;
const LEGACY_PUBLISHED_URL = 'https://wazap.coopavel.com.br:8090/allowlist_wa_guard.json';
const RETRY_SECONDS = 60;
const FETCH_TIMEOUT_MS = 8000;
const pendingRefreshes = new Map();
let storageUpdates = Promise.resolve();

const now = () => Math.floor(Date.now() / 1000);

export async function getPolicyState() {
  return readPolicyState(await chrome.storage.local.get(STATE_KEYS));
}

function updateStorage(update) {
  const next = storageUpdates.then(update);
  storageUpdates = next.catch(() => {});
  return next;
}

export async function savePolicyUrl(value) {
  if (typeof value !== 'string') return { ok: false, error: 'Informe a URL da política.' };
  const input = value.trim();
  const url = parseConfigUrl(input);
  if (input && !url) {
    return { ok: false, error: 'Informe uma URL HTTPS válida, sem credenciais.' };
  }

  await updateStorage(() => chrome.storage.local.set({ configUrl: url, enabled: true }));
  return refreshPolicy(resolvePolicyUrl(url));
}

export async function refreshAfterInstall({ reason, previousVersion }) {
  if (reason === 'update' && previousVersion === '1.0.4') {
    await updateStorage(async () => {
      const { configUrl } = await chrome.storage.local.get('configUrl');
      // 1.0.4 persisted the Store default in the same field as custom URLs.
      if (parseConfigUrl(configUrl) === LEGACY_PUBLISHED_URL) {
        await chrome.storage.local.set({ configUrl: '' });
      }
    });
  }

  const state = await getPolicyState();
  return refreshPolicy(state.url);
}

async function fetchPolicy(url) {
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error('Tempo limite ao acessar a URL.');
    throw new Error('Não foi possível acessar a URL. Verifique a conexão e as permissões do servidor.');
  }
  if (!response.ok) throw new Error(`O servidor retornou HTTP ${response.status}.`);
  if (response.redirected && !parseConfigUrl(response.url)) {
    throw new Error('A URL redirecionou para um endereço inválido ou sem HTTPS.');
  }

  let json;
  try { json = await response.json(); }
  catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('Tempo limite ao baixar a política.');
    }
    throw new Error('O servidor retornou um JSON inválido.');
  }

  const policy = normalizePolicy(json);
  if (!policy) throw new Error('O JSON não segue o formato da allowlist.');
  return policy;
}

async function runRefresh(url) {
  let policy;
  let error = '';
  try { policy = await fetchPolicy(url); }
  catch (failure) { error = failure.message; }

  return updateStorage(async () => {
    const { configUrl } = await chrome.storage.local.get('configUrl');
    if (resolvePolicyUrl(configUrl) !== url) {
      return { ok: false, error: 'A URL configurada mudou durante a atualização.' };
    }

    const attemptedAt = now();
    const updates = { policyRefresh: { url, attemptedAt, error } };
    if (policy) {
      Object.assign(updates, { policy, policySourceUrl: url, policyFetchedAt: attemptedAt });
    }
    await chrome.storage.local.set(updates);
    return { ok: !error, configured: true, error };
  });
}

export async function refreshPolicy(url) {
  if (!pendingRefreshes.has(url)) {
    const pending = runRefresh(url).finally(() => pendingRefreshes.delete(url));
    pendingRefreshes.set(url, pending);
  }
  return pendingRefreshes.get(url);
}

export function refreshPolicyIfDue(state) {
  const time = now();
  if (state.policy && time - state.fetchedAt < state.policy.ttl_seconds) return;
  if (state.lastAttempt?.error && time - state.lastAttempt.attemptedAt < RETRY_SECONDS) return;
  return refreshPolicy(state.url);
}
