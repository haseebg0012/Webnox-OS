// M0 covers deployment plumbing only. M2 adds the PGlite schema and the first
// cross-workspace isolation test here, before any business feature is built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';

const configured = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture',
  SUPABASE_SECRET_KEY: 'sb_secret_server_only_fixture',
  SITE_URL: 'https://fixture.example',
};

async function withServer(env, run) {
  const server = createApp(env).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('public config releases exactly the two browser-safe values', async () => {
  await withServer(configured, async base => {
    const response = await fetch(`${base}/api/config`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      supabaseUrl: configured.SUPABASE_URL,
      supabasePublishableKey: configured.SUPABASE_PUBLISHABLE_KEY,
    });
  });
});

test('missing or malformed config fails closed without leaking values', async () => {
  const legacyServiceKey = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  const invalid = [
    {},
    { ...configured, SUPABASE_URL: '' },
    { ...configured, SUPABASE_URL: 'not-a-url' },
    { ...configured, SUPABASE_URL: 'http://remote.example' },
    { ...configured, SUPABASE_URL: 'https://user:password@fixture.supabase.co' },
    { ...configured, SUPABASE_PUBLISHABLE_KEY: configured.SUPABASE_SECRET_KEY },
    { ...configured, SUPABASE_PUBLISHABLE_KEY: legacyServiceKey },
    { ...configured, SUPABASE_PUBLISHABLE_KEY: 'random-value' },
  ];
  for (const env of invalid) await withServer(env, async base => {
    const response = await fetch(`${base}/api/config`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Service is not configured yet.' });
  });
});

test('legacy anon keys remain supported without accepting privileged JWT roles', async () => {
  const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  await withServer({ ...configured, SUPABASE_PUBLISHABLE_KEY: key }, async base => {
    const response = await fetch(`${base}/api/config`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).supabasePublishableKey, key);
  });
});

test('private source, keys and attachment paths cannot be downloaded', async () => {
  await withServer(configured, async base => {
    for (const pathname of ['/.env', '/Files/.env', '/.git/config', '/server.js', '/package.json', '/docs/00-README.md']) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 404, pathname);
      assert.ok(!(await response.text()).includes(configured.SUPABASE_SECRET_KEY));
    }
  });
});

test('Master entry resolves without exposing a link on the public page', async () => {
  await withServer(configured, async base => {
    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.ok(html.includes('Webnox OS'));
    assert.ok(!html.includes('/master-login'));
    for (const pathname of ['/master-login', '/master-login.html']) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.match(await response.text(), /name="robots" content="noindex, nofollow"/);
    }
  });
});

test('unimplemented APIs have the same neutral response', async () => {
  await withServer(configured, async base => {
    for (const pathname of ['/api/members', '/api/master/workspaces', '/api/unknown']) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'Not found.' });
    }
  });
});
