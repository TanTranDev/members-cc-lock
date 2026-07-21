// @ts-check
/** @param {NodeJS.ProcessEnv} [env] @returns {number} */
export function nowSec(env = process.env) {
  if (env.CC_LOCK_FAKE_NOW) return Number(env.CC_LOCK_FAKE_NOW);
  return Math.floor(Date.now() / 1000);
}
