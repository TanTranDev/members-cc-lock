---
name: cc-lock-wait
description: cc-lock — xếp hàng chờ tới khi một file đang bị khoá rảnh rồi tự giành khoá. Dùng khi bị DENY và muốn tiếp tục sửa đúng file đó. KHÔNG BAO GIỜ huỷ task vì bị khoá — hãy chờ.
argument-hint: <relpath>
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock *)
---
File cần chờ khoá: `$ARGUMENTS`

Chạy lệnh Bash sau. Nó tự poll (có jitter) tới khi file rảnh hoặc hết timeout (mặc định 10 phút), rồi in JSON kết quả:

```
node "${CLAUDE_SKILL_DIR}"/../../bin/cc-lock wait "$ARGUMENTS"
```

Diễn giải kết quả:
- `{"status":"acquired"}` / `{"status":"reclaimed"}` ⇒ đã giành được khoá — tiếp tục sửa file này.
- `{"status":"already-mine"}` ⇒ vốn đã là của mình — cứ sửa.
- `{"status":"timeout"}` ⇒ chưa rảnh sau timeout — thử lại lệnh này, hoặc chuyển sang làm file khác trong lúc chờ. **Tuyệt đối không đánh dấu task thất bại chỉ vì bị khoá** (xem skill `cc-lock-coordination`).
