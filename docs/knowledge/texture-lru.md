---
tier: leaf
kind: texture_lru
name: 纹理 LRU 缓存
category: scene
scope:
  - scene/shared/texture-lru.ts
source_files:
  - frontend/src/scene/shared/texture-lru.ts
adr:
  - ADR-189
symbols:
  - readTextureWithLRU
  - clearTextureLRU
  - textureLRUSize
  - _resetTextureLRUForTest
invariants:
  - 缓存键以 \x00 分隔 modelDir 和 relativePath，避免路径中冒号歧义
  - 缓存上限 TEXTURE_LRU_MAX_ENTRIES = 150（5 模型 × 30 纹理）
  - 驱逐策略基于 Map 插入顺序的近似 LRU，命中时 delete+set 重新排到最后
  - 释放：scene.ts disposeRenderer() → clearTextureLRU() 清空
  - abort 信号触发后的数据不入缓存
tests:
  - 间接覆盖：运行时集成测试
use_when:
  - 纹理缓存
  - LRU 纹理
  - 模型纹理加载
  - ADR-189
---

# 纹理 LRU 缓存

## 系统概览

纹理 LRU 缓存模块（ADR-189 Phase 1.3），按键 `<modelDir>\x00<relativePath>` 缓存纹理 ArrayBuffer，避免跨模型切换时重复读取文件。使用基于 Map 插入顺序的近似 LRU 驱逐策略，O(1) 驱逐，无需双向链表。

## 核心职责

- `texture-lru.ts` — LRU 缓存管理与读取

## 对外 API（节选）

- `readTextureWithLRU(modelDir, relativePath, signal?)` — 带 LRU 缓存的纹理读取。命中直接返回 ArrayBuffer，未命中则 `readFileBytes` 后缓存
- `clearTextureLRU()` — 清空 LRU 缓存，在 `disposeRenderer` 中调用
- `textureLRUSize()` — 返回当前缓存条目数（供测试/监控使用）
- `_resetTextureLRUForTest()` — 仅供测试使用，重置缓存状态

## 与其他子系统关系

- 被 `model-loader.ts` 在加载纹理时调用
- 依赖 `@/core/wails-bindings` 的 `readFileBytes` 读取文件
- 释放由 `scene.ts` 的 `disposeRenderer()` 触发

## 不变量

- 缓存键分割符 `\x00` 避免路径中的冒号导致 key 解析歧义
- 最大缓存 150 条目，超限时淘汰最旧插入项
- 命中时更新访问时间 + 重新 set 以更新 Map 插入顺序（最近使用排最后）
- AbortSignal 触发后不入缓存，避免缓存已废弃数据

## 验证入口

- 间接覆盖：运行时集成测试