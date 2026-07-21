import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyPath } from '../src/paths.mjs';

/** @param {string} prefix @returns {string} */
const tmpDir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
function tmpRepo() {
  const dir = tmpDir('cc-cls-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('file thường trong repo ⇒ inside + relpath', () => {
  const r = tmpRepo();
  fs.mkdirSync(path.join(r, 'src'));
  fs.writeFileSync(path.join(r, 'src', 'a.ts'), '');
  assert.deepEqual(classifyPath(r, path.join(r, 'src', 'a.ts')), { kind: 'inside', relpath: 'src/a.ts' });
});

test('file lexically ngoài repo ⇒ outside (hành vi v1 giữ nguyên)', () => {
  const r = tmpRepo();
  assert.deepEqual(classifyPath(r, path.join(r, '..', 'x.ts')), { kind: 'outside' });
});

test('symlink FOLDER trỏ ra ngoài (kịch bản .claude bộ khung) ⇒ escape + realpath', () => {
  const framework = tmpDir('cc-fw-');
  fs.mkdirSync(path.join(framework, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(framework, 'skills', 's.md'), 'x');
  const r = tmpRepo();
  fs.symlinkSync(framework, path.join(r, '.claude'));
  const got = classifyPath(r, path.join(r, '.claude', 'skills', 's.md'));
  assert.equal(got.kind, 'escape');
  assert.equal(got.realpath, path.join(framework, 'skills', 's.md'));
});

test('file CHƯA tồn tại dưới folder symlink ⇒ vẫn escape (Write file mới)', () => {
  const framework = tmpDir('cc-fw-');
  const r = tmpRepo();
  fs.symlinkSync(framework, path.join(r, '.claude'));
  assert.equal(classifyPath(r, path.join(r, '.claude', 'moi.md')).kind, 'escape');
});

test('symlink FILE trỏ ra ngoài (CLAUDE.md symlink) ⇒ escape', () => {
  const outside = tmpDir('cc-out-');
  fs.writeFileSync(path.join(outside, 'real.md'), 'x');
  const r = tmpRepo();
  fs.symlinkSync(path.join(outside, 'real.md'), path.join(r, 'CLAUDE.md'));
  assert.equal(classifyPath(r, path.join(r, 'CLAUDE.md')).kind, 'escape');
});

test('symlink NỘI BỘ repo ⇒ inside với relpath THẬT (canonical — không bị oan)', () => {
  const r = tmpRepo();
  fs.mkdirSync(path.join(r, 'src'));
  fs.writeFileSync(path.join(r, 'src', 'real.ts'), '');
  fs.symlinkSync(path.join(r, 'src', 'real.ts'), path.join(r, 'alias.ts'));
  assert.deepEqual(classifyPath(r, path.join(r, 'alias.ts')), { kind: 'inside', relpath: 'src/real.ts' });
});
