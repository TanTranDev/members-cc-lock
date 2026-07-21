---
name: cc-lock-acquire
description: cc-lock — chủ động giành khoá cho một file. Thường hook PreToolUse tự giành khi Edit/Write; dùng lệnh này khi muốn giữ trước một file sắp sửa.
argument-hint: <relpath>
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
File cần giành khoá: `$ARGUMENTS`

Chạy lệnh Bash sau:

```
node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock acquire "$ARGUMENTS"
```

Diễn giải `status`: `acquired`/`already-mine`/`reclaimed` ⇒ đã giữ được, sửa file đi. `held` ⇒ clone khác đang giữ, dùng `/cc-lock-wait $ARGUMENTS` để xếp hàng (đừng huỷ task). `unconfigured`/`disabled` ⇒ cc-lock đang trơ/tắt.
