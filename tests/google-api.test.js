import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_CLIENT_ID } from '../public/config.js';

// google-api.js reads window, google and fetch when called; this file plays the browser (and HQ, the Mac app).
globalThis.window = globalThis;
const FILE = 'https://www.googleapis.com/auth/drive.file', EMAIL = 'https://www.googleapis.com/auth/userinfo.email';
const ALL = `${FILE} ${EMAIL} openid`;
let fetched = [];
globalThis.fetch = async (url, init) => {
  fetched.push({ url: String(url), auth: init.headers.Authorization });
  const body = String(url).includes('/userinfo') ? { email: 'tutor@example.com' } : { files: [] };
  return { ok: true, status: 200, json: async () => body };
};
const { auth, api } = await import('../public/google-api.js');

/** HQ's window.hqGoogleAuth: answers getToken from `answers` in order and logs every call. */
function fakeHQ(...answers) {
  const log = [];
  window.hqGoogleAuth = {
    available: true,
    async getToken(options) { log.push(['getToken', options.interactive]); const a = answers.shift(); if (a instanceof Error) throw a; return a; },
    async signOut() { log.push(['signOut']); },
  };
  return log;
}
const coded = (code, message = 'HQ says no') => Object.assign(new Error(message), { code });
function noPopups() {
  globalThis.google = { accounts: { oauth2: { initTokenClient() { throw new Error('the Google popup was used'); }, hasGrantedAllScopes() { return true; } } } };
}
function reset() { delete window.hqGoogleAuth; auth.signOut(); fetched = []; noPopups(); }

test('in HQ, sign-in takes the token from HQ instead of a Google popup', async () => {
  reset();
  const log = fakeHQ({ access_token: 'ya29.hq', expires_in: 3599, scope: ALL });
  await auth.signIn();
  assert.deepEqual(log, [['getToken', true]]);
  assert.deepEqual(fetched, [{ url: 'https://www.googleapis.com/oauth2/v2/userinfo', auth: 'Bearer ya29.hq' }]);
  const state = await api('getState');
  assert.equal(state.email, 'tutor@example.com');
  assert.equal(fetched.at(-1).auth, 'Bearer ya29.hq');
});

test('in HQ, sign-in failures keep the page\'s own messages', async () => {
  const cases = [
    [coded('cancelled'), 'Google sign-in was cancelled or denied.'],
    [coded('scopes_denied'), 'Allow invoice-file access and your email address to use Tutor Log.'],
    [{ access_token: 'x', expires_in: 3599, scope: `${EMAIL} openid` }, 'Allow invoice-file access and your email address to use Tutor Log.'],
    [coded('user_gesture_required', 'Click sign in again.'), 'Click sign in again.'],
    [coded('network', 'Couldn\'t reach Google.'), 'Couldn\'t reach Google.'],
  ];
  for (const [answer, message] of cases) {
    reset();
    const log = fakeHQ(answer);
    await assert.rejects(auth.signIn(), { message });
    assert.deepEqual(fetched, [], 'no API call without a token');
    assert.ok(!log.some(([op]) => op === 'signOut'), 'a failed sign-in leaves HQ\'s stored sign-in alone');
  }
});

test('in HQ, an expired token is renewed silently before a request', async () => {
  reset();
  // 30 s left is inside the page's one-minute margin, so it counts as expired straight away.
  const log = fakeHQ({ access_token: 'ya29.old', expires_in: 30, scope: ALL }, { access_token: 'ya29.new', expires_in: 3599, scope: ALL });
  await auth.signIn();
  assert.deepEqual(log, [['getToken', true], ['getToken', false]]);
  assert.equal(fetched[0].auth, 'Bearer ya29.new');
});

test('in HQ, a failed silent renewal shows the page\'s session-expired message and keeps HQ\'s sign-in', async () => {
  reset();
  const log = fakeHQ({ access_token: 'ya29.old', expires_in: 30, scope: ALL }, coded('network'));
  await assert.rejects(auth.signIn(), { message: 'Your Google session expired. Sign out and sign in again, then retry.' });
  assert.deepEqual(log, [['getToken', true], ['getToken', false]]);
  assert.deepEqual(fetched, []);
});

test('in HQ, signing out also signs out of HQ', async () => {
  reset();
  const log = fakeHQ({ access_token: 'ya29.hq', expires_in: 3599, scope: ALL });
  await auth.signIn();
  auth.signOut();
  await Promise.resolve();
  assert.deepEqual(log, [['getToken', true], ['signOut']]);
  await assert.rejects(api('getState'), { message: 'Your Google session expired. Sign out and sign in again, then retry.' });
});

test('in a browser, sign-in uses Google\'s token client exactly as before', async () => {
  for (const hq of [undefined, { available: false }]) {
    reset();
    if (hq) window.hqGoogleAuth = hq;
    let config, prompt;
    globalThis.google = { accounts: { oauth2: {
      initTokenClient(c) { config = c; return { requestAccessToken(o) { prompt = o.prompt; c.callback({ access_token: 'ya29.web', expires_in: 3599 }); } }; },
      hasGrantedAllScopes(r, ...s) { return r.access_token === 'ya29.web' && s.join(' ') === `${FILE} ${EMAIL}`; },
    } } };
    await auth.signIn();
    assert.equal(config.client_id, GOOGLE_CLIENT_ID);
    assert.equal(config.scope, `${FILE} ${EMAIL}`);
    assert.equal(config.include_granted_scopes, false);
    assert.equal(prompt, 'select_account');
    assert.deepEqual(fetched, [{ url: 'https://www.googleapis.com/oauth2/v2/userinfo', auth: 'Bearer ya29.web' }]);
    auth.signOut();
  }
});
