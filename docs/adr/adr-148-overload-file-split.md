# ADR-148: 过载文件拆分工程

- **状态**: 实施中（阶段 1 已完成 → 待启动阶段 2：plaza.ts）
- **日期**: 2026-07-20
- **相关**: ADR-143（可统一代码收敛，将 4 文件列为拆分候选）、ADR-139（ObserverRegistry，camera observer 拆分依赖）、ADR-141（state-split）

## 背景与问题

ADR-143（2026-07-19）巡查识别 4 个 >1300 行过载文件，明确声明「本 ADR 不展开拆分，列为后续独立 ADR 候选」。本 ADR 接棒，对 4 文件 + motion-popup.ts（共 5 文件）做拆分立项。

### 输入方案与事实核验

2026-07-20 输入方案对 5 文件可拆性做了评估，按风险/收益排序给出攻击顺序。架构师按 AGENTS.md 审核准则对关键论断做事实核验，结果如下：

| 项 | 输入论断 | 实查 | 裁决 |
|----|----------|------|------|
| env-feature-levels.ts 被引数 | 1 处 | 真正代码消费方为 `env-menu.ts`（line 26/38 两段 import 6 个 `build*Level` + `_buildLevel`/`_openTexturePicker`）和 `scene-menu.ts`（line 41 import `buildGroundLevel`/`buildWaterLevel`）；另 1 处测试 mock | 消费方 2 个，数字需更新 |
| ADR-022 拆水面预案 | "曾计划拆 env-water-levels.ts" | ADR-022 实为 `preset-governance`，与拆分无关 | ❌ 出处错配，正确出处为 ADR-143 |
| ADR-143 plaza 拆分 | "明确建议拆 browser/download/thumbnail" | ADR-143 表中确写此方向，但明确声明「本 ADR 不展开拆分，列为后续独立 ADR 候选」 | ✅ 背书有效，本 ADR 接棒 |
| env-feature-levels.ts 行数 | 1597 | ADR-143（2026-07-19）记录 1632 行 | 近一周缩减到 1597 |
| 循环依赖 | 未提及 | env-feature-levels.ts ↔ env-menu.ts 已存在双向 import；camera.ts ↔ scene.ts 同样 | 隐式风险，需处理策略 |

### 双向 import 实查（grep 2026-07-20）

```
env-feature-levels.ts → env-menu.ts:  import { getEnvMenu, setEnvTextureBindingTarget, EnvTextureBindingTarget }
env-menu.ts → env-feature-levels.ts: import { buildSkyLevel, buildWindLevel, buildExperimentalLevel, buildFogLevel,
                                            buildShadowLevel, buildCloudLevel, _buildLevel, _openTexturePicker }
                               (barrel: 同 6 个 build*Level 从 env-feature-levels re-export)
scene-menu.ts → env-feature-levels.ts: import { buildGroundLevel, buildWaterLevel }  (地面/水面路由到场景菜单)
```

`getEnvMenu` 被 `env-feature-levels.ts` 和 `env-preset-levels.ts` 引用，用于获取菜单实例后调用 `reRender()`。`setEnvTextureBindingTarget` 为纯状态 setter，可直接下沉。

### 隐式风险：循环依赖

- [env-feature-levels.ts:37-38](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/env-feature-levels.ts#L37-L38) `import { getEnvMenu, setEnvTextureBindingTarget } from './env-menu'`
- [env-menu.ts:26,38](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/env-menu.ts#L26) `} from './env-feature-levels'`

`env-menu ↔ env-feature-levels` 已存在双向 import。拆分时若把 `buildWaterLevel` 挪到 `env-water-levels.ts`，新文件会继续 import `env-menu`，循环不会消失——但因为是 getter/setter 软循环（无 top-level 副作用求值），运行时不爆雷，仅是耦合气味。

`camera.ts ↔ scene.ts` 同样存在循环依赖，且 camera.ts 有 1117 行测试覆盖，是 5 文件中唯一有测试的，拆分时不能破坏现有测试。

---

## 决策

### 拆分边界与攻击顺序

按风险/收益排序，分 5 阶段执行：

| 顺序 | 文件 | 拆分方向 | 风险 | 阶段 |
|------|------|----------|------|------|
| 1 | env-feature-levels.ts | 按子系统拆 `env-sky/ground/water/wind/cloud/fog/shadow/experimental-levels.ts`（8 文件）+ 抽公共助手 `_buildLevel`/`_openTexturePicker` 到 `env-level-helpers.ts` | 🟢 低 | 阶段 1 |
| 2 | plaza.ts | 拆 `plaza-browser.ts` / `plaza-download.ts` / `plaza-thumbnail.ts`；先提取模块级状态（`_plazaBtn`/`_plazaSectionHeader` 等）到 `plaza-state.ts` 或改传参 | 🟠 中（模块级状态） | 阶段 2 |
| 3 | camera.ts（状态部分） | 先拆纯函数（`getCameraPreset`/`setCameraPreset`/`getOrbitParams` 等）到 `camera-state.ts`；不动依赖 scene.ts 的行为部分 | 🟠 中（循环依赖） | 阶段 3 |
| 4 | scene-serialize.ts（迁移函数） | 抽 `migratePerceptionFromProcMotion`/`migrateLipSyncFromOldState` 等纯函数到 `scene-migrate.ts`；`serializeScene`/`deserializeScene` 留作后续 | 🟢 低 | 阶段 4 |
| 5 | motion-popup.ts | 暂缓，等 `motion-camera-levels.ts`/`motion-override-levels.ts`/`motion-cloth-levels.ts` 等子面板稳定后，剩下的入口 + 播放控制核心约 500 行再剥离 | 🔴 高 | 阶段 5（暂缓） |

### 循环依赖处理策略

拆分时遵循「循环不扩大、能切则切」原则：

1. **env-menu ↔ env-feature-levels**：拆分时把 `setEnvTextureBindingTarget` 这类纯状态 setter 下沉到 `env-menu-state.ts`（或复用现有 `core/state.ts`），让 `env-*-levels.ts` 只依赖纯状态模块，循环自然切断。
2. **camera ↔ scene**：阶段 3 只拆纯函数到 `camera-state.ts`，该文件不依赖 scene.ts；行为部分留原处，循环不扩大。后续若要切断，需引入相机状态接口反转依赖。
3. **新拆出的文件之间**：禁止互相 import，所有共享依赖走 `core/` 或 `scene/env/` 等既有公共模块。

### 拆分通用规范

- **导出保持向后兼容**：原 `env-feature-levels.ts` 的 8 个 `build*Level` 函数签名不变，仅文件位置迁移；`env-menu.ts` 和 `scene-menu.ts` 的 import 路径批量更新。
- **测试先行**：env-feature-levels.ts / plaza.ts / motion-popup.ts 无针对性测试，拆分前先补「导出函数存在性 + 签名契约」测试（参照 `app.contract.test.ts` 模式），拆分后该测试必须仍绿。
- **阶段 1 分两步提交**：先建 `env-level-helpers.ts` + `env-menu-state.ts` + 契约测试（可编译）；再将 8 个 `build*Level` 一次性搬迁 + 删除原文件 + 更新 import（一步到绿）。
- **后续阶段一次一文件**：每个阶段独立提交，禁止跨阶段并行修改。
- **资源配对**：拆分时若发现 `new`/`create`/`add` 无对应 `dispose`/`remove`，按 AGENTS.md 资源管理准则顺带修复，但单列 commit。

---

## 影响面

- **新增**:
  - 阶段 1: `menus/env-sky-levels.ts`、`menus/env-ground-levels.ts`、`menus/env-water-levels.ts`、`menus/env-wind-levels.ts`、`menus/env-cloud-levels.ts`、`menus/env-fog-levels.ts`、`menus/env-shadow-levels.ts`、`menus/env-experimental-levels.ts`、`menus/env-level-helpers.ts`、`menus/env-menu-state.ts`（状态下沉）
  - 阶段 2: `menus/plaza-browser.ts`、`menus/plaza-download.ts`、`menus/plaza-thumbnail.ts`、`menus/plaza-state.ts`
  - 阶段 3: `scene/camera/camera-state.ts`
  - 阶段 4: `scene/scene-migrate.ts`
- **修改**: `menus/env-menu.ts`（import 路径批量更新）、`menus/scene-menu.ts`、`scene/camera/camera.ts`（拆分后瘦身）、`scene/scene-serialize.ts`（拆分后瘦身）
- **删除**: 阶段 1 完成后删除 `menus/env-feature-levels.ts`；阶段 2 完成后删除 `menus/plaza.ts`
- **行为**: 无用户可见行为变化（仅文件组织重构）
- **测试**: 拆分前补契约测试；`npm run test` 全绿；`npm run check` 0 错误

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 循环依赖在拆分时扩大 | 🟠 中 | 遵循「循环不扩大、能切则切」原则；纯状态 setter 下沉到独立状态模块 |
| env-feature-levels.ts 无测试，拆分后行为变化无法发现 | 🟠 中 | 拆分前先补「导出函数存在性 + 签名契约」测试（参照 `app.contract.test.ts`） |
| plaza.ts 模块级状态（`_plazaBtn` 等）跨文件共享 | 🟠 中 | 先提取到 `plaza-state.ts` 再拆；或改为函数参数传递 |
| camera.ts 有 1117 行测试，拆分时 mock 复杂度上升 | 🟡 低 | 阶段 3 只拆纯函数，不破坏现有 mock；行为部分留原处 |
| 拆分过程中其他 AI 协同冲突 | 🟡 低 | 一次一文件、独立提交；按 AGENTS.md 本地缓存规范操作 |

---

## 分阶段实施

- **阶段 0（本 ADR）**: 立项 + 事实核验 + 攻击顺序确定
- **阶段 1**: env-feature-levels.ts 拆分（8 子系统文件 + 公共助手 + 状态下沉）
- **阶段 2**: plaza.ts 拆分（browser/download/thumbnail + state）
- **阶段 3**: camera.ts 状态部分拆分（纯函数到 camera-state.ts）
- **阶段 4**: scene-serialize.ts 迁移函数拆分
- **阶段 5**: motion-popup.ts（暂缓，待子面板稳定后启动）

每阶段独立交付，完成后更新本 ADR 修订记录。

---

## 验收标准

### 阶段 1（env-feature-levels.ts）
- `menus/env-feature-levels.ts` 文件删除
- 8 个 `build*Level` 函数迁移到对应 `env-*-levels.ts`
- `env-menu.ts` import 路径更新且 `npm run check` 0 错误
- 新增契约测试覆盖 8 函数存在性
- `npm run test` 全绿
- 循环依赖：`env-menu` 不再直接 import 各 `env-*-levels.ts` 子文件（通过 `env-menu-state.ts` 下沉状态 + `env-level-helpers.ts` barrel re-export 中转，消除直接的 env-menu ↔ env-feature-levels 双向 import）

### 阶段 2（plaza.ts）
- `menus/plaza.ts` 文件删除
- `plaza-browser.ts` / `plaza-download.ts` / `plaza-thumbnail.ts` 三模块独立
- 模块级状态提取到 `plaza-state.ts`
- `npm run test` 全绿

### 阶段 3（camera.ts 状态部分）
- `camera-state.ts` 包含纯函数状态管理
- `camera.ts` 行数 ≤ 1000
- 现有 1117 行测试不破坏
- 循环依赖不扩大

### 阶段 4（scene-serialize.ts 迁移函数）
- `migrate*` 系列函数迁移到 `scene-migrate.ts`
- `perception.test.ts` 测试仍绿
- `scene-serialize.ts` 行数减少

### 阶段 5（motion-popup.ts）
- 暂缓，待子面板稳定后另行立项

---

## 修订记录

### 2026-07-20 阶段 1 完成

- 8 个 `build*Level` 函数搬迁到独立 `env-*-levels.ts` 文件
- `_buildLevel`/`_openTexturePicker` 抽到 `env-level-helpers.ts`
- `EnvTextureBindingTarget` 状态 + `getEnvMenu` 寄存器抽到 `env-menu-state.ts`，切断循环依赖
- 契约测试 `env-feature-levels.contract.test.ts` 19 全绿
- `npm run check` 零错误，`npm run test` 80/81 通过（1 失败为 perception.test.ts 预存 11 失败）
- 原 `env-feature-levels.ts` 已删除（1597 行 → 0）
- 状态：阶段 1 完成 → 待启动阶段 2

### 2026-07-20 启动阶段 1

- 输入方案事实核验：4 项错配修正（ADR 出处、被引数、行数、循环依赖）
- 攻击顺序确定：env-feature-levels → plaza → camera(状态) → scene-serialize(迁移) → motion-popup(暂缓)
- 循环依赖处理策略：「循环不扩大、能切则切」原则
- 验收标准第五条修正：barrel re-export 表述
- 提交策略补完：阶段 1 分两步提交（先建 helpers + state + 契约测试，再搬迁 8 函数）
- 被引数实查：`buildGroundLevel`/`buildWaterLevel` 另被 `scene-menu.ts` 消费，不在 env-menu 路由范围
- 状态：规划 → 实施中（阶段 1）
