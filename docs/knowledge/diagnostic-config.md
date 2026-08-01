---
kind: diagnostic_config
name: 诊断助手 → 配置 UI（子模块）
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/diagnostic-config.ts
adr:
  - ADR-196
  - ADR-203
symbols:
  - applyProvider
  - buildConfigSchema
  - goKeyAllowsProceed
  - loadInitialConfig
  - persistConfig
  - refreshCaps
  - refreshModelList
  - updateStatusBadge
invariants:
  - Go 桌面端 key 不可回读时（isGo=true && keyConfigured=true），missingKey 不阻止请求发起
  - 配置写回经 saveChain 串行化（链式 Promise），避免并发持久化竞争
  - provider 切换时自动填充对应默认端点/模型/文档链接
  - testConnection 先 flushAndSave 持久化当前配置，再使用 localConfig 验证连接
tests: []
use_when:
  - 端点配置
  - API key
  - 连接测试
  - 模型列表
  - provider 切换
---
