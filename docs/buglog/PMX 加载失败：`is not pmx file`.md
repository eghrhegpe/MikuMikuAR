## PMX 加载失败：`is not pmx file`

### 错误信息
```
✗ 加载失败: Unable to load from binary data: is not pmx file
```

### 根因（已通过 HTTP 服务器方案消除）

~~Wails v2 将 Go `[]byte` 序列化为 base64 传给前端，JS 侧解码后得到 `Uint8Array`。但 Wails 底层可能使用**共享池 buffer**，导致 `Uint8Array.buffer` 指向整个池（而非文件数据的实际起始位置）。~~

现已改用 Go HTTP 文件服务器 + `ImportMeshAsync(url)`，不走桥接传递二进制，该问题不再出现。

---
