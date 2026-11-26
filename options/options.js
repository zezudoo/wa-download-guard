const { STATE_KEYS, readPolicyState } = globalThis.WADownloadGuard;
const $ = id => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
let loadVersion = 0;
let savedUrl = '';

function showStatus(message, className = '') {
  $('status').textContent = message;
  $('status').className = `status ${className}`;
}

function renderState(state) {
  const { enabled, url, policy, fetchedAt, lastAttempt } = state;
  if ($('configUrl').value === savedUrl) $('configUrl').value = url;
  savedUrl = url;
  const stale = policy && Date.now() / 1000 - fetchedAt >= policy.ttl_seconds;
  $('protection').textContent = enabled ? 'Proteção ativa' : 'Proteção desativada';
  $('info').textContent = policy
    ? `Allowlist ${enabled ? 'em vigor' : 'armazenada'} com ${policy.allowed.extensions.length} extensões e ${policy.allowed.mime_types.length} tipos MIME.${stale ? ' Cache aguardando atualização.' : ''}`
    : 'Nenhuma política válida para a URL atual.' +
      (enabled ? ' Os downloads identificados como do WhatsApp serão bloqueados.' : '');
  $('last-success').textContent = fetchedAt
    ? `Última atualização bem-sucedida em ${dateFormat.format(fetchedAt * 1000)}.`
    : 'Aguardando a primeira atualização bem-sucedida para esta URL.';
  $('last-success').hidden = false;
  $('last-error').textContent = lastAttempt?.error
    ? `Última tentativa em ${dateFormat.format(lastAttempt.attemptedAt * 1000)}. ${lastAttempt.error}`
    : '';
  $('last-error').hidden = !lastAttempt?.error;
}

async function readState() {
  const version = ++loadVersion;
  const data = await chrome.storage.local.get(STATE_KEYS);
  const state = readPolicyState(data);
  if (version === loadVersion) renderState(state);
  return state;
}

function setBusy(busy) {
  for (const id of ['save', 'refresh', 'configUrl']) $(id).disabled = busy;
}

async function runAction(type) {
  const saving = type === 'save-policy-url';
  const url = $('configUrl').value.trim();
  setBusy(true);
  showStatus(saving ? 'Salvando a configuração…' : 'Atualizando a política…');

  try {
    const result = await chrome.runtime.sendMessage({ type, url: saving ? url : undefined });
    const state = await readState();
    if (saving && (result?.ok || result?.configured)) $('configUrl').value = state.url;
    if (!result?.ok) {
      const error = result?.error || 'Não foi possível atualizar a política.';
      showStatus(saving && result?.configured ? `URL salva. ${error}` : error, 'err');
    } else {
      showStatus('Política atualizada.', 'ok');
    }
  } catch {
    showStatus('Não foi possível acessar a configuração da extensão.', 'err');
  } finally {
    setBusy(false);
  }
}

$('config').addEventListener('submit', event => {
  event.preventDefault();
  void runAction('save-policy-url');
});
$('refresh').addEventListener('click', () => void runAction('refresh-policy'));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STATE_KEYS.some(key => key in changes)) {
    readState().catch(() => showStatus('Não foi possível ler o estado da política.', 'err'));
  }
});

readState().catch(() => {
  showStatus('Não foi possível ler a configuração salva.', 'err');
}).finally(() => setBusy(false));
