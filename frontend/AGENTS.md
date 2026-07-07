# frontend/ — 前端子包专用 AGENTS.md

> **定位**：前端构建/测试/TypeScript 约定/目录索引。
> AI 在 `frontend/` 内编辑时优先读本文件；根 [`AGENTS.md`](../AGENTS.md) 是项目宪法 + 全局文档地图。
> 与本项目其他文档的关系见 AGENTS.md §一「文档地图」。

---

## 一、构建与测试命令

> **执行位置**：所有命令在 `frontend/` 目录内执行。

| 命令 | 用途 | 说明 |
|------|------|------|
| `npm run dev` | 启动 Vite 开发服务器（HMR） | 仅开发态，不调用 Wails binding |
| `npm run build` | 生产构建 | = `tsc && vite build`，先类型检查再打包 |
| `npm run build:dev` | 仅 vite build（跳过 tsc） | 快速验证 bundle 能否产出 |
| `npm run check` | 类型检查（`tsc --noEmit`） | **改完前端必跑**，验证未新增 tsc 错误 |
| `npm run test` | Vitest 单元测试（run 模式） | 一次性跑全量测试 |
| `npm run test:watch` | Vitest 监听模式 | 修改测试文件自动重跑 |
| `npm run test:coverage` | Vitest + 覆盖率 | v8 provider |
| `npm run test:e2e` | Playwright E2E | 端到端测试 |
| `npm run test:e2e:headed` | Playwright 有界面模式 | 调试用 |
| `npm run lint` | ESLint 检查 | `eslint src --ext .ts,.tsx,.js,.jsx` |
| `npm run lint:fix` | ESLint 自动修复 | |
| `npm run format` | Prettier 格式化 | 写代码后跑一次 |
| `npm run format:check` | Prettier 检查 | CI 用 |

### 高频最小集

```bash
# 改完一段代码后
npm run check && npm run test && npm run build
```

### tsc 基线检查（多 AI 协作时）

```bash
git stash                                              # 暂存自己
npm run check                                          # 记录基线错误数
git stash pop                                          # 解暂存
npm run check                                          # 确认未新增错误
```

---

## 二、TypeScript 约定

### 2.1 `tsconfig.json` 当前状态

| 选项 | 当前值 | 含义 |
|------|--------|------|
| `strict` | **`false`** | 历史遗留，未启用严格模式 |
| `target` / `module` | `ESNext` | 现代 ES |
| `moduleResolution` | `Bundler` | 配合 Vite |
| `noUnusedLocals` / `noUnusedParameters` | `false` | 不报未使用 |
| `noImplicitReturns` | `false` | 不报缺失 return |
| `isolatedModules` | `true` | 配合 esbuild 单文件转译 |
| `skipLibCheck` | `true` | 跳过 node_modules 类型检查 |
| `include` | `src`, `bindings` | Wails 生成的 binding 也参与类型检查 |

### 2.2 写新代码的约定

> ⚠️ **如实记录现状，不承诺 strict 化政策**。靠 code review 人工把关。

- **不要新增 `any` 逃生** — 即使 `strict: false` 允许，新代码仍要避免 `as any` / `@ts-ignore` / `@ts-expect-error`。需要时加注释说明业务理由。
- **类型定义就近放置** — 项目**没有**集中的 `src/types/` 目录。interface/type 与使用它的文件同模块放置；跨模块共享类型放 `core/types.ts`（config.ts 已拆分为 types / state / dom / utils 四个子模块，通过 barrel re-export 保持 import 兼容）。
- **没有路径别名** — `tsconfig.json` 无 `paths` 配置。一律用相对路径 import（如 `import { dom } from '../core/config'`）。
- **binding 不可手改** — `frontend/wailsjs/go/` 是 Wails 自动生成。改 Go binding 后跑 `wails3 generate` 或在主代理处 build。

---

## 三、前端目录索引

```
frontend/src/
├── core/                # 基础设施
│   ├── main.ts          # ★ 应用入口（事件绑定 + 快捷键 + 初始化）
│   ├── config.ts        # barrel re-export → types.ts / state.ts / dom.ts / utils.ts
│   ├── fileservice.ts   # resolveFileUrl 统一文件 URL 解析
│   ├── icons.ts         # Iconify 图标创建
│   ├── iconify-registry.ts  # 本地图标注册表
│   ├── ui-helpers.ts    # DOM 构建工具（slideRow / addToggleRow 等）
│   ├── dialog.ts        # 通用对话框
│   ├── reactivity.ts    # 简易响应式（signal / effect）
│   ├── wails-bindings.ts # Wails Go binding 类型封装
│   └── physics/         # 状态→桥接辅助（仅 wind-utils；新物理逻辑放 src/physics/）
├── scene/               # 3D 场景（Babylon.js）
│   ├── scene.ts             # ★ 场景编排入口
│   ├── scene-serialize.ts   # 场景序列化
│   ├── camera/              # 相机模式
│   ├── motion/              # [桥接层] 动作桥接（vmd-loader / proc-motion-bridge / lipsync-bridge / playback）→ 调 src/motion-algos/ 算法
│   ├── manager/             # 模型管理（model-manager / material / loader / ops）
│   ├── env/                 # 环境系统（env.ts + env-impl.ts + env-bridge.ts + env-water / cloud / particle / lighting-preset / props）
│   └── render/              # 渲染管线（renderer / lighting 灯光管理 / performance）
├── menus/               # SlideMenu 弹窗系统
│   ├── menu.ts          # 通用菜单导航组件
│   ├── library*.ts      # 模型库（扫描/搜索/层级/标签）
│   ├── model-*.ts       # 模型详情/材质/预设
│   ├── env-*.ts         # 环境菜单（天空/水面/风/云/预设）
│   ├── scene-*.ts       # 场景菜单（渲染/舞台/道具）
│   ├── motion-*.ts      # [UI层] 动作菜单（动作绑定/相机/程序化/LipSync/布料）
│   └── settings*.ts     # 设置页（UI 主题 / 外部库 / 软件管理）
├── motion-algos/              # [算法层] 动作生成算法，无 Babylon 依赖（供 scene/motion/ 调用）
│   ├── procedural-motion.ts    # Idle / AutoDance VMD 生成
│   ├── vmd-writer.ts           # VMD 二进制写入（Shift-JIS 骨骼名）
│   ├── vpd-parser.ts           # VPD 姿势解析→VMD
│   ├── beat-detector.ts        # 节拍检测（Web Audio API）
│   └── lipsync.ts              # 振幅→morph 权重
├── outfit/              # 换装系统
│   ├── outfit.ts        # 加载/应用/重置 + 自动发现
│   └── audio.ts         # 音频播放 + VMD 同步 + 节拍检测挂载
├── physics/             # XPBD 物理引擎（独立目录）
│   ├── xpbd-solver.ts    # Verlet + 约束 + 地面碰撞
│   ├── xpbd-cloth.ts     # 布料生成 + 每帧更新
│   ├── xpbd-collider.ts  # SDF 胶囊碰撞体
│   ├── xpbd-renderer.ts  # 调试可视化
│   └── cloth-manager.ts  # 创建/销毁/重建（UI 入口）
└── app.css              # 全局样式（CSS 变量体系）
```

### 目录重组记录（2026-07）

`scene/` 已按业务域拆分为 `camera/` / `motion/` / `manager/` / `env/` / `render/` 子目录。`physics/` 为独立目录（XPBD 引擎），`motion-algos/` 为动作算法独立目录。相机 UI 已迁移到 `motion-popup`。

