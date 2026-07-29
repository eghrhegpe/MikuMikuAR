---
kind: diagnostic_config
name: 诊断面板配置 UI
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/diagnostic-config.ts
adr:
  - ADR-196
  - ADR-203
symbols:
  - goKeyAllowsProceed
  - loadInitialConfig
  - refreshCaps
  - persistConfig
  - applyProvider
  - refreshModelList
  - updateStatusBadge
  - buildConfigSchema
  - testConnection
invariants:
  - Go 桌面端 key 不可回读时（isGo=true && keyConfigured=true），missingKey 不阻止请求发起
  - 配置变更经 DebouncedTimer 防抖落盘（autoTestTimer 500ms）
  - provider 切换时自动填充对应默认端点/模型/文档链接
  - testConnection 始终使用临时配置而非已持久化值，避免竞争
tests: []
use_when:
  - 端点配置
  - API key
  - 连接测试
  - 模型列表
  - provider 切换
---
