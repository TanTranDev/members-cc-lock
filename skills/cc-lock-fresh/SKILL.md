---
name: cc-lock-fresh
description: cc-lock — soi file có stale so với mainline không (probe freshness). Cho biết file có bị đổi trên mainline sau điểm rẽ nhánh hiện tại không, kèm mainline ref và commit gây stale. Hoạt động kể cả khi freshnessMode của repo đang là "off".
argument-hint: <relpath>
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
File cần soi freshness: `$ARGUMENTS`

Chạy lệnh Bash sau:

```
node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock fresh "$ARGUMENTS"
```

Diễn giải `status`: `fresh` (file chưa đổi trên mainline sau fork point — an toàn để sửa) · `stale` (file ĐÃ đổi trên mainline — kèm `mainline` và commit gây stale, nên rebase trước khi sửa tiếp) · `skip` (không kiểm được — vd repo không có mainline ref, hoặc offline chưa từng fetch — advisory fail-open, không chặn). Báo cho người dùng; gặp `stale` ⇒ theo skill `cc-lock-coordination` nhánh SB.
