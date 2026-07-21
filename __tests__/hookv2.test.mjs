// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeBareLockRepo } from './helpers.mjs';

const bin = path.resolve(import.meta.dirname, '..', 'bin', 'cc-lock');
const GITC = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
/** @param {string} cwd @param {...string} a */
const git = (cwd, ...a) => execFileSync('git', [...GITC, ...a], { cwd, encoding: 'utf8' }).trim();
/** @param {string} p */
const tmp = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

/**
 * Chạy hook-guard với stdin JSON; trả {code, stderr}.
 * @param {string} cwd @param {string} filePath @param {Record<string,string>} [env]
 */
function runHook(cwd, filePath, env = {}) {
  try {
    const out = execFileSync(process.execPath, [bin, 'hook-guard'], {
      cwd,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Edit', cwd, tool_input: { file_path: filePath } }),
      env: { ...process.env, CC_LOCK_CACHE_DIR: tmp('cc-hv2-cache-'), ...env },
    });
    return { code: 0, stderr: '', stdout: String(out) };
  } catch (/** @type {any} */ e) {
    return { code: e.status, stderr: String(e.stderr), stdout: String(e.stdout ?? '') };
  }
}

/**
 * Repo sản phẩm symlink .claude → framework dir; config đặt TRONG framework.
 * @param {object} configJson
 */
function symlinkedWork(configJson) {
  const framework = tmp('cc-hv2-fw-');
  fs.mkdirSync(path.join(framework, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(framework, 'skills', 's.md'), 'x');
  fs.writeFileSync(path.join(framework, 'cc-lock.config.json'), JSON.stringify(configJson));
  const work = tmp('cc-hv2-w-');
  execFileSync('git', ['init', '-q'], { cwd: work });
  fs.symlinkSync(framework, path.join(work, '.claude'));
  return { framework, work };
}

test('hook-guard: sửa file qua symlink .claude (bộ khung) ⇒ DENY symlink-escape', () => {
  const { work } = symlinkedWork({ lockRepoUrl: makeBareLockRepo(), projectKey: 'p' });
  const r = runHook(work, path.join(work, '.claude', 'skills', 's.md'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /SYMLINK-ESCAPE/);
});

test('hook-guard: chưa config (trơ) ⇒ escape cũng cho qua — không brick fresh clone', () => {
  const { work } = symlinkedWork({ lockRepoUrl: 'git@<host>:<org>/locks.git', projectKey: '<slug>' });
  assert.equal(runHook(work, path.join(work, '.claude', 'skills', 's.md')).code, 0);
});

test('hook-guard: CC_LOCK_BYPASS bỏ qua lớp escape (vượt rào khẩn cấp, có audit)', () => {
  const { work } = symlinkedWork({ lockRepoUrl: makeBareLockRepo(), projectKey: 'p' });
  const r = runHook(work, path.join(work, '.claude', 'skills', 's.md'), { CC_LOCK_BYPASS: '1' });
  assert.equal(r.code, 0);
});

/** Fixture git-flow: origin develop v1, mine rẽ task từ v1, v2 đã lên develop. */
function staleWork() {
  const origin = path.join(tmp('cc-hv2-o-'), 'o.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'develop', origin]);
  const otherBase = tmp('cc-hv2-a-');
  git(otherBase, 'clone', '-q', origin, 'w');
  const other = path.join(otherBase, 'w');
  fs.writeFileSync(path.join(other, 'f.txt'), 'v1');
  git(other, 'checkout', '-q', '-b', 'develop');
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'v1');
  git(other, 'push', '-q', 'origin', 'develop');
  const mineBase = tmp('cc-hv2-b-');
  git(mineBase, 'clone', '-q', origin, 'w');
  const mine = path.join(mineBase, 'w');
  git(mine, 'checkout', '-q', '-b', 'task', 'origin/develop');
  fs.writeFileSync(path.join(other, 'f.txt'), 'v2');
  git(other, 'commit', '-aqm', 'v2');
  git(other, 'push', '-q', 'origin', 'develop');
  fs.mkdirSync(path.join(mine, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(mine, '.claude', 'cc-lock.config.json'), JSON.stringify({
    lockRepoUrl: makeBareLockRepo(), projectKey: 'p',
    mainlineRef: 'origin/develop', freshnessMode: 'deny', fetchThrottleSec: 0,
  }));
  return mine;
}

test('hook-guard: stale-base + deny ⇒ DENY kèm hướng dẫn rebase; file khác ⇒ qua', () => {
  const mine = staleWork();
  const r = runHook(mine, path.join(mine, 'f.txt'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /STALE-BASE/);
  assert.match(r.stderr, /git rebase origin\/develop/);
  assert.equal(runHook(mine, path.join(mine, 'khac.txt')).code, 0);
});

test('hook-guard: stale-base + warn ⇒ exit 0 + systemMessage (không chặn)', () => {
  const mine = staleWork();
  const cfgPath = path.join(mine, '.claude', 'cc-lock.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, freshnessMode: 'warn' }));
  const r = runHook(mine, path.join(mine, 'f.txt'));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /systemMessage/);
});
