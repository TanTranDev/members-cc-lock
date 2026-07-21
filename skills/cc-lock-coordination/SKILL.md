---
name: cc-lock-coordination
description: Use BEFORE editing files that other sessions may also touch (shared/high-traffic files, config, anything multiple branches change), AND whenever a cc-lock PreToolUse DENY appears (message "🔒 … is held by …", or offline-deny / fail-closed). cc-lock serializes concurrent Claude Code sessions across clones/worktrees via a shared lock-repo. On a DENY the correct move is to WAIT and retry, never to abandon the task. Triggers on: cc-lock, DENY, "is held by", "đang bị giữ", file lock, multi-session, lock collision, parallel agents.
---

# cc-lock — Multi-session collision coordination

cc-lock hard-blocks (DENY) a write when another clone/session currently holds that
file. **A DENY is NOT a tool error** — it surfaces a coordination fact: two or more
sessions want the same file. The lock is **transient**; the holder will release it
(explicitly, or automatically when its TTL expires). This skill has two branches:
**prevention** (before you touch a contended file) and **handling** (when you hit a DENY).

## The one hard rule

**A DENY never cancels the task.** Do not report the task as blocked, failed, or
impossible because a file is locked. Instead: **queue and poll (~every 30s) until the
lock frees, then proceed** — or reorder your work to a file that is free right now and
come back. The lock is temporary; your job is to wait it out or work around it, not to
give up.

## Branch A — PREVENTION (before editing a file others may share)

1. If the file is shared / high-traffic (config, lockfiles, files many branches edit),
   run `/cc-lock-list` (or `cc-lock list`) to see whether another session holds an
   overlapping file.
2. Someone holds it ⇒ **serialize**: reorder your work (do your own isolated files
   first), or `/cc-lock-wait <relpath>` to queue. Do not run two sessions with
   overlapping write-scope in parallel.
3. Files that many branches append to (shared baselines, generated manifests) ⇒ edit
   them **last**, after rebasing onto the latest mainline, to minimize contention.

## Branch B — HANDLING (when you get a DENY)

Legend: 🤖 = agent does autonomously · 🛑 = STOP, show the intended command and wait for
user approval.

- **B0 🤖 Diagnose.** Run `/cc-lock-status`, `/cc-lock-list`, `/cc-lock-mine`. Compare the
  lock `owner` against your own clone-id (the `clone:` line in `cc-lock status`).
  - Same clone-id ⇒ it is your own lock; the write will pass (retry the edit).
  - Different clone-id + `active: true` + lock still valid ⇒ a real collision.
  - ⚠️ Same host ≠ same clone — compare the **full** clone-id.
- **B1 🤖 Do NOT `CC_LOCK_BYPASS`.** Only bypass when the lock-repo itself is dead AND
  there is an urgent, stated reason. A subagent should return `NEEDS_ADVICE` rather than
  guess. Bypassing steals a lock and causes merge conflicts.
- **B2 🤖 Partial-proceed.** Work immediately on files that are NOT locked; defer the
  locked one. Never block the whole task on one file.
- **B3 🤖 Wait it out (poll ~30s), do NOT abandon.** For the locked file run
  `/cc-lock-wait <relpath>` — it queues and auto-retries until the lock frees, then
  grabs it. If you poll manually instead, re-check with `/cc-lock-list` about every 30
  seconds; resume the edit the moment the file is free. Keep the task alive throughout.
- **B4 🤖 Release early.** After you finish a file you hold, `/cc-lock-release <relpath>`
  so the next session gets in without waiting for the TTL.
- **B5 🛑 Clean-up / rebase / push need approval.** If handling the collision means
  deleting a half-written file, rebasing, or pushing, present the exact command and wait
  for the user. Never run `rm` / `git rebase` / `git push` on your own.

## Hard principles

- DENY + a **different** clone-id + `active: true` = a **real scope collision**. Don't dig
  into the tool internals — coordinate: defer, serialize, or wait.
- **Never give up on the task because of a lock.** Waiting ~30s and retrying is the
  expected path; the holder will release soon.
- Never autonomously `rm` / `git rebase` / `git push` — always show the command and wait.
- Confirm the collision cleared: `/cc-lock-list` shows the file free (or held by your own
  clone-id); `/cc-lock-mine` is empty after you finish.

## Reference

- Full CLI + git-refs-CAS mechanism: the plugin's `README.md`.
- Slash commands provided by this plugin: `/cc-lock-status`, `/cc-lock-list`,
  `/cc-lock-mine`, `/cc-lock-wait`, `/cc-lock-release`, `/cc-lock-release-all`,
  `/cc-lock-check`, `/cc-lock-renew`, `/cc-lock-gc`, `/cc-lock-on`, `/cc-lock-off`,
  `/cc-lock-init`, `/cc-lock-setup`.
