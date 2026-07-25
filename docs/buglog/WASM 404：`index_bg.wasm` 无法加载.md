## WASM 404：`index_bg.wasm` 无法加载

> **状态**: 🟢 已修复

**日期**: 2026-07-09
**严重程度**: 🔴 P1（启动失败，WASM 运行时无法加载）
**影响范围**: `frontend/vite.config.ts`（Vite 预打包配置）
**发现方式**: 开发发现
**修复方案**: `vite.config.ts` 添加 `optimizeDeps.exclude: ['babylon-mmd']`

### 错误信息
```
Failed to load resource: the server responded with a status of 404 (Not Found)
...node_modules/.vite/deps/index_bg.wasm
```

### 根因
Vite 预打包 babylon-mmd 时，`new URL('index_bg.wasm', import.meta.url)` 指向 `.vite/deps/` 下的路径，但 WASM 文件不在那里。

### 修复
`vite.config.ts` 添加 `optimizeDeps.exclude: ['babylon-mmd']`，让 Vite 跳过预打包，保持原始 import.meta.url 指向源文件位置。

---
