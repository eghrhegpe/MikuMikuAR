# ADR-060: E2E 测试策略（Playwright + 双模式 Fixture + 场景数值钩子）

> **状态**: 实施中（Phase 0 已完成，2026-07-07 提出）
> **关联**: [ADR-041](adr-041-ci-auto-checks.md)（CI 自动检查，E2E 接入点）、[AGENTS.md](../../AGENTS.md)（测试路由与 `npm run test:e2e` 入口）
> **背景**: 当前测试资产为 **33 个 Vitest 单元 spec + 2 个 Playwright E2E spec**（`smoke` + `env-sky`）。结构呈「逻辑层铜墙铁壁、UI/E2E 层四面漏风」：算法/物理/换装/绑定契约单测覆盖厚，但关键用户旅程（模型加载、动作播放、换装、AR、截图导出）无 E2E，且 3D 渲染层**无任何断言钩子**，旧 `env-sky` 截图仅断言 `data:image/png` 前缀、未比对内容。本 ADR 锁定 E2E 工具选型、断言策略与分阶段落地路标，供多 AI 协同规划。

---

## 一、问题边界

### 1.1 现状清点

| 项 | 事实 | 来源 |
|----|------|------|
| 前端框架 | **Vite + 原生 TypeScript + Babylon.js 9.14.0 + babylon-mmd**（非 React/Vue，非 Three.js） | `frontend/AGENTS.md`、本项目事实 |
| 桌面壳 | **Wails v3**（Go + WebView2） | `AGENTS.md` 技术栈 |
| 开发地址 | Vite `localhost:5173`（DOM-only）、WebView2 调试端口 `9222`（全量） | `frontend/playwright.config.ts`、`e2e/wails-fixture.ts` |
| E2E 框架 | **Playwright 已接入**，含双模式 fixture：`vitePage`（Chromium 打 5173，不依赖 Wails）+ `wailsPage`（`connectOverCDP` 连 9222，真·Wails 运行时） | `frontend/e2e/wails-fixture.ts` |
| 单元/集成 | **33 个 Vitest spec**，覆盖 xpbd/vmd/procedural-motion/beat/audio/env/material/model/outfit/bindings/shortcut 等 | `frontend/src/__tests__/` |
| 既有截图钩子 | `window.__capture()` 已存在于 `core/main.ts:875`（DEV 块内，基于 Babylon `CreateScreenshotAsync`） | `frontend/src/core/main.ts` |
| 文档纪律 | `tests/*.py`（AI 犯错追踪 + 链接校验，ADR-041 范畴） | `tests/` |
| 测试入口文档 | AGENTS.md 构建块已补 `npm run test:e2e`；路由表已加「写/维护 E2E 测试 → frontend/e2e/ + playwright.config.ts」 | `AGENTS.md`（2026-07-07 增补） |

### 1.2 痛点

- **E2E 覆盖薄**：仅冒烟 + 环境天空面板 DOM；模型加载/动作播放/换装/AR/截图导出零覆盖。
- **3D 渲染不可断言**：无数值钩子，正确性只能靠人眼或脆弱的像素比对。
- **外部误导风险**：通用「Wails E2E 指南」常以 Three.js / DOM 密集型应用为前提，给出 `localhost:34115`（Wails v2 端口）与 `getContext('2d')` 截图哈希——**对本项目均不适用**（见风险表）。

### 1.3 断言策略之争

| 策略 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 场景数值断言（本 ADR 选） | 经 `window.__scene` 读 `fps`/`meshCount`/`constraintCount` 等 | 稳定、抗噪、不怕 UI 微调 | 需先埋钩子（Phase 0 已完成） |
| B. 像素截图比对 | 截全屏与 golden 图 diff | 能抓视觉回归 | 对 WebGL 抗噪差、CI 慢、阈值难调；仅作次级基线 |
| C. 纯 DOM 断言 | `toBeVisible()`/`text=开始` | 简单 | **对 Babylon canvas 无效**——画面里无 DOM 节点 |

---

## 二、方案设计

### 2.1 核心决策

1. **工具**：沿用 **Playwright**（不引入 Cypress / Go-Rod）。理由：社区主流、AI 生成/维护支持好、双模式 fixture 已建成。
2. **断言分层**：
   - DOM 层（菜单/滑块/overlay）→ Playwright locator，**用 `vitePage`**（5173，快、不依赖 Wails）。
   - 3D 层（模型是否真渲染、物理是否在跑、FPS）→ **`window.__scene` 数值断言**，必要时辅以 `window.__capture()` 截图做次级基线。
3. **运行纪律**：Vitest 为默认回归（每次改逻辑跑）；E2E 仅在 UI/菜单级改动时跑（需 `wails dev` 或 5173+9222 就绪）。已写入 AGENTS.md 注释。

### 2.2 `window.__scene` 数值钩子（Phase 0，已实现）

挂载于 `frontend/src/core/main.ts` 的 `if (import.meta.env.DEV)` 块内，复用已导入的 `engine`/`scene`/`mmdRuntime` 与已增补导入的 `modelManager`：

```ts
(window as any).__scene = {
  get fps(): number { return engine.getFps(); },
  get meshCount(): number { return scene.meshes.length; },           // Babylon 扁平数组，含地面/辅助 mesh → 断言阈值
  get particleCount(): number {                                        // XPBD 粒子总数
    let n = 0;
    for (const c of modelManager.clothInstances.values()) n += c.solver?.particles.length ?? 0;
    return n;
  },
  get constraintCount(): number {                                      // XPBD 约束总数
    let n = 0;
    for (const c of modelManager.clothInstances.values()) n += c.solver?.constraints.length ?? 0;
    return n;
  },
  get currentAnimation(): string {
    return (mmdRuntime as any)?.runtimeAnimation?.animationName ?? 'idle';
  },
  capture: (): Promise<string> => window.__capture!(),                // 复用既有 Babylon 截图，不碰 2D context
};
```

**真实导出路径（其他 AI 改此钩子时务必引用，勿套 Three.js 模板）**：

| 符号 | 导出位置 |
|------|----------|
| `scene` / `engine` / `modelManager` | `frontend/src/scene/scene.ts` |
| `mmdRuntime` | `frontend/src/core/state.ts`（经 `core/config` 再导出至 `main.ts`） |
| `XpbdSolver.constraints` / `.particles` | `frontend/src/physics/xpbd-solver.ts` |
| `ClothInstance.solver` | `frontend/src/physics/cloth-manager.ts` |
| `window.__capture` | `frontend/src/core/main.ts:875` |

---

## 三、详细实现（分阶段）

### Phase 0 — 场景数值钩子（✅ 已完成 2026-07-07）

- [x] `core/main.ts` 新增 `window.__scene`（fps / meshCount / particleCount / constraintCount / currentAnimation / capture）
- [x] 复用既有 `window.__capture`，**不创建 2D-canvas 哈希**（WebGL canvas `getContext('2d')` 返回 `null`）
- [x] `../scene/scene` 导入补 `modelManager`
- [x] `npm run check` 通过（tsc --noEmit exit 0）
- [x] 中央文件改动已在当日 `memory/YYYY-MM-DD.md` 认领（项目多 AI 铁律）

### Phase 1 — E2E 关键路径骨架（⏳ 待实施）

按 `wails-fixture.ts` 双模式，新增 3 个 spec（DOM 用 `vitePage`，WebGL 用 `wailsPage`）：

- [ ] `e2e/model-load.spec.ts` — 加载默认模型 → `waitForFunction(__scene.meshCount > 10)` + `fps >= 30`
- [ ] `e2e/action-play.spec.ts` — 切动作 → 断言 `__scene.currentAnimation` 变化；换装 → 断言 `meshCount` 或 `capture()` 哈希变化
- [ ] `e2e/export-screenshot.spec.ts` — 触发导出 → 断言 `download` 事件文件名 `/\.(png|jpg)$/`（不比图片内容）
- [ ] **选择器来源**：`text=加载默认模型` 等是占位，**须 grep `frontend/src/menus/` 与 `index.html` 取真实 `id`/`text`**（如 `#btnLibrary`、`#btnEnv`），禁止凭空猜测
- [ ] 每个 spec 标注 `// @e2e vitePage` 或 `// @e2e wailsPage`，明确依赖

### Phase 2 — 截图基线比对（⏳ 待实施，可选增强）

- [ ] `e2e/__snapshots__/` 存 golden 图；`env-sky` 等从「仅断言 dataURL 前缀」升级为内容 diff（允许阈值，抗 WebGL 轻微噪点）
- [ ] 提供 `updateSnapshots` 脚本，UI 有意变更时一键刷新基线

### Phase 3 — CI 集成（⏳ 待实施，挂 ADR-041）

- [ ] Vitest 每次提交必跑（秒级、无运行时依赖）
- [ ] E2E 在「UI/菜单级改动」或 nightly 跑：CI 内 `wails dev &` 起 9222 后 `npx playwright test`
- [ ] E2E 失败 → 归档 `window.__capture()` 截图，便于人工比对

### Phase 4 — AI 辅助维护（⏳ 长期）

- [ ] 以 `wails-fixture.ts` + `helpers.ts` 为上下文，让 AI 生成/维护 spec（稳定 `id` 选择器 + 语义 `text` 提升命中率）
- [ ] 失败归因规则写进 prompt：DOM 正常但 canvas 异常时，AI 看不到，必须靠截图 diff / 人工
- [ ] 探索性测试：AI 自主遍历菜单，发现未覆盖边界

---

## 四、决策对比

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| **Playwright 双模式（本 ADR）** | vitePage(5173) + wailsPage(9222) + `__scene` 数值断言 | 快/稳分层、AI 友好、已建成 | E2E 需 Wails 运行时 | **采用** |
| Cypress | 浏览器访问 dev server | 交互调试好 | 同样依赖运行时；大型应用慢；AI 生态弱于 Playwright | 不采用 |
| Go-Rod / chromedp | Go 控 WebView | 纯 Go、与后端紧 | 需处理 9222 调试端口等底层细节；frontend AI 不熟 Go | 不采用 |
| Testim/Mabl 等平台 | 商业 AI 测试 | 低代码、自适应 UI | 复杂 3D 逻辑不灵活；商业成本 | 不采用 |

**断言策略结论**：以 **A. 数值断言**为主（Phase 0 已落地），**B. 截图基线**为次级（Phase 2），**C. 纯 DOM** 仅限 overlay/menu（不用于 canvas 内容）。

---

## 五、实施路标（Checklist）

### Phase 0: 场景数值钩子（✅ 2026-07-07 完成）
- 见第三节 Phase 0 清单。

### Phase 1: E2E 关键路径骨架（~0.5–1 天）
- [ ] grep 真实菜单选择器
- [ ] 写 `model-load` / `action-play` / `export-screenshot` 三个 spec
- [ ] 本地 `wails dev` 起 9222 后 `npm run test:e2e` 验证

### Phase 2: 截图基线（~0.5 天，可选）
- [ ] golden 图 + diff 阈值；`updateSnapshots` 脚本

### Phase 3: CI 接入（~0.5 天，挂 ADR-041）
- [ ] CI 跑 Vitest 常驻；E2E 按需；失败归档截图

### Phase 4: AI 维护（长期）
- [ ] fixture 驱动的 spec 生成/修复 prompt；探索性测试

---

## 六、风险与边界

| 风险 | 等级 | 缓解 |
|------|------|------|
| **套用 Three.js 模板**（外部「Wails E2E 指南」常见） | 高 | 本 ADR 明确 Babylon 导出路径表；`window.__scene` 已按真实符号实现；多 AI 改钩子前先读本 ADR |
| **WebGL canvas 用 `getContext('2d')`** 返回 null 抛错 | 高 | 禁用 2D 哈希；统一走 `window.__capture`（Babylon 截图） |
| **端口误导**（指南写 `34115` 为 Wails v2） | 中 | 本项目用 5173 + 9222；见 1.1 |
| `meshCount` 含系统 mesh（地面/辅助）导致阈值误判 | 中 | 断言阈值（如 `> 10`）而非精确值；换装可用 `capture()` 哈希变化 |
| E2E 重（需 Wails 运行时）拖慢日常 | 中 | 默认跑 Vitest；E2E 仅 UI 改动时（AGENTS.md 注释） |
| `mmdRuntime.runtimeAnimation.animationName` 字段名随 babylon-mmd 版本变 | 低 | 已用 `(mmdRuntime as any)?.runtimeAnimation?.animationName ?? 'idle'` 容错 |
| 截图基线对 WebGL 噪点敏感 | 中 | 仅作次级基线 + 阈值；主判据仍是数值 |

### 边界

- 本 ADR **不替换** Vitest 单元测试——算法/物理层继续用 Vitest（33 spec 已覆盖）。
- 本 ADR **不引入** Cypress / Go-Rod / 商业 AI 测试平台。
- 本 ADR **不修改** `window.__scene` 之外的生产代码路径；钩子仅在 `import.meta.env.DEV` 下挂载，生产构建剔除。
- 本 ADR **不处理** 模型内资源路径编码（属 ADR-057/058）。
- 多 AI 协作：触碰 `core/main.ts` 等中央文件前，须先在当日 `memory/YYYY-MM-DD.md` 认领（见项目铁律）。

---

## 七、验证方式

1. **钩子可用**：`wails dev` 起 9222 → Playwright `wailsPage` 打开应用 → `page.evaluate(() => window.__scene.fps)` 返回数值、`meshCount > 0`。
2. **模型加载**：`model-load.spec.ts` 加载默认模型后 `waitForFunction(__scene.meshCount > 10)` 通过且 `fps >= 30`。
3. **动作/换装**：`action-play.spec.ts` 切换后 `__scene.currentAnimation` 变化；换装后 `meshCount` 或 `capture()` 变化。
4. **导出**：`export-screenshot.spec.ts` 触发后产生 `*.png/*.jpg` 下载。
5. **回归**：`npm run check && npm run test`（Vitest）全绿；E2E 在 `wails dev` 就绪下 `npm run test:e2e` 通过。

---

## 八、相关 ADR

- [ADR-041](adr-041-ci-auto-checks.md) — CI 自动检查（E2E 接入点与失败归档挂此）
- [ADR-019](adr-019-xpbd-cloth-simulation.md) — XPBD 布料（约束/粒子即 `__scene` 数据源）
- [ADR-057](adr-057-shift-jis-url-base64.md) / [ADR-058](adr-058-basenameFallbackFS.md) — 资源路径编码（不在本 ADR 范畴）
- [AGENTS.md](../../AGENTS.md) — 测试路由表与 `npm run test:e2e` 入口（2026-07-07 已补）
