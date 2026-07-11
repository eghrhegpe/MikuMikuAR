# 第⑥轮审核 — perception.ts _writeMatToBuffer 优化

**日期**: 2026-07-11
**发现方式**: 代码审核（第⑥轮）

---

## 修复: _writeMatToBuffer for 循环 → buf.set()

**严重程度**: P3 — 热路径性能

`_writeMatToBuffer` 是 WASM 图层混合的核心热路径函数，每帧每个骨骼调用一次。原实现用 `for` 循环逐元素拷贝 16 个 float，改用 `Float32Array.set()` 单次 memcpy 可利用引擎内部批量拷贝优化。

```typescript
// 修复前
const a = m.asArray();
for (let i = 0; i < 16; ++i) {
    buf[i] = a[i];
}

// 修复后
buf.set(m.asArray());
```

在 774 骨 PMX 模型上，此函数每帧调用约 774 次（每个骨骼一次）。`buf.set()` 的引擎内部实现通常使用 `TypedArray.set()` 原生 memcpy，比 JS for 循环快 2-5 倍。
