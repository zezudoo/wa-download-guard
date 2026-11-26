(() => {
  const DEFAULT_TTL_SECONDS = 3600;
  const DEFAULT_CONFIG_URL = 'https://pastefy.app/qsgAfmgn/raw';
  const LEGACY_PLACEHOLDER_URL =
    'https://gist.githubusercontent.com/user/gist-id/raw/allowlist_wa_guard.json';
  const STATE_KEYS = [
    'enabled', 'configUrl', 'policy', 'policySourceUrl', 'policyFetchedAt', 'policyRefresh'
  ];
  const GENERIC_MIME_TYPES = new Set([
    'application/octet-stream',
    'binary/octet-stream',
    'application/download',
    'application/x-download'
  ]);

  function parseUrl(value) {
    try { return new URL(value); } catch { return null; }
  }

  function parseConfigUrl(value) {
    const url = parseUrl(value);
    if (url?.protocol !== 'https:' || url.username || url.password) return '';
    url.hash = '';
    return url.href === LEGACY_PLACEHOLDER_URL ? '' : url.href;
  }

  function resolvePolicyUrl(value) {
    return parseConfigUrl(value) || DEFAULT_CONFIG_URL;
  }

  function normalizeExtension(value) {
    return typeof value === 'string' ? value.trim().toLowerCase().replace(/^\.+/, '') : '';
  }

  function normalizeMime(value) {
    return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
  }

  function normalizePolicy(policy) {
    if (policy?.mode !== 'allow' ||
        (policy.schema_version !== undefined && policy.schema_version !== 1) ||
        (policy.default_action !== undefined && policy.default_action !== 'block')) return null;

    const ttl = policy.ttl_seconds === undefined ? DEFAULT_TTL_SECONDS : policy.ttl_seconds;
    if (!Number.isSafeInteger(ttl) || ttl <= 0) return null;

    const allowed = policy.allowed;
    if (!Array.isArray(allowed?.extensions) || !Array.isArray(allowed.mime_types)) return null;

    const extensions = allowed.extensions.map(normalizeExtension);
    const mimeTypes = allowed.mime_types.map(normalizeMime);
    const extensionPattern = /^[a-z0-9][a-z0-9_+-]*$/;
    const mimePattern = /^[a-z0-9][a-z0-9!#$%&'+.^_`|~-]*\/[a-z0-9][a-z0-9!#$%&'+.^_`|~-]*$/;
    if (!extensions.every(value => extensionPattern.test(value)) ||
        !mimeTypes.every(value => mimePattern.test(value))) return null;

    return {
      ...policy,
      ttl_seconds: ttl,
      allowed: {
        extensions: [...new Set(extensions)],
        mime_types: [...new Set(mimeTypes)]
      }
    };
  }

  function readPolicyState(data) {
    const url = resolvePolicyUrl(data.configUrl);
    const policy = data.policySourceUrl === url ? data.policy : null;
    return {
      enabled: data.enabled !== false,
      url,
      policy: policy || null,
      fetchedAt: policy ? data.policyFetchedAt || 0 : 0,
      lastAttempt: data.policyRefresh?.url === url ? data.policyRefresh : null
    };
  }

  function whatsappOrigin(value) {
    const url = parseUrl(value);
    const origin = url?.protocol === 'blob:' ? parseUrl(url.origin) : url;
    if (origin?.protocol !== 'https:') return '';
    const host = origin.hostname;
    return /(^|\.)whatsapp\.(com|net)$|^wa\.me$/i.test(host) ? origin.origin : '';
  }

  function extensionFromFilename(filename) {
    const basename = (filename || '').trim().split(/[\\/]/).pop();
    const dot = basename.lastIndexOf('.');
    return dot > 0 ? normalizeExtension(basename.slice(dot + 1)) : '';
  }

  function extensionFromUrl(value) {
    const url = parseUrl(value);
    if (url?.protocol !== 'https:' && url?.protocol !== 'http:') return '';
    const basename = url.pathname.split('/').pop();
    try { return extensionFromFilename(decodeURIComponent(basename)); }
    catch { return extensionFromFilename(basename); }
  }

  function decideDownload(policy, { filename, url, mime }) {
    const ext = extensionFromFilename(filename) || extensionFromUrl(url);
    const type = normalizeMime(mime);
    const usefulMime = type && !GENERIC_MIME_TYPES.has(type);
    let reason = '';

    if (!policy) reason = 'Nenhuma política válida está em vigor.';
    else if (usefulMime && !policy.allowed.mime_types.includes(type)) {
      reason = `O tipo MIME ${type} não está na allowlist.`;
    } else if (ext && !policy.allowed.extensions.includes(ext)) {
      reason = `A extensão .${ext} não está na allowlist.`;
    } else if (!ext && !usefulMime) {
      reason = 'O arquivo não tem extensão nem tipo MIME reconhecido.';
    }

    return { allow: !reason, reason };
  }

  globalThis.WADownloadGuard = {
    STATE_KEYS, parseConfigUrl, resolvePolicyUrl, normalizePolicy, readPolicyState, whatsappOrigin,
    extensionFromFilename, decideDownload
  };
})();
