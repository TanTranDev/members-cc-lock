// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as git from '../src/git.mjs';
import {
  makeBareLockRepo, makeDenyingBareRepo, installDenyHook,
  initBareMirror, tmpMirror, unwrap,
} from './helpers.mjs';

/** @param {Partial<LockPayload>} [extra] @returns {LockPayload} */
const payload = (extra = {}) => ({
  relpath: 'src/a.ts', owner: 'cloneA', host: 'h', pid: 1, session: 's',
  acquired_at: 1000, expires_at: 1900, renewed_at: 1000, ...extra,
});

test('ensureMirror clone được bare repo', () => {
  const cfg = { lockRepoUrl: makeBareLockRepo() };
  const r = git.ensureMirror(cfg, tmpMirror());
  assert.equal(r.ok, true);
});

test('pushCreate thành công khi ref trống, "exists" khi đã có', () => {
  const cfg = { lockRepoUrl: makeBareLockRepo() };
  const md = unwrap(git.ensureMirror(cfg, tmpMirror()));
  const ref = 'refs/locks/proj/aaa';
  const sha1 = unwrap(git.commitPayload(md, payload()));
  assert.equal(unwrap(git.pushCreate(cfg, md, ref, sha1)), 'created');
  const sha2 = unwrap(git.commitPayload(md, payload({ owner: 'cloneB' })));
  assert.equal(unwrap(git.pushCreate(cfg, md, ref, sha2)), 'exists');
});

test('readPayload đọc lại JSON đã push', () => {
  const cfg = { lockRepoUrl: makeBareLockRepo() };
  const md = unwrap(git.ensureMirror(cfg, tmpMirror()));
  const ref = 'refs/locks/proj/bbb';
  const sha = unwrap(git.commitPayload(md, payload({ owner: 'cloneX' })));
  git.pushCreate(cfg, md, ref, sha);
  const cur = unwrap(git.lsRemoteRef(cfg, ref));
  assert.equal(cur, sha);
  assert.equal(unwrap(git.readPayload(cfg, md, ref, cur)).owner, 'cloneX');
});

test('pushCas updated với oldSha đúng, lost khi sai', () => {
  const cfg = { lockRepoUrl: makeBareLockRepo() };
  const md = unwrap(git.ensureMirror(cfg, tmpMirror()));
  const ref = 'refs/locks/proj/ccc';
  const s1 = unwrap(git.commitPayload(md, payload()));
  git.pushCreate(cfg, md, ref, s1);
  const s2 = unwrap(git.commitPayload(md, payload({ renewed_at: 1500 })));
  assert.equal(unwrap(git.pushCas(cfg, md, ref, s1, s2)), 'updated');
  const s3 = unwrap(git.commitPayload(md, payload({ renewed_at: 1600 })));
  assert.equal(unwrap(git.pushCas(cfg, md, ref, s1, s3)), 'lost'); // oldSha cũ rồi
});

test('pushDelete xoá ref', () => {
  const cfg = { lockRepoUrl: makeBareLockRepo() };
  const md = unwrap(git.ensureMirror(cfg, tmpMirror()));
  const ref = 'refs/locks/proj/ddd';
  const s = unwrap(git.commitPayload(md, payload()));
  git.pushCreate(cfg, md, ref, s);
  assert.equal(unwrap(git.pushDelete(cfg, md, ref, s)), 'deleted');
  assert.equal(unwrap(git.lsRemoteRef(cfg, ref)), null);
});

test('URL hỏng ⇒ Err offline (không phải exists/lost)', () => {
  const cfg = { lockRepoUrl: '/no/such/repo.git' };
  // lsRemoteRef: không reach được remote ⇒ offline
  const ls = git.lsRemoteRef(cfg, 'refs/locks/proj/x');
  assert.equal(ls.ok, false);
  assert.equal(ls.error, 'offline');
  // pushCreate: dùng mirror tạm rỗng, push tới URL hỏng ⇒ offline (KHÔNG được nuốt thành 'exists')
  const md = initBareMirror();
  const sha = unwrap(git.commitPayload(md, payload()));
  const r = git.pushCreate(cfg, md, 'refs/locks/proj/x', sha);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'offline');
});

test('server từ chối ghi ⇒ Err offline (KHÔNG phải exists)', () => {
  const cfg = { lockRepoUrl: makeDenyingBareRepo() };
  const md = unwrap(git.ensureMirror(cfg, tmpMirror()));
  const ref = 'refs/locks/proj/deny';
  const sha = unwrap(git.commitPayload(md, payload()));
  const r = git.pushCreate(cfg, md, ref, sha);
  // remote rejected (pre-receive hook declined) là lỗi server, fail-closed ⇒ offline
  assert.equal(r.ok, false, `expected Err offline, got ${JSON.stringify(r)}`);
  assert.equal(r.error, 'offline');
});

test('server từ chối ghi trên pushCas/pushDelete ⇒ Err offline (KHÔNG phải lost)', () => {
  // Seed ref khi repo còn cho ghi để lease khớp ref thật, RỒI mới bật deny hook —
  // nhờ vậy push chạy tới hook ⇒ `[remote rejected]` (chứ không thua lease sớm).
  const cfg = { lockRepoUrl: makeBareLockRepo() };
  const md = unwrap(git.ensureMirror(cfg, tmpMirror()));
  const ref = 'refs/locks/proj/deny2';
  const s1 = unwrap(git.commitPayload(md, payload()));
  assert.equal(unwrap(git.pushCreate(cfg, md, ref, s1)), 'created');
  installDenyHook(cfg.lockRepoUrl);
  const s2 = unwrap(git.commitPayload(md, payload({ renewed_at: 1500 })));
  const rCas = git.pushCas(cfg, md, ref, s1, s2);
  assert.equal(rCas.ok, false, `pushCas: expected Err offline, got ${JSON.stringify(rCas)}`);
  assert.equal(rCas.error, 'offline');
  const rDel = git.pushDelete(cfg, md, ref, s1);
  assert.equal(rDel.ok, false, `pushDelete: expected Err offline, got ${JSON.stringify(rDel)}`);
  assert.equal(rDel.error, 'offline');
});
