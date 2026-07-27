# ADR-197: 统一动作注册表 — 菜单可维护性归一化

- **状态**: 🔄 规划（Phase 0 待 ADR-155 Phase 1 落地后启动）
- **日期**: 2026-07-28
- **相关**: ADR-155（NL 控场景，注册表的消费者）、ADR-093（声明式菜单 Schema）、ADR-196（AiService 传输层）、ADR-191（禁止神桶，纯/叶子模块导入规则）

---

## 背景

ADR-155 实施前的代码事实核对暴露了动作系统的根因问题：**缺乏单一动作真相源**。现状如下：

- 35+ 离散 action 分布在 5 个文件，合计 1922 行：`settings-actions.ts`(78) / `scene-menu.ts`(526) / `motion-popup.ts`(324) / `env-menu.ts`(307) / `library-actions.ts`(687)。
- 至少 3 种 handler 接入模式并存：target-string→Record 查表、click handler 内联 if/else 链、直接函数调用。
- 参数契约不一致：枚举值（`CameraMode` / `PerformanceMode`）、数值范围（`dirIntensity` 0–1 vs `envBrightness` 0.1–3）、数据结构（`dirColor` 元组 vs hex 字符串）各自为政。
- `loadModelNormal` / `replaceMotion` 为模块内私有函数且需 `LibraryModel` 对象，外部（含 NL 层）不可直接调用。

后果：菜单渲染、NL catalog、快捷键、E2E testid 各自维护一份"动作清单"，漂移不可避免。ADR-155 初版 6/8 参数即因未核对真实代码而失真——这正是菜单无统一契约的直接代价。若不治理，后续任何跨菜单能力（NL 控、快捷键、可访问性审计）都会重复踩同一坑。

## 目标

建立 `ActionRegistry`，一条 `registerAction()` 同时驱动：

1. **菜单声明式渲染** —— 读 `listActions(domain)` 生成 MenuNode，消除 5 文件的"手写 handler 路由" boilerplate。
2. **NL 工具编目（ADR-155）** —— catalog 由 registry 自动导出，单一真相源，失配类 bug 归零。
3. **快捷键绑定** —— 动作 `id` 即快捷键 key。
4. **E2E testid / ARIA** —— 由 `ActionDef.id` 自动派生（对齐现有 `data-testid` 派生机制）。

## 设计决策

### 1. ActionDef 契约

```typescript
type ParamType = 'enum' | 'color' | 'range' | 'entity' | 'boolean' | 'toggle';

interface ParamDef {
  name: string;
  type: ParamType;
  enum?: readonly string[];            // 代码侧合法值
  synonyms?: Record<string, string>;   // NL 同义词 → 代码值（high→quality, follow→freefly）
  min?: number; max?: number; step?: number; // range 专用
  resolve?: (name: string) => Promise<unknown>; // entity：name → 对象
}

interface ActionDef {
  id: string;            // 如 'light:dirIntensity'，命名空间化
  label: string;
  domain: 'settings' | 'scene' | 'motion' | 'env' | 'library';
  icon?: string;
  params: ParamDef[];
  execute: (params: Record<string, unknown>) => void | Promise<void>;
  destructive?: boolean; // 走二次确认
}
```

`ParamDef` 由本注册表定义一次，ADR-155 的 `param-adapters.ts` 直接消费，**不重复定义**——保证 NL 翻译层与菜单渲染层共享同一套参数词汇表。

### 2. 注册表 API

`registerAction(def)` / `getAction(id)` / `listActions(domain?)` / `unregisterAction(id)`。模块级 `Map<string, ActionDef>` 存储，纯叶子、零依赖。

### 3. 菜单渲染改造

各域菜单文件改为：遍历 `listActions(domain)` 生成节点，onClick → `getAction(id).execute(params)`。复杂交互（库搜索、异步加载、竞态）允许"自定义渲染 + 仍 registerAction 提供契约"，registry 不强制吞下所有 UI——避免为迁就注册表而扭曲既有交互。

### 4. NL catalog 收敛

ADR-155 的 `action-catalog.ts` 退化为 registry 的"NL 视图"：`buildToolSchemas() = listActions().map(toToolSchema)`，其中 `ParamDef` 即 JSON Schema 来源，`param-adapters.ts` 的 4 类适配器直接认 `ParamDef.type`。单一真相源确立后，ADR-155 的"代码事实核对"类失真不再可能发生。

## 实施计划（分阶段，不阻塞 ADR-155）

| Phase | 范围 | 内容 | 估计 |
|-------|------|------|------|
| 0 | 注册表内核 | 定义 `ActionRegistry` + `ActionDef`/`ParamDef` 类型 + `registerAction`/`getAction`/`listActions`；先被 ADR-155 的 `param-adapters.ts` 复用 `ParamDef`（不接菜单） | ~120 行 |
| 1 | 首批 8 动作 | ADR-155 的 8 动作迁入 registry；`action-catalog.ts` 改为从 registry 导出（单一真相源，修正 6/8 失配）；导出 `loadModelNormal`/`replaceMotion` 薄封装（`loadLibraryModel`/`loadLibraryMotion`，保留模块级 AbortController 竞态守卫） | ~160 行 |
| 2 | settings 域 | `settings-actions.ts`(78) 迁移 → 菜单读 registry 渲染 | 中 |
| 3 | scene 域 | `scene-menu.ts`(526) 迁移 | 大 |
| 4 | env + motion 域 | `env-menu.ts`(307) + `motion-popup.ts`(324) 迁移 | 大 |
| 5 | library 域 | `library-actions.ts`(687) 迁移，含对象解析封装 | 大 |
| 终态 | — | 5 文件从"路由+handler"瘦身为例外/自定义 UI；新增动作只 `registerAction` 一行 | — |

迁移策略：**童子军法则**，按域机会性迁移，每次迁移顺带把该域菜单改为读 registry 渲染；不一次性重写，避免用户面回归。

## 收益

- **菜单可维护性↑**：新增/修改动作只改一处 `registerAction`，消除 5 文件重复路由。
- **NL catalog 与菜单单一真相源**，参数失配类 bug 归零（ADR-155 初版 6/8 失真不再复现）。
- **testid / ARIA / 快捷键自动派生**，一致性↑，可访问性审计成本↓
- **动作 `execute` 与 UI 解耦**，可独立单测（复用现有 139 函数契约测试守护签名）。

## 风险与护栏

- 大范围迁移需契约测试守护 handler 签名；复杂交互不全适配 registry → 允许自定义渲染 + 仍注册契约。
- `loadModelNormal` / `replaceMotion` 导出封装须保留既有竞态守卫（模块级 AbortController），不可为注册而破坏异步安全。
- 不阻塞 ADR-155 交付：Phase 0/1 与 ADR-155 协同，Phase 2+ 独立排期，按域滚动。

## 修订记录

| 日期 | 修订 |
|------|------|
| 2026-07-28 | 初版，作为 ADR-155 暴露的菜单可维护性问题的归一化规划；确立 `ActionRegistry` + `ParamDef` 单一真相源路线 |
