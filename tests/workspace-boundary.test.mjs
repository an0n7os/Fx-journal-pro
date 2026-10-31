import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';
const { needsWorkspace } = await tsImport('../src/lib/workspaceBoundary.ts', import.meta.url);
test('anonymous marketing and auth routes can load without the dashboard bundle', () => {
  for (const path of ['/', '/features', '/FEATURES/', '/pricing', '/login', '/register', '/forgot-password', '/mt5-sync']) {
    assert.equal(needsWorkspace(path, '?ref=PARTNER', '#pricing', false), false, path);
  }
});
test('stored sessions, protected routes and unknown routes retain existing auth bootstrap', () => {
  assert.equal(needsWorkspace('/features', '', '', true), true);
  for (const path of ['/dashboard', '/journal', '/accounts', '/admin', '/settings', '/not-a-route']) {
    assert.equal(needsWorkspace(path, '', '', false), true, path);
  }
});
test('OAuth callbacks and shared/legal pages retain their existing handlers', () => {
  assert.equal(needsWorkspace('/', '?code=auth_code&ref=PARTNER', '', false), true);
  assert.equal(needsWorkspace('/', '', '#access_token=token', false), true);
  assert.equal(needsWorkspace('/', '', '#error_description=denied', false), true);
  for (const path of ['/shared/testtoken', '/share/testtoken', '/terms', '/privacy', '/contact', '/about-us']) {
    assert.equal(needsWorkspace(path, '', '', false), true, path);
  }
});
