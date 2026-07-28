---
kind: action_registry
name: 统一动作注册表 — 菜单/NL/快捷键共享真相源
category: core
scope:
  - frontend/src/core/action-registry.ts
  - frontend/src/core/action-executor.ts
  - frontend/src/core/action-defs
  - frontend/src/core/ai/param-adapters.ts
  - frontend/src/core/ai/action-catalog.ts
  - frontend/src/core/ai/action-registry-defs.ts
source_files:
  - frontend/src/core/action-registry.ts
  - frontend/src/core/action-executor.ts
  - frontend/src/core/ai/param-adapters.ts
  - frontend/src/core/ai/action-catalog.ts
  - frontend/src/core/ai/action-registry-defs.ts
  - frontend/src/core/action-defs/settings-actions.ts
  - frontend/src/core/action-defs/scene-actions.ts
  - frontend/src/core/action-defs/motion-actions.ts
  - frontend/src/core/action-defs/env-actions.ts
  - frontend/src/core/action-defs/library-actions-def.ts
adr:
  - ADR-197
  - ADR-155
symbols:
  - registerAction
  - listActions
  - getAction
  - executeActionById
  - adaptParam
  - buildToolSchemas
  - buildToolCatalogText
  - registerAllActions
invariants:
  - action-registry.ts 为零依赖纯叶子；ActionDef.label 当前为硬编码中文（非 i18n key），消费端原样使用，NL 国际化为待办
  - executeActionById 先经 adaptParam 校验/转换所有参数，缺参（非 boolean/toggle）即失败短路，execute 异常被捕获转为 ActionResult
  - param-adapters 的 entity 类型必须配 ParamDef.resolve；string 类型直通透传不校验
  - destructive 动作的确认 UI 由调用方自行处理，注册表本身不弹 showConfirm
  - registerAction 遇重复 id 默认 console.warn + 覆盖；strictMode 下抛错
tests:
  - frontend/src/core/__tests__/action-executor.test.ts
use_when:
  - 动作注册
  - NL 控场
  - 自然语言控制
  - 动作执行器
  - 工具 catalog
  - 参数适配器
  - action registry
---

## 系统概览
ADR-197 引入的统一动作注册表：把 settings/scene/motion/env/library 各域的功能型动作集中定义为 `ActionDef`，供菜单渲染、自然语言控场（ADR-155）、快捷键、E2E testid 共享同一真相源。`action-executor` 负责参数适配后执行；`action-catalog` 把注册表转成 LLM 可消费的工具 schema / 文本目录。

## 核心职责
- `action-registry.ts` — 零依赖注册表：`ActionDef` / `ParamDef` 类型 + `registerAction` / `getAction` / `listActions` / `unregisterAction`（返回 unregister 供 HMR/测试 teardown）
- `action-executor.ts` — `executeActionById()`：逐参数经 `adaptParam` 校验→调用 `def.execute`→包装为 `ActionResult`，异常不外泄
- `ai/param-adapters.ts` — 参数类型适配器（enum/range/color/entity/string/boolean/toggle），enum 支持 synonyms 归一，entity 走 `def.resolve` 异步模糊匹配
- `ai/action-catalog.ts` — `buildToolSchemas()`（OpenAI function-calling 格式）+ `buildToolCatalogText()`（纯文本目录）
- `ai/action-registry-defs.ts` — `registerAllActions()` 总入口 + `registerControlActions()`（`ai:control:` 命名空间的 NL 控制动作）
- `action-defs/*.ts` — 各域动作定义：settings（缓存清理/路径/语言）、scene（截图/保存/撤销）、motion（口型/程序化动作/VMD/音频/绑定导航）、env（粒子/天空/星空纹理绑定）、library（扫描/导入/队形）

## 对外 API（节选）
- `registerAction(def)` / `registerActions(defs)` — 注册，返回 unregister 函数
- `getAction(id)` / `listActions(domain?)` — 查询
- `executeActionById(id, rawParams)` — 校验+执行，返回 `{ success, message }`
- `adaptParam(def, raw)` — 单参适配，返回 `{ ok, value } | { ok, error }`
- `buildToolSchemas()` / `buildToolCatalogText()` — 生成 LLM 工具描述
- `registerAllActions()` — 应用启动时批量注册全域动作

## 与其他子系统关系
- 上行：菜单系统、`ai/intent-dispatcher.ts`（NL 解析后 `executeAction`）、快捷键调用 `executeActionById`
- 下行：各 `action-defs` 的 `execute` 调用 scene/motion/env/lighting/library 等域 setter 与 menus/* 交互
- `action-catalog` 消费 `listActions()`，产出喂给 `ai-service` 的 LLM 请求

## 不变量
- 见 frontmatter `invariants`

## 验证入口
- 契约见 ADR-197 / ADR-155
- 测试：`frontend/src/core/__tests__/action-executor.test.ts`（回归 8 个 control 动作的参数校验/单次加载/同义词不变量；`action-defs/*` 各域动作被 mock，未直接测试）
- 命令：`cd frontend && npm run test -- src/core/__tests__/action-executor.test.ts`
