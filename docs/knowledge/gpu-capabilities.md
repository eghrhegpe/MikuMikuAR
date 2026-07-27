---
kind: gpu_capabilities
name: GPU 压缩纹理能力探测
category: rendering
scope:
  - core/gpu-capabilities.ts
source_files:
  - frontend/src/core/gpu-capabilities.ts
adr:
  - ADR-189
symbols:
  - detectKtx2Support
  - Ktx2Capability
  - Ktx2PreferredFormat
  - _resetKtx2CacheForTest
invariants:
  - 探测结果缓存，避免重复创建 canvas + WebGL context
  - Node.js 环境（测试）保守返回 { supported: false, preferredFormat: null }
  - 优先级：ASTC（移动端）> BC7（桌面）> ETC2（WebGL2 强制兜底）
tests:
  - 间接覆盖：单测 mock WebGL context
use_when:
  - GPU 能力
  - 压缩纹理
  - KTX2
  - ASTC
  - BC7
  - ADR-189
---

## 系统概览

GPU 压缩纹理（KTX2）能力探测模块（ADR-189 Phase 0 基础设施）。通过临时 canvas 创建 WebGL2 context 探测 GPU 扩展支持，结果缓存避免重复探测。探测优先级：ASTC（移动端现代 GPU）> BC7（桌面）> ETC2（WebGL2 强制兜底）。

## 核心职责

- `gpu-capabilities.ts` — GPU 压缩纹理扩展探测

## 对外 API（节选）

- `detectKtx2Support()` — 探测 GPU 对 KTX2 压缩纹理的支持。返回 `{supported, preferredFormat}`。结果缓存，首次调用后永久有效
- `_resetKtx2CacheForTest()` — 仅供测试使用，重置缓存

## 与其他子系统关系

- 被纹理加载路径（`model-loader.ts`）在加载 KTX2 纹理前调用，决定加载格式
- 独立于 Babylon.js Engine（在 Engine 创建前即可调用）

## 不变量

- 探测结果缓存，避免重复创建 canvas + WebGL context
- Node.js 环境（测试/SSR）保守返回 `{ supported: false, preferredFormat: null }`
- 扩展优先级：ASTC（移动端现代 GPU 最佳）> BC7（桌面）> ETC2（WebGL2 强制兜底）

## 验证入口

- 间接覆盖：单测 mock WebGL context 验证探测逻辑