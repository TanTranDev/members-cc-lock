---
name: cc-lock-renew
description: cc-lock — gia hạn (heartbeat thủ công) khoá đang giữ cho một file, đẩy expires_at ra xa. Thường hook tự renew nền; dùng khi cần gia hạn tay.
argument-hint: <relpath>
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
File cần gia hạn khoá: `$ARGUMENTS`

Chạy lệnh Bash sau:

```
node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock renew "$ARGUMENTS"
```

Báo kết quả cho người dùng.
