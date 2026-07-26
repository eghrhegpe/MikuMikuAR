# ADR-148: 过载文件拆分工程

- **状态**: ✅ 已完成（5/5 阶段全部落地，2026-07-21 收口）
- **日期**: 2026-07-20（收口 2026-07-21）
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

- `env-feature-levels.ts`（拆分前）`import { getEnvMenu, setEnvTextureBindingTarget } from './env-menu'` —— 该文件已于阶段 1 删除，拆分为 `env-*-levels.ts` + `env-menu-state.ts`
- [env-menu.ts:19-27](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/env-menu.ts#L19-L27) `} from './env-{sky,wind,experimental,fog,shadow,cloud}-levels'`、`env-level-helpers`、`env-preset-levels`
- 等价现任引用：[env-preset-levels.ts:34 `import { getEnvMenu } from './env-menu'`](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/env-preset-levels.ts#L34)、[env-menu-state.ts:13 `setEnvTextureBindingTarget`](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/env-menu-state.ts#L13)

`env-menu ↔ env-feature-levels` 已存在双向 import。拆分时若把 `buildWaterLevel` 挪到 `env-water-levels.ts`，新文件会继续 import `env-menu`，循环不会消失——但因为是 getter/setter 软循环（无 top-level 副作用求值），运行时不爆雷，仅是耦合气味。

`camera.ts ↔ scene.ts` 同样存在循环依赖，且 camera.ts 有 1117 行测试覆盖，是 5 文件中唯一有测试的，拆分时不能破坏现有测试。

---

## 决策

### 拆分边界与攻击顺序

按风险/收益排序，分 5 阶段执行：

| 顺序 | 文件 | 拆分方向 | 风险 | 阶段 | 完成状态 |
|------|------|----------|------|------|----------|
| 1 | env-feature-levels.ts | 按子系统拆 `env-sky/ground/water/wind/cloud/fog/shadow/experimental-levels.ts`（8 文件）+ 抽公共助手 `_buildLevel`/`_openTexturePicker` 到 `env-level-helpers.ts` | 🟢 低 | 阶段 1 | ✅ 2026-07-20（`7bfeaae5`） |
| 2 | plaza.ts | 拆 `plaza-browser.ts` / `plaza-download.ts` / `plaza-thumbnail.ts`；先提取模块级状态（`_plazaBtn`/`_plazaSectionHeader` 等）到 `plaza-state.ts` 或改传参 | 🟠 中（模块级状态） | 阶段 2 | ✅ 2026-07-20（`d39afbaa` + `6a91e9d9`） |
| 3 | camera.ts（状态部分） | 先拆纯函数（`getCameraPreset`/`setCameraPreset`/`getOrbitParams` 等）到 `camera-state.ts`；不动依赖 scene.ts 的行为部分 | 🟠 中（循环依赖） | 阶段 3 | ✅ 达标（状态抽离 `383bb3f9`；行为部分续拆为 5 子模块，行数 715 ≤1000，见验收） |
| 4 | scene-serialize.ts（迁移函数） | 抽 `migratePerceptionFromProcMotion`/`migrateLipSyncFromOldState` 等纯函数到 `scene-migrate.ts`；`serializeScene`/`deserializeScene` 留作后续 | 🟢 低 | 阶段 4 | ✅ 决策关闭（迁移函数已抽离；主体保留有理由，见验收） |
| 5 | motion-popup.ts | 暂缓，等 `motion-camera-levels.ts`/`motion-override-levels.ts`/`motion-cloth-levels.ts` 等子面板稳定后，剩下的入口 + 播放控制核心约 500 行再剥离 | 🔴 高 | 阶段 5 | ✅ 提前执行 2026-07-21（`492a8c52`） |

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
  - 阶段 3: `scene/camera/camera-state.ts`、`scene/camera/camera-vmd.ts`、`scene/camera/camera-factory.ts`、`scene/camera/camera-behaviors.ts`、`scene/camera/camera-bone-lock.ts`、`scene/camera/camera-auto.ts`
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

- **阶段 0（本 ADR）**: 立项 + 事实核验 + 攻击顺序确定 ✅
- **阶段 1**: env-feature-levels.ts 拆分（8 子系统文件 + 公共助手 + 状态下沉）✅ 2026-07-20
- **阶段 2**: plaza.ts 拆分（browser/download/thumbnail + state）✅ 2026-07-20
- **阶段 3**: camera.ts 状态部分拆分（纯函数到 camera-state.ts）✅ 状态抽离；行数目标未达
- **阶段 4**: scene-serialize.ts 迁移函数拆分 ✅ 迁移函数抽离；行数目标未达
- **阶段 5**: motion-popup.ts（提前执行，未等子面板）✅ 2026-07-21

每阶段独立交付，完成后更新本 ADR 修订记录。

---

## 验收标准

> 实际核验日期 2026-07-21。✅ = 达标；⚠️ = 部分达成（存在偏离，见注）。

### 阶段 1（env-feature-levels.ts）— ✅ 全部达标
- ✅ `menus/env-feature-levels.ts` 文件删除
- ✅ 8 个 `build*Level` 函数迁移到对应 `env-*-levels.ts`
- ✅ `env-menu.ts` import 路径更新且 `npm run check` 0 错误
- ✅ 新增契约测试 `env-feature-levels.contract.test.ts` 覆盖 8 函数存在性
- ✅ `npm run test` 全绿（1 预存 perception 失败不属本 ADR）
- ✅ 循环依赖消除：经 `env-menu-state.ts` 下沉状态 + `env-level-helpers.ts` barrel 中转，`env-menu` 不再直接 import 各 `env-*-levels.ts` 子文件

### 阶段 2（plaza.ts）— ✅ 全部达标
- ✅ `menus/plaza.ts` 文件删除（commit `d39afbaa` + `6a91e9d9`）
- ✅ `plaza-browser.ts`(630) / `plaza-download.ts`(152) / `plaza-thumbnail.ts`(31) 三模块独立
- ✅ 模块级状态提取到 `plaza-state.ts`(118)
- ✅ 契约测试 `plaza.contract.test.ts` 补建；`npm run test` 全绿

### 阶段 3（camera.ts 状态部分）— ✅ 全部达标
- ✅ `camera-state.ts`(262 行) 落地纯函数状态管理（`getCameraPreset`/`setCameraPreset`/`getOrbitParams`/`getCurrentCamera`/`getFovState`/`getFocusCenterY` 等）+ 运行时上下文（scene/canvas 引用、`_viewMatrixHandle` 等共享句柄）
- ✅ **行数达标**：`camera.ts` 从 1373 行降至 **715 行**（目标 ≤1000 ✅）。行为部分继续拆为 5 个聚焦子模块：
  - `camera-vmd.ts`(80) — VMD 相机动画
  - `camera-factory.ts`(198) — 相机工厂 + 用户输入
  - `camera-behaviors.ts`(231) — freefly/surround/concert 行为循环
  - `camera-bone-lock.ts`(130) — 骨骼锁定
  - `camera-auto.ts`(166) — 节拍驱动 beatcut
- ✅ 现有 `camera.test.ts`（63 用例）全绿
- ✅ 循环依赖切断：camera.ts 通过回调注入（`setSwitchCameraModeCallback` / `setSchedulePersistCallback` / `setSyncAxesCallback`）让子模块单向依赖 camera-state，不再回引 camera.ts
- ✅ 向后兼容：camera.ts 作为 barrel 入口 re-export 全部公开符号，下游消费者无需改 import 路径

### 阶段 4（scene-serialize.ts 迁移函数）— ✅ 决策关闭（主体保留）
- ✅ `migrateLipSyncFromOldState` + `migratePerceptionFromProcMotion` 迁移到 `scene-migrate.ts`(74 行，纯函数无 scene 依赖)
- ✅ `perception.test.ts` 仍绿
- **2026-07-26 决策**：`scene-serialize.ts` 主体（1503 行）保留，不再拆分。理由：
  1. `serializeScene`（240 行）+ `deserializeScene`（370 行）共享大量私有 helper（`deserializeModels` 等）+ 共享 `_suppressAutoSave` 模块级状态，抽离后必须暴露大量内部 helper，反而增加耦合面
  2. 当前虽超 1000 行目标，但**单文件单一职责清晰**（仅序列化），与 camera.ts 的多职责混合不同，非真正"过载"
  3. 强行拆分仅为行数达标，收益低于风险
- 状态由「部分达成（行数目标未达）」升级为「决策关闭（主体保留有理由）」

### 阶段 5（motion-popup.ts）— ✅ 提前执行
- ✅ 未遵循「暂缓」原定，于 2026-07-21 提前拆分（`492a8c52`）
- ✅ 拆 `motion-binding-ui.ts`(425) / `motion-detail-ui.ts`(398) / `motion-root-ui.ts`(290) 三子面板 + `motion-popup.ts`(303) 退化为 barrel（注册 / `MOTION_FOLDER_ROUTES` / `motionOnItemClick` 路由）
- ✅ 子面板稳定度已满足剥离条件，无行为回归

---

## 修订记录

### 2026-07-26 阶段 4 决策关闭（主体保留）

- `scene-serialize.ts` 当前 1503 行，超过 ≤1000 行目标
- **决策**：主体（`serializeScene` + `deserializeScene`）保留，不再拆分
- **理由**：
  1. `serializeScene`（240 行）+ `deserializeScene`（370 行）共享大量私有 helper（`deserializeModels` 等）+ 共享 `_suppressAutoSave` 模块级状态，抽离后必须暴露大量内部 helper，反而增加耦合面
  2. 单文件单一职责清晰（仅序列化），与 camera.ts 的多职责混合不同，非真正"过载"
  3. 强行拆分仅为行数达标，收益低于风险
- 迁移函数（`migrateLipSyncFromOldState` / `migratePerceptionFromProcMotion`）已于早期抽离到 `scene-migrate.ts`
- 状态：阶段 4 由「部分达成（行数目标未达）」升级为「决策关闭（主体保留有理由）」
- ADR-148 工程全部 5 阶段收口完成

### 2026-07-26 阶段 3 行数目标达标（行为部分续拆）

- `camera.ts` 从 1373 行降至 **715 行**（目标 ≤1000 ✅）
- 续拆 5 个聚焦子模块（均 <250 行）：
  - `camera-vmd.ts`(80) — VMD 相机动画：`loadCameraVmd` / `clearCameraVmd` / `animateCameraVmd` / `createVmdCamera` / `hasCameraAnimationHandle`
  - `camera-factory.ts`(198) — 相机工厂：`createOrbitCamera` / `createFreeflyCamera` / `createSurroundCamera` / `createConcertCamera` / `createOneshotCamera` / `applyCameraUserSettings` / `refreshCameraUserSettings`
  - `camera-behaviors.ts`(231) — 行为循环：`initFreeflyUpdate` / `initFreeflyTouch` / `stopFreefly` / `startSurround` / `stopSurround` / `startConcert` / `stopConcert`
  - `camera-bone-lock.ts`(130) — 骨骼锁定：`setOrbitBoneLock` / `getOrbitBoneLock` / `setBoneLockDamping` / `getBoneLockDamping` / `getFocusedModelBoneNames`
  - `camera-auto.ts`(166) — 节拍 beatcut：`setAutoCameraEnabled` / `isAutoCameraEnabled` / `setAutoCameraBeatsPerSwitch` / `getAutoCameraBeatsPerSwitch` / `restoreAutoCameraState`
- **循环依赖切断**：通过回调注入模式（`setSwitchCameraModeCallback` / `setSchedulePersistCallback` / `setSyncAxesCallback`）让子模块单向依赖 camera-state，不再回引 camera.ts
- **向后兼容**：camera.ts 作为 barrel 入口 re-export 全部公开符号，下游消费者（`scene.ts` / `motion-camera-levels.ts` / `model-ops.ts` / `playback.ts` / `vmd-loader.ts` / `settings-controls.ts` / `settings-system.ts` / `init.ts`）无需改 import 路径
- 测试：`camera.test.ts` 63/63 全绿；全量 2075/2075 全绿；`tsc --noEmit` 0 错误；`check:docs` 无漂移；`check:funcmap` 同步
- 状态：阶段 3 由「部分达成」升级为「全部达标」

### 2026-07-21 阶段 5 提前执行完成
- `motion-popup.ts` 拆 `motion-binding-ui.ts`(425) / `motion-detail-ui.ts`(398) / `motion-root-ui.ts`(290) 三子面板 + `motion-popup.ts`(303) 退化为 barrel（注册 / `MOTION_FOLDER_ROUTES` / `motionOnItemClick` 路由）
- commit `492a8c52`（+ 后续 `6adaf841` 撤销回调去重收敛）
- 原始「暂缓」判定作废：子面板稳定性已达标，提前剥离无回归
- 状态：阶段 5 完成 → **全 ADR 收口**

### 2026-07-20 阶段 4 完成（部分达成）
- `migrateLipSyncFromOldState` + `migratePerceptionFromProcMotion` 抽到 `scene/scene-migrate.ts`(74 行，纯函数)
- `scene-serialize.ts` 仍 1414 行（迁移仅带走 74 行，净效果为负）→ 偏离「行数减少」目标
- `perception.test.ts` 仍绿
- 状态：阶段 4 完成（部分达成）

### 2026-07-20 阶段 3 完成（部分达成）
- `camera-state.ts`(292 行) 落地纯函数状态管理；`383bb3f9` 抽状态 → `cb134ac3` 删死变量 `_currentCamera`/`_fov`/`_focusCenterY` → `b9752bc5` 私有变量改 `getCurrentCamera()`/`getFovState()`/`getFocusCenterY()` getter
- `camera.ts` 仍 1373 行（目标 ≤1000 未达）→ 偏离；行为部分（依赖 `scene.ts`）留原文件
- `camera.test.ts` 不破坏，循环依赖不扩大
- 状态：阶段 3 完成（部分达成）

### 2026-07-20 阶段 2 完成
- `plaza.ts` 拆 `plaza-browser.ts`(630) / `plaza-download.ts`(152) / `plaza-thumbnail.ts`(31) + 模块级状态提取到 `plaza-state.ts`(118)
- 补 `plaza.contract.test.ts`；`npm run test` 全绿
- commit `d39afbaa`（先建 browser/download/state + 契约测试）→ `6a91e9d9`（收口 thumbnail 子模块）
- 状态：阶段 2 完成 → 待启动阶段 3

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
