import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, resolveEnabled, isConfigured } from '../src/config.mjs';
import { nowSec } from '../src/clock.mjs';

function tmpRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cfg-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

test('nowSec đọc CC_LOCK_FAKE_NOW', () => {
  assert.equal(nowSec({ CC_LOCK_FAKE_NOW: '1000' }), 1000);
});

test('loadConfig merge default + file', () => {
  const r = tmpRepo();
  fs.writeFileSync(path.join(r, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl: 'x', projectKey: 'p', ttlSec: 10 }));
  const cfg = loadConfig(r);
  assert.equal(cfg.ttlSec, 10);          // từ file
  assert.equal(cfg.heartbeatSec, 300);   // từ default
  assert.deepEqual(cfg.guardedTools, ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
});

test('isConfigured: false khi lockRepoUrl rỗng hoặc còn placeholder <...>', () => {
  assert.equal(isConfigured({ lockRepoUrl: '', projectKey: 'p' }), false); // rỗng
  assert.equal(isConfigured({ lockRepoUrl: 'git@github.com:<org>/cc-locks.git', projectKey: 'p' }), false); // placeholder
  assert.equal(isConfigured({ lockRepoUrl: 'git@github.com:acme/cc-locks.git', projectKey: 'p' }), true); // đủ cả hai
});

test('isConfigured: false khi projectKey rỗng hoặc placeholder (chặn đụng namespace dự án khác khi port)', () => {
  const url = 'git@github.com:acme/cc-locks.git';
  assert.equal(isConfigured({ lockRepoUrl: url }), false); // thiếu projectKey
  assert.equal(isConfigured({ lockRepoUrl: url, projectKey: '' }), false); // rỗng
  assert.equal(isConfigured({ lockRepoUrl: url, projectKey: '<project-slug>' }), false); // placeholder
});

test('loadConfig: override per-clone (.git/cc-lock-local.json) đè config chung', () => {
  const r = tmpRepo();
  fs.writeFileSync(path.join(r, '.claude', 'cc-lock.config.json'),
    JSON.stringify({ lockRepoUrl: 'git@<host>:<org>/cc-locks.git', projectKey: '<project-slug>' }));
  fs.writeFileSync(path.join(r, '.git', 'cc-lock-local.json'),
    JSON.stringify({ lockRepoUrl: 'git@real.example:me/locks.git', projectKey: 'my-proj' }));
  const cfg = loadConfig(r);
  assert.equal(cfg.lockRepoUrl, 'git@real.example:me/locks.git');
  assert.equal(cfg.projectKey, 'my-proj');
  assert.equal(cfg.ttlSec, 900); // default vẫn còn
});

test('resolveEnabled: env > local > config > default', () => {
  const r = tmpRepo();
  const cfg = { enabled: true };
  // env thắng
  assert.deepEqual(resolveEnabled(r, cfg, { CC_LOCK: 'off' }), { enabled: false, source: 'env' });
  // local thắng config
  fs.writeFileSync(path.join(r, '.git', 'cc-lock-local.json'), JSON.stringify({ enabled: false }));
  assert.deepEqual(resolveEnabled(r, cfg, {}), { enabled: false, source: 'local' });
  fs.rmSync(path.join(r, '.git', 'cc-lock-local.json'));
  // config thắng default
  assert.deepEqual(resolveEnabled(r, { enabled: false }, {}), { enabled: false, source: 'config' });
  // default
  assert.deepEqual(resolveEnabled(r, {}, {}), { enabled: true, source: 'default' });
});
