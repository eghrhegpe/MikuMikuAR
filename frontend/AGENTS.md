# frontend/ — 前端子包专用 AGENTS.md

> **定位**：前端构建/测试命令 + TypeScript 硬约定 + 「去哪里查」指针。
> AI 在 `frontend/` 内编辑时优先读本文件；根 [`AGENTS.md`](../AGENTS.md) 是项目宪法 + 全局文档地图。
> **本文件不手列目录树 / 函数清单 / ADR 状态** —— 这些一律由自动生成器产出或查 `docs/`（见第三章），手工维护必漂移。

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
| `npm run test:warm` | 预热 esbuild transform cache | 首跑前执行，避免冷启动静默期迷惑 AI；跑最小测试 `goerr.test.ts`，~2-3s |
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
git add .                                              # 暂存自己
git commit -m "chore: cache work before check"        # 本地缓存（不触发 pre-commit）
npm run check                                          # 记录基线错误数
git reset --soft HEAD~1                                # 撤销缓存，改动放回暂存区
npm run check                                          # 确认未新增错误
```

> ⚠️ 禁止使用 `git stash`，多 AI 协作下 `git stash pop` 会产生大量工作区冲突。统一使用 `git commit` + `git reset --soft` 做本地缓存（详见根 AGENTS.md 本地缓存章节）。

---

## 二、TypeScript 约定

> 完整编译选项以 `frontend/tsconfig.json` 为唯一真相源，本文件**不复制其状态表**（避免漂移）。
> ⚠️ **如实记录现状，不承诺 strict 化政策**。靠 code review 人工把关。

### 2.1 当前关键事实（2026-07-25 校准）
- `strict: false` —— 历史遗留，未启用严格模式。
- 路径别名：`@/*` → `src/*`、`@bindings/*` → `bindings/*`（2026-07-08 添加）。新代码优先使用别名导入。
- `core/config.ts` 为 barrel re-export；实际实现已拆至 `types.ts` / `state.ts`（内部再拆 `scene-state` / `playback-state` / `library-state` / `ui-state`，ADR-141）/ `dom.ts` / `utils.ts` 等子模块。跨模块共享类型优先放 `core/types.ts`。
- 项目**没有**集中的 `src/types/` 目录；interface/type 就近放置，跨模块共享类型放 `core/types.ts`。

### 2.2 写新代码的硬规则
- **不要新增 `any` 逃生** —— 即使 `strict: false` 允许，新代码仍要避免 `as any` / `@ts-ignore` / `@ts-expect-error`。需要时加注释说明业务理由。
- **binding 自动生成（禁手写 `bindings/`）** —— `frontend/bindings/` 由 `npm run generate:bindings` 自动产出 .ts 绑定（含 FNV-1a 32-bit method ID，生成器自动算）。新增/删除 Go 方法后重跑生成器即可，禁止手维护 `bindings/` 下 .ts。`src/core/wails-bindings.ts`（model 类型登记 + re-export 聚合）**不归生成器管、保持手维护**。**唯一真陷阱：`-clean` 默认 true 会先清空输出目录** —— 脚本已带 `-d frontend/bindings` 故安全；切勿裸跑 `wails3 generate bindings -dry`（仍会清空默认目录）。TS 侧统一通过 `src/core/wails-bindings.ts` re-export 引入。`app.contract.test.ts` 动态校验导出函数存在性 + FNV-1a ID，仅作生成器输出一致性护栏。

---

## 三、「去哪里查」指针（本文件不手列事实索引）

> 目录树 / 函数清单 / ADR 状态 / 模块依赖 **一律自动生成或查 `docs/`，禁止在本文件手工维护**（与 `check:docs` / `check:funcmap` 护栏哲学一致，防止漂移）。

| 要查什么 | 怎么查 |
|----------|---------|
| 函数 / 符号在哪个文件 | `npm run gen:funcmap` → `docs/function-map.md`（扫描 `frontend/src/` 全量 TS，按模块分组；改后跑 `npm run check:funcmap` 校验一致性） |
| 模块依赖关系图 | `npm run dep:graph`（Mermaid）/ `npm run dep:graph:list`（缩进列表） |
| ADR 决策 + 状态 | 改 ADR 文件首部 `status` 字段，`npm run gen:status -- --reverse` 自动生成索引表到 `docs/status.md` |
| 设计意图 / 原子知识卡 | `docs/knowledge/`（先读 `README.md` 索引 → 按 `source_files` 跳源码） |
| 全局文档地图 | 根 [`AGENTS.md`](../AGENTS.md) §「去哪里查」 |

> 若发现某模块「现在长啥样、去哪找」的现状快照缺失，优先更新 `docs/knowledge/` 知识卡，而非回写本文件。
