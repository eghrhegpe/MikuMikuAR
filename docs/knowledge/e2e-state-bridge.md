---
kind: e2e_state_bridge
name: E2E 状态读取器注入桥
tier: leaf
category: core
scope:
  - frontend/src/core/e2e-state-bridge.ts
source_files:
  - frontend/src/core/e2e-state-bridge.ts
adr:
  - ADR-238
symbols:
  - setE2EStateReader
  - getE2EStateReader
  - StateReader
invariants:
  - menus/menu-schema 模块加载即注册 getStateValue（setter），core/dev-hooks 经 getter 读取
  - 双方只依赖本叶，不互相 import；menu-schema 不会拖起 dev-hooks 的 scene/outfit 链
tests: []
use_when:
  - E2E 状态
  - __state 钩子
  - menu-schema
  - dev-hooks
  - 状态读取
---

# E2E 状态读取器注入桥

## 系统概览
**E2E 状态读取器注入桥**（e2e-state-bridge）。ADR-238 切断 `core/dev-hooks → menus/menu-schema` 反向依赖的注入桥：menu-schema 模块加载时注册 `getStateValue` 状态读取器，dev-hooks 的 `window.__state` 钩子从此读取。

## 核心职责
- `e2e-state-bridge.ts` — 单函数 setter/getter 对，持有 `StateReader` 闭包。

## 对外 API（节选）
- `setE2EStateReader(reader)` — menus/menu-schema 侧注册状态读取器（模块加载即注册）。
- `getE2EStateReader()` — core/dev-hooks 侧读取；未注册返回 `null`。
- `StateReader` — `(path: string, modelId?: string) => unknown` 状态读取签名。

## 与其他子系统关系
- 注册方：`menus/menu-schema.ts`（状态路径求值）。
- 消费方：`core/dev-hooks.ts`（`window.__state` E2E 钩子）。

## 不变量
- **依赖方向**：双方只依赖本叶，`menu-schema` 不 import `dev-hooks`（避免拖起 scene/outfit 链）。
- **加载锚点**：注册在模块加载时执行，menu-schema 未被 import 则 `window.__state` 返回 `null`（E2E 脚本需自行兜底）。
