---
kind: ai_relay
name: AI Relay 生效判定 — 网页端 CORS 同源代理
tier: leaf
category: core
scope:
  - frontend/src/core/ai/relay.ts
source_files:
  - frontend/src/core/ai/relay.ts
symbols:
  - isRemoteEndpoint
  - relayTarget
invariants:
  - 只有纯网页平台 + 远程端点 + relayUrl 已配置 三者同时成立，relay 才真正生效
  - 桌面端（Wails / go 适配器）由 Go 直连 API，无 CORS 问题，relay 不参与
  - browser-adapter 与诊断面板共用 relayTarget 判定，避免"显示启用、实际直连"漂移
  - isRemoteEndpoint 用正则排除 localhost/127.0.0.1（含端口和路径变体）
---

# AI Relay 生效判定 — 网页端 CORS 同源代理
