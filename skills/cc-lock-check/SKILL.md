---
name: cc-lock-check
description: cc-lock — soi trạng thái khoá của một file (không cố giành). Cho biết file đang trống, của mình, hay do clone khác giữ + owner.
argument-hint: <relpath>
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
File cần soi khoá: `$ARGUMENTS`

Chạy lệnh Bash sau:

```
node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock check "$ARGUMENTS"
```

Diễn giải `status`: `free` (trống) · `mine` (của clone này) · `held` (clone khác giữ — xem `payload.owner`) · `stale` (hết hạn, có thể reclaim). Báo cho người dùng.
