// Shared ambient type definitions for cc-lock.
// Declared globally so JSDoc annotations in every .mjs source can reference
// these names (Result, LockPayload, HeldEntry, CcLockConfig) without importing.
export {};

declare global {
  type Result =
    | { ok: true; value: any }
    | { ok: false; error: string };

  type LockPayload = {
    relpath: string;
    owner: string;
    host: string;
    pid: number;
    session: string;
    acquired_at: number;
    expires_at: number;
    renewed_at: number;
  };

  type HeldEntry = {
    relpath: string;
    ref: string;
    sha: string;
    expires_at: number;
  };

  type CcLockConfig = {
    enabled: boolean;
    lockRepoUrl: string;
    projectKey: string;
    refNamespace: string;
    ttlSec: number;
    heartbeatSec: number;
    skewSec: number;
    waitPollSec: number;
    offlinePolicy: 'fail-closed' | 'fail-open';
    guardedTools: string[];
  };
}
