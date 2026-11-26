import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import '../policy-rules.js';

const { normalizePolicy, readPolicyState, decideDownload } = globalThis.WADownloadGuard;
const url = 'https://policy.example/allowlist.json';
const defaultUrl = 'https://pastefy.app/qsgAfmgn/raw';
const publishedLegacyUrl = 'https://wazap.coopavel.com.br:8090/allowlist_wa_guard.json';
const policy = {
  mode: 'allow',
  allowed: { extensions: ['pdf'], mime_types: ['application/pdf'] }
};
const optionsUrl = 'chrome-extension://guard/options/options.html';
let runId = 0;

function validCache(overrides = {}) {
  return {
    configUrl: url, policy: normalizePolicy(policy), policySourceUrl: url,
    policyFetchedAt: Math.floor(Date.now() / 1000), ...overrides
  };
}

async function useBrowser(t, { storage = {}, fetch = async () => new Response('{}'), downloads = {} } = {}) {
  const listeners = {};
  const notices = [];
  const event = name => ({
    addListener(listener) { listeners[name] = listener; }
  });

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries([keys].flat().map(key => [key, storage[key]]));
        },
        async set(data) { Object.assign(storage, structuredClone(data)); }
      }
    },
    runtime: {
      id: 'guard', getURL: path => 'chrome-extension://guard/' + path,
      onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup')
    },
    downloads: {
      onDeterminingFilename: event('filename'), onChanged: event('changed'),
      async cancel() {}, async search() { return []; }, ...downloads
    },
    alarms: { async get() {}, async create() {}, onAlarm: event('alarm') },
    tabs: { async query() { return []; } },
    notifications: { async create(_id, options) { notices.push(options.message); } }
  };
  t.after(() => { delete globalThis.chrome; });
  t.mock.method(globalThis, 'fetch', fetch);
  await import('../sw.js?test=' + ++runId);

  function send(type, value) {
    return new Promise(resolve => {
      assert.equal(listeners.message({ type, url: value }, { url: optionsUrl }, resolve), true);
    });
  }

  return { storage, listeners, notices, send };
}

test('validates policy metadata and applies the same extension and MIME rules', () => {
  const active = normalizePolicy(policy);
  assert.equal(active.ttl_seconds, 3600);
  assert.equal(normalizePolicy({ ...policy, ttl_seconds: 0 }), null);
  assert.equal(normalizePolicy({ ...policy, default_action: 'allow' }), null);
  assert.equal(normalizePolicy({ ...policy, schema_version: 2 }), null);
  assert.equal(normalizePolicy({ ...policy, allowed: { ...policy.allowed, extensions: [123] } }), null);

  assert.equal(decideDownload(active, { filename: 'DOCUMENT.PDF', mime: 'application/pdf' }).allow, true);
  assert.equal(decideDownload(active, { filename: 'document.pdf', mime: 'application/octet-stream' }).allow, true);
  assert.equal(decideDownload(active, { filename: 'archive.zip', mime: 'application/zip' }).allow, false);
  assert.equal(readPolicyState({ configUrl: url, policy: active }).policy, null);
  assert.equal(readPolicyState({}).url, defaultUrl);
  assert.equal(readPolicyState({
    configUrl: 'https://gist.githubusercontent.com/user/gist-id/raw/allowlist_wa_guard.json'
  }).url, defaultUrl);
});

test('fetches the default policy on installation and when clearing a custom URL', async t => {
  const requests = [];
  const { storage, listeners, send } = await useBrowser(t, {
    fetch: async requestedUrl => {
      requests.push(requestedUrl);
      return Response.json(policy);
    }
  });
  listeners.installed({ reason: 'install' });
  await setImmediate();
  assert.deepEqual(requests, [defaultUrl]);
  assert.equal(storage.policySourceUrl, defaultUrl);

  assert.equal((await send('save-policy-url', url)).ok, true);
  assert.equal(storage.policySourceUrl, url);
  assert.equal((await send('save-policy-url', '')).ok, true);
  assert.equal(storage.policySourceUrl, defaultUrl);
  assert.deepEqual(requests, [defaultUrl, url, defaultUrl]);
});

test('migrates the saved Store default on the 1.0.4 update', async t => {
  const requests = [];
  const { storage, listeners } = await useBrowser(t, {
    storage: { configUrl: publishedLegacyUrl, policy: normalizePolicy(policy) },
    fetch: async requestedUrl => {
      requests.push(requestedUrl);
      return Response.json(policy);
    }
  });
  listeners.installed({ reason: 'update', previousVersion: '1.0.4' });
  await setImmediate();
  assert.deepEqual(requests, [defaultUrl]);
  assert.equal(readPolicyState(storage).url, defaultUrl);
  assert.equal(storage.policySourceUrl, defaultUrl);
});

test('keeps a custom URL when updating from 1.0.4', async t => {
  const requests = [];
  const { storage, listeners } = await useBrowser(t, {
    storage: { configUrl: url },
    fetch: async requestedUrl => {
      requests.push(requestedUrl);
      return Response.json(policy);
    }
  });
  listeners.installed({ reason: 'update', previousVersion: '1.0.4' });
  await setImmediate();
  assert.deepEqual(requests, [url]);
  assert.equal(storage.configUrl, url);
  assert.equal(storage.policySourceUrl, url);
});

test('keeps the filename decision open until cancellation has been verified', async t => {
  const cancellation = Promise.withResolvers();
  const cancelIds = [];
  const { listeners, notices } = await useBrowser(t, {
    storage: validCache(),
    downloads: {
      async cancel(id) { cancelIds.push(id); await cancellation.promise; },
      async search() { return [{ state: 'interrupted', error: 'USER_CANCELED' }]; }
    }
  });
  const item = {
    id: 1, url: 'https://web.whatsapp.com/attachment', finalUrl: 'https://files.example/archive.zip',
    filename: 'archive.zip', mime: 'application/zip'
  };
  const finished = Promise.withResolvers();
  let suggestions = 0;
  const callback = () => { suggestions++; finished.resolve(); };
  assert.equal(listeners.filename(item, callback), true);
  await setImmediate();
  assert.deepEqual(cancelIds, [item.id]);
  assert.equal(suggestions, 0);
  cancellation.resolve();
  await finished.promise;
  assert.equal(suggestions, 1);
  assert.match(notices[0], /^Download bloqueado\./);
});

test('reports an already completed WhatsApp blob and leaves another site alone', async t => {
  const { listeners, notices } = await useBrowser(t, {
    storage: validCache(),
    downloads: { async search() { return [{ state: 'complete' }]; } }
  });
  const item = { id: 1, url: 'blob:https://web.whatsapp.com/sample', filename: 'archive.zip' };
  await new Promise(resolve => assert.equal(listeners.filename(item, resolve), true));
  assert.match(notices[0], /já foi concluído/);
  assert.doesNotMatch(notices[0], /^Download bloqueado/);

  let suggestions = 0;
  listeners.filename({ ...item, id: 2, url: 'blob:https://files.example/sample' }, () => suggestions++);
  assert.equal(suggestions, 1);
  assert.equal(notices.length, 1);
});

test('checks completed downloads when Chrome skipped the filename listener', async t => {
  const item = { id: 1, url: 'https://web.whatsapp.com/archive.zip', filename: 'archive.zip' };
  const { listeners, notices } = await useBrowser(t, {
    storage: validCache(),
    downloads: { async search() { return [{ ...item, state: 'complete' }]; } }
  });
  listeners.changed({ id: item.id, state: { current: 'complete' } });
  await setImmediate();
  assert.equal(notices.length, 1);
  assert.match(notices[0], /arquivo pode estar no disco/);
});

test('reports refresh failures and uses the last valid policy only for the same URL', async t => {
  let result = new Response('', { status: 503 });
  const { storage, send } = await useBrowser(t, { storage: validCache(), fetch: async () => result });
  const previous = structuredClone(storage.policy);
  const fetchedAt = storage.policyFetchedAt;
  const failed = await send('refresh-policy');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /HTTP 503/);
  assert.deepEqual(readPolicyState(storage).policy, previous);
  assert.equal(storage.policyFetchedAt, fetchedAt);
  assert.equal(storage.policyRefresh.error, failed.error);

  result = Response.json({ mode: 'unsupported' });
  const changed = await send('save-policy-url', 'https://policy.example/new.json');
  assert.equal(changed.ok, false);
  assert.equal(changed.configured, true);
  assert.equal(readPolicyState(storage).policy, null);
});

test('an obsolete startup refresh cannot overwrite the policy of a newly saved URL', async t => {
  const oldResponse = Promise.withResolvers();
  const requests = [];
  const nextUrl = 'https://policy.example/new.json';
  const { storage, listeners, send } = await useBrowser(t, {
    storage: validCache({ policyFetchedAt: 1 }),
    fetch: async requestedUrl => {
      requests.push(requestedUrl);
      if (requestedUrl === url) return oldResponse.promise;
      return Response.json({ ...policy, allowed: { extensions: ['png'], mime_types: ['image/png'] } });
    }
  });
  listeners.startup();
  await setImmediate();
  assert.deepEqual(requests, [url]);
  const firstRefresh = send('refresh-policy');
  assert.equal((await send('save-policy-url', nextUrl)).ok, true);
  oldResponse.resolve(Response.json(policy));
  assert.equal((await firstRefresh).ok, false);
  assert.deepEqual(requests, [url, nextUrl]);
  assert.equal(storage.policySourceUrl, nextUrl);
  assert.deepEqual(readPolicyState(storage).policy.allowed.extensions, ['png']);
});
