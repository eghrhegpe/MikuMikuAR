---
kind: harness_visual_verify
name: 组件隔离渲染 harness 视觉验证层
tier: leaf
category: ui
scope:
  - frontend/harness/**
source_files:
  - frontend/harness/index.html
  - frontend/harness/main.ts
  - frontend/harness/shot.mjs
adr:
  - ADR-229
symbols:
invariants:
  - 面板打开只经 navActions 真实链路（toggleOverlay 管 visible/inert/aria），不得手写 visible 类旁路
  - 面板清单单源在 main.ts REGISTRY，shot.mjs 无参运行时从 window.__harnessRegistry__ 读取，禁止在脚本侧抄一份
  - harness 页面骨架是 index.html body 的手工拷贝，index.html 改骨架须同步本页
use_when:
  - 看单个菜单面板长什么样（秒级截图回看，不起全 app / 不跑 e2e）
  - 改面板布局/样式后快速视觉回归取证
  - 给 AI 开发流程提供 UI 布局截图（大模型看图评布局）
---

# 组件隔离渲染 harness 视觉验证层

## 系统概览

`frontend/harness/` 三件套：单菜单面板隔离打开 + Playwright 秒级截图。不跑 `bootstrap()`、零 3D 引擎、零改动 `src/` 生产代码；面板打开走 `navActions` 真实链路（`toggleOverlay` 管 visible/inert/aria/setPopupOpen），与真人点击同源。灵感移植自 ysm-model-manager 的同名层，形态按本仓「Schema 驱动原生 DOM 菜单」重塑（无 Web Components 可挂）。

## 核心职责

- `index.html` — 骨架页：index.html body 静态拷贝（去启动诊断/defer 脚本，`#loading` 内联隐藏，不带 `app-booting`）；`<head>` 内联脚本在任何 src 模块求值前锁 `uiLang=zh-CN`（截图确定性）
- `main.ts` — REGISTRY 面板注册表（library/scene/env/settings/assistant）+ 就绪协议（`body[data-ready=1]` / 失败 `data-error`，轮询 8s 上限 + 双 rAF 落帧）
- `shot.mjs` — 截图驱动：生成语言包 → 起 vite dev(:5299) → 逐面板开页 → 等就绪 → 截图落 `_shots/`（gitignore，不进版本库）。默认按弹窗范围（`#sceneOverlay.visible` boundingBox + 12px 呼吸边）裁剪，喂大模型评审零黑边；`--full` 切全页（看面板在 app 中的摆放上下文）

## 对外 API / 入口

```bash
cd frontend && node harness/shot.mjs            # 全量 REGISTRY（清单从页面读），默认弹窗范围裁剪
cd frontend && node harness/shot.mjs settings   # 单面板
cd frontend && node harness/shot.mjs --full     # 全页模式（含 app 摆放上下文）
```

- 页面：`/harness/index.html?c=<面板名>`；无参页供 shot.mjs 读清单
- 新增面板：main.ts REGISTRY 加一条 `名称: () => navActions[N]()` 即可；若面板依赖 bootstrap 后才有的运行时状态则**不收**（见脆弱面）

## 与其他子系统关系

- 复用 `menus/nav-actions.ts` 的 `navActions` 动作表（ADR-238 加载锚点 `library-setup` 同款 import）
- i18n 依赖 `public/locales/*.json`（`../scripts/generate-locale-json.mjs` 产物），shot.mjs 截图前幂等重生成
- e2e（`playwright.config.ts` + `e2e/wails-fixture.ts`）管全 app 行为回归 + 硬断言；harness 只管单面板隔离视觉，粒度不重叠

## 已知脆弱面

- **动作库（navActions[2]）不可收**：buildRoot 链上读取 bootstrap 后才初始化的运行时状态（实测 pageerror `Cannot read properties of undefined (reading 'size')`）。要看动作库布局走 e2e vitePage。
- **骨架双源漂移**：index.html 增删骨架元素时本 harness 页不会自动跟上；`dom.ts` 的引用在缺元素时为 undefined，症状是面板打开时报错——改 index.html 骨架时同步本页。
- **图标依赖外网**：iconify-icon 运行时从 api.iconify.design 拉图标，离线环境截图会缺图标（布局仍可评）。
- **端口撞车**：同机其它仓如有同名 `/harness/index.html` 的 vite 残留，shot.mjs 靠页面指纹（`MikuMikuAR harness`）识别并 fail-fast，遇报错换 PORT。
- **stale server 假绿**：残留 vite 占 :5299 时 spawn 的 vite 因 `--strictPort` 立即退出但探测照样通过——shot.mjs 已做 exit 置位 + 显式警告，警告出现时截图可能是旧代码。

## 验证入口

- 命令：`cd frontend && node harness/shot.mjs`（退出码非 0 = 有面板失败，失败面板不产图）
- 类型检查：`cd frontend && npx tsc --noEmit`（harness 已纳入 tsconfig include）
- 无单测：dev-only 工具层，验证即「跑得出图、退出码干净」
