# ADR-155: 自然语言控场景 — 叠加于 AiService 管线之上

- **状态**: 🔄 实施中（已进入 Phase 1 实施阶段，基于 ADR-196 Phase 0 传输层）
- **日期**: 2026-07-20（初版），2026-07-28（重写，对齐 ADR-196）
- **相关**: ADR-093（声明式菜单 Schema，动作闭集来源）、ADR-153（无障碍，ARIA 规范）、ADR-154（推荐路线，历史对照）、ADR-196（AiService 传输层前置）、ADR-176（双适配器模式）、ADR-191（禁止神桶，纯/叶子模块导入规则）、**ADR-197（统一动作注册表，菜单可维护性归一化，本 ADR 的 catalog 终态由 registry 驱动）**

---

## 背景

原 ADR-155 写于 ADR-196 之前，当时「客户端+流式+面板」尚未落地，故路线分「推荐聊天打底」vs「激进直接控场景」。

**现状已变**：ADR-196 Phase 0 交付了完整的 LLM 传输层（Go client + 5 bindings + TS 双适配器 + SSE 流式 + 诊断面板），且诊断面板已内嵌对话 UI。

因此本 ADR 的地位从「激进候选路线」转为 **ADR-196 的叠加层**——在已有传输管线上新增意图解析模块，使诊断面板同时承载「诊断」和「控制」两种交互模式。

---

## 前置依赖（已就绪）

| 依赖 | ADR | 实际组件 | 状态 |
|------|-----|---------|------|
| LLM 传输层 | ADR-196 | `AiService` 接口 + go/browser 适配器 + `resolveAi()` | ✅ |
| 流式 SSE | ADR-196 | `sse.ts` 解析器 + `go-adapter.ts` AsyncIterable | ✅ |
| 流式渲染 | ADR-196 | `settings-diagnostic.ts` `_renderStreamingChunk()` | ✅ |
| 诊断面板 | ADR-196 | `settings-diagnostic.ts` 435 行三分区面板 | ✅ |
| 动作闭集 | ADR-093 | ~35 个离散 action 分布在 5 个域（settings/scene/motion/library/env） | ✅ |
| Go bindings | ADR-196 | `AiStreamChat/AiCancelStream` 等 5 个绑定 | ✅ |
| 零 key 默认路径 | ADR-196 | 默认 Ollama localhost:11434 + 浏览器 IndexedDB 配置 | ✅ |

---

## 设计决策

### 1. 复用诊断面板，加「控制」模式切换
不新增菜单入口。诊断面板顶部加「诊断 / 控制」tabs（`role="tablist"` + `aria-selected`），控制模式下对话下方多「待执行操作卡」。

- `MenuNode.id` 命名：`ai:control:mode`、`ai:control:pending-action`（冒号命名空间，对齐 `diagnostic:chat` 模式）
- data-testid：自动由 render-menu 在对应 `MenuNode.id` 上生成 `data-testid="ai:control:mode"` 等

### 2. 意图解析双轨制
| 模式 | 适配器 | 意图解析方式 | Key 安全 |
|------|--------|-------------|---------|
| 桌面/安卓 | go-adapter | Go 侧 tool/function_calling，在 `client.go` 追加 tool schema 参数 | 前端不可见 |
| 浏览器 | browser-adapter | TS 侧**优先**调 provider 原生 function_calling（Ollama/OpenAI 均支持）；仅在不支持的工具/旧模型下降级为 prompt 约束 + JSON 提取 | 用户自带 key |

### 3. 动作闭集：首批 8 个高频
由 `action-catalog.ts` 定义工具描述（Phase 1 后由 ADR-197 统一注册表驱动，单一真相源），LLM 选中调用。工具名对应已注册 handler；`loadModel`/`loadMotion` 需先导出薄封装（见「代码事实核对」），故非完全「零新逻辑」。

工具命名模式：`ai:control:setLightIntensity`、`ai:control:setCameraMode`——kebab-case + `ai:control:` 前缀（对齐 `settings:diagnostic` 模式）。

### 4. 安全：用户显式确认
控制模式的所有操作**不自执行**。面板底部始终显示「待执行操作卡」，card 包含：
- `role="alert"` 实时告知即将执行的操作
- 「应用 / 取消」两按钮
- destructive 操作（loadModel/clearMotion 等）加 `showConfirm` 二次确认
- `aria-live="polite"` 在操作执行后播报结果

---

## 实施计划（Phase 1—2）

### Phase 1：核心管线 + 8 个高频动作（~320 行 TS + ~80 行 Go）

| # | 模块 | 文件 | 行数 | 内容 |
|---|------|------|------|------|
| 1 | **工具编目** | `frontend/src/core/ai/action-catalog.ts` | ~80 | 8 个高频动作的 tool schema 定义（JSON Schema），**参数类型以真实代码为准**（见「代码事实核对」）；Go 侧用此生成 function_calling payload，浏览器侧用此做 prompt 约束；Phase 1 后由 ADR-197 注册表导出 |
| 2 | **意图分发器** | `frontend/src/core/ai/intent-dispatcher.ts` | ~120 | `executeAction(action, params): Promise<ActionResult>`——校验 action ∈ 闭集 → 按 `ParamDef.type` 经 `param-adapters.ts` 翻译参数 → 调已注册 handler → 返回结果（成功/失败+消息）。**纯叶子模块**，仅导入 `@/core/clamp` 等零依赖叶，不导入神桶 |
| 2.5 | **参数类型适配器** | `frontend/src/core/ai/param-adapters.ts` | ~60 | 4 个通用适配器：`enumAdapter`(同义词映射) / `colorAdapter`(hex→[r,g,b]) / `rangeAdapter`(数值 clamp+step) / `entityAdapter`(name→LibraryModel)。intent-dispatcher 按 `ParamDef.type` 选适配器，**不按动作名写 case**，新增动作零改适配器 |
| 3 | **控制模式 UI** | 修改 `settings-diagnostic.ts` | ~120 | 加「诊断/控制」tab 切换（`role="tablist"`）、控制模式下消息流底部追加 pending-action 卡（`role="alert"` + `aria-live="polite"`）、「应用/取消」按钮；新 MenuNode id: `ai:control:mode`、`ai:control:pending-action` |
| 4a | **Go tool schema 支持** | `internal/app/llm/tools.go` | ~50 | `ToolSchema` 结构体 + OpenAI function_calling JSON 生成辅助函数（复用现有 `client.go` 的 `StreamChat` callback 模式） |
| 4b | **tools 字段贯穿** | `internal/app/ai_binding.go` + `frontend/src/core/ai/types.ts` + `go-adapter.ts` | ~50 | `ChatRequest.tools?: ToolSchema[]` 扩展 + `AiService.streamChat` 签名同步 + `AiStreamChatWithTools()` 绑定（或扩展现有 `AiStreamChat` 加可选 `tools`），使 tools 贯穿双适配器 |
| 5 | **i18n** | `frontend/src/core/i18n/locales/*.ts` | 5×6=30 | 每个语言加 `ai.control.*` 键：`ai.control.title`、`ai.control.apply`、`ai.control.cancel`、`ai.control.pending`、`ai.control.executed`、`ai.control.unsupported` |
| 6 | **E2E 测试** | `frontend/e2e/ai-control.spec.ts` | ~60 | 3 个测试用例（`@dom` tag）：(1) 模式切换 tab 可见 (2) `data-testid="ai:control:mode"` 可点击 (3) 输入非法动作 → pending 卡显示「暂不支持」 |

### Phase 2：扩展动作覆盖 + 边缘场景（后续）

| # | 内容 | 估计 |
|---|------|------|
| 1 | 动作集从 8 扩展至 ~20 个（含 env preset、motion load、screenshot、scene save） | 80 行 `action-catalog.ts` |
| 2 | 多步指令拆解：LLM 返回意图队列 `[action1, action2, ...]`，逐条确认后批量执行 | 100 行 `intent-dispatcher.ts` |
| 3 | 错误回复友好化：未命中意图时助手回复"暂不支持该操作，可尝试..."（基于 `action-catalog` 提示相近动作） | 30 行 |

---

## 首批 8 个高频动作工具定义

工具命名模式：`ai:control:<verb><Noun>`（PascalCase 动词+名词，对齐 Go binding 命名）；

| 工具 | 参数 | 类型约束（真实代码） | 对应 handler | 确定性 |
|------|------|------|-------------|--------|
| `ai:control:setLightIntensity` | `dirIntensity: number` | 0–1，步长 0.05（映射 `LightState.dirIntensity`） | `setLightState({ dirIntensity })` | 高 |
| `ai:control:setLightColor` | `dirColor: [r,g,b]` | hex `#rrggbb` → 元组 (÷255, clamp 0–1) | `setLightState({ dirColor })` | 高 |
| `ai:control:setCameraMode` | `mode: CameraMode` | `orbit\|freefly\|surround\|concert\|oneshot\|vmd\|ar`（同义词：follow→freefly） | `setCameraMode(mode)` | 高 |
| `ai:control:setEnvPreset` | `preset: string` | 匹配 `envPresets` 列表 | `applyEnvPreset(name)` | 中 |
| `ai:control:toggleGround` | (none) | 无参 | `setEnvState({ groundVisible: !current })` toggle | 高 |
| `ai:control:loadModel` | `name: string` | 库搜索 → `LibraryModel` 对象（需导出薄封装 `loadLibraryModel`） | `loadLibraryModel(name, isStage)` | 低 |
| `ai:control:loadMotion` | `name: string` | 同上 | `loadLibraryMotion(name)` → `replaceMotion(m)` | 低 |
| `ai:control:setPerformance` | `mode: PerformanceMode` | `auto\|quality\|balanced\|performance\|custom`（同义词：high→quality, low→performance） | `setPerformanceMode(mode)` | 高 |

> 确定性「高」= 枚举/数值范围，LLM 解析误差小；「中」= 需匹配预设名列表；「低」= 需模糊库搜索 + 对象解析（首版可先不支持，提示用户到界面操作）。
>
> **代码事实核对（2026-07-28）**：原表 6/8 参数与现实不符——`lightIntensity`/`lightColor` 单字段不存在（真实为 `dirIntensity` 0–1 + `dirColor` 元组）；`CameraMode`/`PerformanceMode` 枚举值与计划不同；`loadModelNormal`/`replaceMotion` 为模块内私有函数且要 `LibraryModel` 对象，外部不可直接调用。ADR-155 Phase 1 须先导出薄封装（见 Phase 1 表 1/2.5/4b）。

---

## 命名约定总表

| 维度 | 模式 | 示例 |
|------|------|------|
| MenuNode id | `ai:control:<specific>` | `ai:control:mode`、`ai:control:pending-action` |
| Tool 工具名 | `ai:control:<verb><Noun>` | `ai:control:setLightIntensity` |
| i18n key | `ai.control.<specific>` | `ai.control.apply`、`ai.control.title` |
| data-testid | 自动由 `MenuNode.id` 派生 | `data-testid="ai:control:mode"` |
| ARIA role | `role="tablist"` / `role="tab"` / `role="alert"` | 模式切换 tabs + pending 操作卡 |
| Icon | `lucide:wand-2`（控制模式图标） | settings-diagnostic mode switch 用 |

---

## 安全护栏

| 约束 | 实现方式 |
|------|---------|
| 不自执行 | 所有解析结果先入 pending-action 卡，用户点「应用」才分发到 handler |
| 不在闭集合内 | `intent-dispatcher.ts` 校验 `action` 是否在 `action-catalog.ts` 的 keys 内，否则返回错误消息 |
| destructive 动作二次确认 | `loadModel`/`loadMotion`/`clearAllSceneMotions` 等走 `showConfirm` 再执行 |
| key 前端不可见 | 桌面走 Go function_calling；浏览器用户自带 key |
| 不发全量状态 | 诊断上下文仅发 error buffer + scene snapshot，不发 `docs/` 仓库内容 |

---

## E2E 测试验收

```typescript
// frontend/e2e/ai-control.spec.ts
import { test, expect } from "./wails-fixture";

test.describe("AI 控制模式 (@dom)", { tag: ["@dom"] }, () => {
    test.beforeEach(async ({ vitePage: page }) => {
        await page.goto("http://localhost:5173");
        // 打开设置 → 诊断面板（复用 openSettingsPanel helper）
        await page.click("#btnSettings");
        await page.getByTestId("folder:settings:diagnostic").click();
    });

    test("模式切换 tab 可见", async ({ vitePage: page }) => {
        await expect(page.getByTestId("ai:control:mode")).toBeVisible();
        // 默认选中「诊断」tab
        await expect(page.getByRole("tab", { name: /诊断/i }))
            .toHaveAttribute("aria-selected", "true");
    });

    test("切换到控制模式显示 pending 区", async ({ vitePage: page }) => {
        await page.getByTestId("ai:control:mode").click();
        // 选择「控制」tab
        await page.getByRole("tab", { name: /控制/i }).click();
        await expect(page.getByTestId("ai:control:pending-action")).toBeVisible();
    });

    test("输入非法动作显示不支持提示", async ({ vitePage: page }) => {
        // 切换到控制模式
        await page.getByTestId("ai:control:mode").click();
        await page.getByRole("tab", { name: /控制/i }).click();
        // 输入不被支持的动作描述
        await page.locator("textarea").fill("删除所有文件");
        await page.getByRole("button", { name: /发送/i }).click();
        // 应提示暂不支持，不产生 pending card
        await expect(page.getByText(/暂不支持/i)).toBeVisible();
    });
});
```

---

## 实施顺序建议

```
Phase 1.1  action-catalog.ts        — 先定义工具编目（不依赖其他新模块）
Phase 1.2  intent-dispatcher.ts     — 意图分发器单测先行
Phase 1.3  tools.go + binding 扩展  — Go 侧 tool schema
Phase 1.4  控制模式 UI              — 修改 settings-diagnostic.ts
Phase 1.5  i18n                    — 5 语言同步
Phase 1.6  E2E                     — 3 个验收测试
```

---

## 修订记录

| 日期 | 修订 |
|------|------|
| 2026-07-20 | 初版，激进路线定稿（跳过聊天面板，直接控场景） |
| 2026-07-28 | 重写：对齐 ADR-196 Phase 0 完成态，复用 AiService 传输层 + 诊断面板，追加命名约定/ARIA/test-id/E2E/i18n 规格；路线从「候选」升为「叠加层」 |
| 2026-07-28 | 代码事实核对修订：修正 8 动作表 6/8 参数（真实 `dirIntensity`/`dirColor` 元组/`CameraMode`/`PerformanceMode` 枚举）；新增 `param-adapters.ts` 按参数类型翻译（非 per-action case）；`ChatRequest.tools` 贯穿双适配器；`loadModelNormal`/`replaceMotion` 需导出薄封装；关联 ADR-197 统一动作注册表规划 |
