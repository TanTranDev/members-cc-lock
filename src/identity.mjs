// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { stateDir } from './paths.mjs';

/** @param {string} repoRoot @returns {string} */
export function cloneId(repoRoot) {
  const p = path.join(stateDir(repoRoot), 'cc-lock-clone-id');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* create */ }
  const id = `${os.hostname()}-${randomUUID().slice(0, 8)}`;
  fs.writeFileSync(p, id + '\n');
  return id;
}

export const host = () => os.hostname();

/** @param {NodeJS.ProcessEnv} [env] */
export const session = (env = process.env) => env.CLAUDE_SESSION_ID || `pid${process.pid}`;
