---
kind: go_key_allows_proceed
name: Go 桌面端 key 放行判断
category: core
scope:
  - frontend/src/core/ai
source_files:
  - frontend/src/core/ai/go-key-allows-proceed.ts
adr:
  - ADR-196
symbols:
  - goKeyAllowsProceed
invariants:
  - 纯函数，零 side-effect 导入，不依赖 DOM/状态模块
  - 当 isGo=true && keyConfigured=true 时，validation 中的 missingKey 错误被忽略
  - 非 missingKey 错误（如 endpoint 为空）仍需阻止放行
tests: []
use_when:
  - Go 桌面端 key
  - 连接放行
  - 桌面端配置
---
