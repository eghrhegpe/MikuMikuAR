# ADR-060: E2E 测试策略（Playwright + 双模式 Fixture + 场景数值钩子）

> **状态**: 实施中（Phase 0 / Phase 1 / Phase 2 / Phase 3 已完成，2026-07-07 提出并推进；Phase 4 长期）
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
  // 换装行为钩子（Phase 1）：驱动真实 applyOutfitVariant 路径，避免 3-4 层脆弱菜单导航
  outfitVariants: (): Promise<string[]> => {
    const inst = focusedModel();
    if (!inst) return Promise.resolve([]);
    return loadOutfits(inst.id).then((o) => (o?.variants ?? []).map((v) => v.name)).catch(() => []);
  },
  applyOutfit: (variantName: string): Promise<boolean> => {
    const inst = focusedModel();
    if (!inst) return Promise.resolve(false);
    return applyOutfitVariant(inst.id, variantName).then(() => true).catch(() => false);
  },
  // 当前帧 16x16 亮度指纹（Phase 2）：浏览器内生成，避开 PNG 解码与 2D context
  fingerprint: async (): Promise<string> => {
    const url = await window.__capture!();
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const ctx = c.getContext('2d'); if (!ctx) return '';
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let s = ''; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2] > 384 ? '1' : '0';
    return s;
  },
  capture: (): Promise<string> => window.__capture!(),                // 复用既有 Babylon 截图，不碰 2D context
};
```

**真实导出路径（其他 AI 改此钩子时务必引用，勿套 Three.js 模板）**：

| 符号 | 导出位置 |
|------|----------|
| `scene` / `engine` / `modelManager` | `frontend/src/scene/scene.ts` |
| `mmdRuntime` | `frontend/src/core/state.ts`（经 `core/config` 再导出至 `main.ts`） |
| `focusedModel()` | `frontend/src/scene/scene.ts`（**函数**，返回焦点 ModelInstance，用 `focusedModel()?.id`） |
| `applyOutfitVariant` / `loadOutfits` | `frontend/src/scene/scene.ts` 再导出自 `frontend/src/outfit/outfit.ts` |
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

### Phase 1 — E2E 关键路径骨架（✅ 已完成 2026-07-07）

按 `wails-fixture.ts` 双模式，新增 3 个 spec（DOM 用 `vitePage`，WebGL 用 `wailsPage`）：

- [x] `e2e/model-load.spec.ts` — 默认模型 / 指定名模型 → `waitForFunction(__scene.meshCount > 10)` + `fps >= 30`
- [x] `e2e/action-play.spec.ts` — 切动作 → 断言 `__scene.currentAnimation` 变化（非 `idle`）；换装 → 经 `__scene.outfitVariants()`/`applyOutfit()` 驱动真实换装路径，比对 `fingerprint()` 前后变化，变体不足 2 个时 `test.skip`
- [x] `e2e/export-screenshot.spec.ts` — `__scene.capture()` 返回有效 PNG dataURL；场景菜单「截图当前模型」入口 DOM 可见
- [x] **真实选择器（已 grep 锁定，勿凭空猜）**：

  | 入口 | 选择器 | 来源 |
  |------|--------|------|
  | 模型库 | `#btnMainAction` | `core/dom.ts` |
  | 动作弹窗 | `#btnMotionPopup` | `core/dom.ts` |
  | 场景菜单 | `#btnScene` | `core/dom.ts` |
  | 环境面板 | `#btnEnv` | `core/dom.ts` |
  | 菜单项 | `div.slide-item`（标签 `span.slide-label`） | `menus/menu.ts` / `core/ui-slide-row.ts` |
  | 截图菜单项 | 文本「截图当前模型」(`scene:screenshot`) | `menus/scene-menu.ts` |
  | 换装入口 | 详情层「外观 → 服装变体」(`buildOutfitLevel`) | `menus/model-detail.ts:141` / `menus/outfit-ui.ts` |

- [x] **换装 E2E 策略决策**：模型详情→服装变体是 3-4 层菜单导航（库 `scene:<id>` 行 → 详情 → 外观折叠 → 服装变体 → 变体行），DOM 定位极脆弱且无法在本环境验证。据本 ADR「数值/行为断言为主」原则，**换装行为走 `__scene.applyOutfit()` 钩子**（真实驱动 `applyOutfitVariant`，含 `loadOutfits` + mesh 重定向），仅对画面变化做指纹比对；纯 DOM 菜单路径不作为 E2E 主判据。
- [x] `npm run check` + `npx playwright test --list` 通过（14 个测试枚举成功）

> **导出截图说明**：本项目截图走 **Wails 原生 `SaveFile` 对话框**（非浏览器 `download` 事件），Playwright 无法拦截。正确做法是断言 `__scene.capture()` 的 Babylon 管线 + 场景菜单入口 DOM（见 `export-screenshot.spec.ts`）。

### Phase 2 — 截图基线比对（✅ 已完成 2026-07-07，指纹方案）

采用 **粗粒度指纹基线** 取代原始「golden PNG + 像素 diff」：

- [x] `window.__scene.fingerprint()`（Phase 0 钩子扩展）：浏览器内 `Image.decode` → 缩到 16×16 → 取每像素亮度阈值生成 256 位 `0/1` 字符串。**完全避开 PNG 解码与 WebGL 2D-context 陷阱**。
- [x] `helpers.ts`：`compareToBaseline(name, hash, tolerance=0.08)` 用汉明距离比对；**首次运行无基线自动生成**（generator mode，CI seed 用），已存在则比对。
- [x] `e2e/__baselines__/`（含 `README.md`）：基线 JSON 落盘处；删除对应 `.json` 即可重算。
- [x] `env-sky.spec.ts`「纯色纯白截图」升级为：校验 `capture()` 管线 + `fingerprint()` 与基线比对（容忍 0.08）。
- [ ] 后续可扩：`model-load` 默认场景基线、动作切换前后基线 diff（按需）。

> 为何不用 `data:image/png` 字符串直接比对：Babylon `CreateScreenshotAsync` 压缩非确定性，同画面字符串可能不同；指纹方案对驱动/抗锯齿抖动稳健。

### Phase 3 — CI 集成（✅ 已完成 2026-07-07，挂 ADR-041）

在 `.github/workflows/ci.yml` 落地「两层 E2E 门禁」，spec 用 Playwright 原生 tag（`@dom` / `@webgl`）切分，CI 以 `--grep` 过滤：

- [x] **`e2e` job（阻塞门禁，ubuntu-latest）**：仅跑 `@dom`（`smoke` 3 + `env-sky` DOM-only 2 = 5 个）。Playwright 自带 Chromium 打 Vite 5173，**不依赖 Wails 运行时**，验证菜单/overlay/快捷键等 DOM 层回归。同一步内 `npm run dev &` 后台起 Vite → 轮询 5173 就绪 → `npx playwright test --grep @dom` → 收尾 kill。
  - **env-sky `@dom` 断言已据真实 UI 修正**：天空是**统一层级**（非「每模式一组滑块」），分段控件只显示当前模式（程序化/纯色/贴图），另有环境预设 chips（黎明/正午/夕阳/夜景/阴天/霓虹夜）与自定义颜色控件（`天空色` R/G/B，非 `input[type=range]`）。故断言改为：模式控件 + 预设 + 颜色控制均渲染、点击预设不报错。
- [x] **`e2e-wails` job（best-effort，`windows-latest`，`continue-on-error: true`，`needs: e2e`）**：跑 `@webgl`（model-load 2 + action-play 2 + export-screenshot 2 + env-sky 截图 1 = 7 个）。`wails dev` 启动真实 WebView2、`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 开放 CDP，`connectOverCDP` 连 9222 断言 3D 渲染。
- [x] **平台约束（关键）**：`connectOverCDP` 是 Chromium 专用协议；Wails 在 Linux（ubuntu）用 WebKitGTK，其远程调试器**不兼容 CDP**，故 `wailsPage` 测试只能在 `windows-latest`（原生 WebView2）跑。`e2e-wails` 当前 `continue-on-error`，待真实 runner 验证稳定后翻为阻塞。
- [x] E2E 失败归档：`playwright-report/` 上传为 artifact（`if: always()`）。
- [x] Vitest 常驻：`test-frontend` job 每次提交必跑（秒级、无运行时）。

> **为何两层而非一层**：单层 `wails dev` 在 ubuntu 上因 WebKit≠CDP 根本连不上，若强行全量阻塞会 100% 红。分层后：可靠 DOM 门禁（`@dom`）作为真·提交门禁；完整 3D 集成（`@webgl`）在正确平台（Windows）上跑且容忍 flake。

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

### Phase 1: E2E 关键路径骨架（✅ 2026-07-07 完成）
- [x] grep 真实菜单选择器（见第三节 Phase 1 表）
- [x] 写 `model-load` / `action-play` / `export-screenshot` 三个 spec（含换装钩子方案）
- [ ] 本地 `wails dev` 起 9222 后 `npm run test:e2e` 实跑验证（本环境无 Wails 运行时，仅 tsc + list 通过）

### Phase 2: 截图基线（✅ 2026-07-07 完成，指纹方案）
- [x] `fingerprint()` 钩子 + `compareToBaseline()` + `__baselines__/` 自动基线

### Phase 3: CI 接入（✅ 2026-07-07 完成，挂 ADR-041）
- [x] ci.yml 新增 `e2e`（ubuntu，`@dom` 阻塞）+ `e2e-wails`（windows，`@webgl`，`continue-on-error`）
- [x] spec 加 `@dom`/`@webgl` tag，`--grep` 切分
- [x] 平台约束记录：connectOverCDP 仅 Chromium，故 `wailsPage` 跑 Windows

### Phase 4: AI 维护（长期）
- [ ] fixture 驱动的 spec 生成/修复 prompt；探索性测试

---

## 六、风险与边界

| 风险 | 等级 | 缓解 |
|------|------|------|
| **套用 Three.js 模板**（外部「Wails E2E 指南」常见） | 高 | 本 ADR 明确 Babylon 导出路径表；`window.__scene` 已按真实符号实现；多 AI 改钩子前先读本 ADR |
| **WebGL canvas 用 `getContext('2d')`** 返回 null 抛错 | 高 | 禁用 2D 哈希；统一走 `window.__capture`（Babylon 截图） |
| **端口误导**（指南写 `34115` 为 Wails v2） | 中 | 本项目用 5173 + 9222；见 1.1 |
| `meshCount` 含系统 mesh（地面/辅助）导致阈值误判 | 中 | 断言阈值（如 `> 10`）而非精确值；换装用 `fingerprint()` 变化 |
| E2E 重（需 Wails 运行时）拖慢日常 | 中 | 默认跑 Vitest；E2E 仅 UI 改动时（AGENTS.md 注释） |
| `mmdRuntime.runtimeAnimation.animationName` 字段名随 babylon-mmd 版本变 | 低 | 已用 `(mmdRuntime as any)?.runtimeAnimation?.animationName ?? 'idle'` 容错 |
| 换装菜单导航脆弱（库→详情→外观→服装变体，3-4 层） | 高 | 据本 ADR 分层断言原则，**换装行为走 `__scene.applyOutfit()` 钩子**（真实路径），不做 E2E DOM 导航；仅对画面做 `fingerprint()` 比对 |
| 截图「golden PNG 像素 diff」对 WebGL 噪点/压缩敏感 | 中 | Phase 2 改用 **16×16 亮度指纹 + 汉明距离（tolerance 0.08）**，对驱动/抗锯齿抖动稳健；主判据仍是数值 |
| 原生 `SaveFile` 截图对话框不可被 `download` 事件拦截 | 中 | 不拦截；断言 `__scene.capture()` 管线 + 菜单入口 DOM |
| **`connectOverCDP` 仅 Chromium 兼容**：Wails 在 Linux 用 WebKitGTK，远程调试器非 CDP | 高 | `wailsPage`（`@webgl`）测试只能在 `windows-latest`（原生 WebView2）跑；Linux ubuntu 仅跑 `vitePage`（`@dom`）作阻塞门禁；详见 ADR-041 §4 |

### 边界

- 本 ADR **不替换** Vitest 单元测试——算法/物理层继续用 Vitest（33 spec 已覆盖）。
- 本 ADR **不引入** Cypress / Go-Rod / 商业 AI 测试平台。
- 本 ADR **不修改** `window.__scene` 之外的生产代码路径；钩子仅在 `import.meta.env.DEV` 下挂载，生产构建剔除。
- 本 ADR **不处理** 模型内资源路径编码（属 ADR-057/058）。
- 多 AI 协作：触碰 `core/main.ts` 等中央文件前，须先在当日 `memory/YYYY-MM-DD.md` 认领（见项目铁律）。

---

## 七、运行指南（Runbook）

> **权威运行手册见 [`frontend/e2e/README.md`](../../frontend/e2e/README.md)**——含前置安装、本地各场景启动命令、报告查看、基线重置、CI 对照与常见失败排查。下文仅给速查。

| 场景 | 前置 | 命令（均在 `frontend/`） | 覆盖 |
|------|------|--------------------------|------|
| 快速 DOM 回归（无需 Wails） | Vite 5173 起好 + `npx playwright install chromium` | 终端A `npm run dev -- --host 127.0.0.1 --port 5173`；终端B `npx playwright test --grep "@dom"` | `@dom` ×5 |
| 完整 3D 集成（需 Wails+WebView2） | 本地装 Wails CLI v3 + Windows WebView2 | 终端A `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"; wails3 dev`；终端B `npx playwright test --grep "@webgl"`（⚠️ `wails dev` 会解析到 v2 报 `wails.json` 缺失；标签须引号） | `@webgl` ×7 |
| 全量（wails3 dev 就绪时） | 同上 | `npx playwright test`（或 `npm run test:e2e`） | 全 14 |
| 报告 | — | `npx playwright show-report`（默认 `:9323`） | — |
| 单元（Vitest） | — | `npm run test` | 33 spec |

CI 门禁：`e2e`(ubuntu, `@dom`, 阻塞) + `e2e-wails`(windows, `@webgl`, `continue-on-error`)，详见 README §7 与 ADR-041 §4。

---

## 八、验证方式

1. **钩子可用**：`wails dev` 起 9222 → Playwright `wailsPage` 打开应用 → `page.evaluate(() => window.__scene.fps)` 返回数值、`meshCount > 0`、`fingerprint()` 返回 256 位串。
2. **模型加载**：`model-load.spec.ts` 加载默认模型后 `waitForFunction(__scene.meshCount > 10)` 通过且 `fps >= 30`。
3. **动作/换装**：`action-play.spec.ts` 切换动作后 `__scene.currentAnimation` 变化；换装经 `__scene.outfitVariants()`/`applyOutfit()` 驱动后 `fingerprint()` 前后不同（变体<2 自动 skip）。
4. **导出**：`export-screenshot.spec.ts` 断言 `__scene.capture()` 返回有效 PNG dataURL，且「截图当前模型」菜单入口可见（原生 SaveFile 对话框不拦截）。
5. **截图基线**：`env-sky.spec.ts` 纯色白屏 `fingerprint()` 与 `__baselines__/env-sky-solid-white.json` 比对（首次自动生成）。
6. **回归**：`npm run check && npm run test`（Vitest）全绿；E2E 在 `wails dev` 就绪下 `npm run test:e2e` 通过。

---

## 九、相关 ADR

- [ADR-041](adr-041-ci-auto-checks.md) — CI 自动检查（E2E 接入点与失败归档挂此）
- [ADR-019](adr-019-xpbd-cloth-simulation.md) — XPBD 布料（约束/粒子即 `__scene` 数据源）
- [ADR-057](adr-057-shift-jis-url-base64.md) / [ADR-058](adr-058-basenameFallbackFS.md) — 资源路径编码（不在本 ADR 范畴）
- [AGENTS.md](../../AGENTS.md) — 测试路由表与 `npm run test:e2e` 入口（2026-07-07 已补）
