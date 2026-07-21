---
name: cc-lock-release
description: cc-lock — trả khoá cho một file (chỉ xoá ref nếu ta là chủ; luôn dọn cache). Gọi ngay khi đã xong một file để clone/session khác vào mà không phải đợi hết TTL.
argument-hint: <relpath>
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
File cần trả khoá: `$ARGUMENTS`

Chạy lệnh Bash sau:

```
node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock release "$ARGUMENTS"
```

`{"status":"released"}` ⇒ đã trả khoá. Báo ngắn gọn cho người dùng.
