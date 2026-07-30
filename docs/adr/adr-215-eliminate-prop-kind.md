# ADR-215: 取消「道具」资源类型 — 场景装饰归入舞台，角色配件归入模型

- **状态**: 📋 规划
- **日期**: 2026-07-30
- **相关**: ADR-045（统一加载架构）、ADR-048（变换系统统一）、ADR-049（轨道控制扩展）、ADR-061（骨骼挂载 Accessory）、ADR-212（命名审计）、ADR-193（稳定模型标识）
- **源码锚点**: `frontend/src/scene/env/props/`（全目录）、`frontend/src/menus/scene-prop-levels.ts`、`frontend/src/menus/resource-detail-helpers.ts`、`frontend/src/core/scene-state.ts`（propRegistry）、`frontend/src/core/load-manager.ts`（`'prop'` 分支）、`frontend/src/scene/scene-serialize.ts`（props 序列化）、`frontend/src/menus/library-actions.ts`（`m.type === 'prop'` 分支）、`frontend/src/scene/render/lighting-shadow.ts`（propRegistry 阴影遍历）
- **ADR 冲突**: 本 ADR 完成时 `scene/env/props/accessory.ts`（ADR-061 产出）整体废弃

---

## 一、问题陈述

### 1.1 「道具」是一个虚构的中间概念

当前系统中 `kind: 'prop'` 的资源类型试图涵盖两类完全不同的使用场景：

| 使用场景 | 实际配布方式 | 用户预期 |
|---------|-------------|---------|
| **场景装饰**（椅子/路灯/树木） | 随舞台配布，或作为独立布景文件 | 属于场景/舞台的一部分 |
| **角色配件**（剑/麦克风/头饰） | 随高人气角色 PMX 打包，内部已做骨骼绑定 | 随角色一起加载，不该是独立实体 |

这两类场景的加载时机、归属关系、用户交互路径完全不同，强行统一为「道具」导致：

1. 消费者需要额外在 prop 目录加载布景 → 不如直接塞进 stage 目录
2. 角色武器需要 `attachToBone` 这套复杂链路 → 但实际 MMD 配布文化中，武器直接嵌在 PMX 的网格里
3. propRegistry 作为一个独立状态源，与 modelRegistry 产生重叠（`model-loader.ts:749` 甚至已把 prop 目录下的模型同时注册到 propRegistry）

### 1.2 现有代码已出现裂痕

- `model-loader.ts:749-755`：prop 目录下的 PMX 同时注册到 `propRegistry` → 说明「一个 PMX 文件是 actor 还是 prop」只取决于它在哪个目录，没有本质区别
- `accessory.ts` 的命名自 ADR-212 已被标记为「不知道放哪就扔进 env/」的典型案例
- `scene-stage-levels.ts:33-39`：道具列表视图已经从 modelRegistry 中过滤位于 prop 目录下的 actor 模型 → 实质上是把 prop 当成一个**文件夹分类**来用，而不是一个资源类型

---

## 二、决策

### 2.1 取消 `kind: 'prop'` 资源类型

将 `propRegistry` 废除，`ResourceKind` 中移除 `'prop'`。原有两个使用场景分别吸收：

#### 场景装饰 → 归入舞台/场景资产

- 场景装饰文件（glTF/glb/PMX）直接在 `stage/` 目录下管理
- 加载后作为 scene stage 的附属 TransformNode，与舞台一起序列化/反序列化
- 位置/变换由场景编排层统一管理（类似现有的 `env-ground` / `env-foliage` 调度模式）
- 不再有独立的「道具库」入口

#### 角色配件 → 归入模型包

- 选择路径 A（推荐）：配布方直接将配件网格加入 PMX 文件（MMD 标准做法，本系统零改动）
- 选择路径 B（可选）：对需要「独立文件 + 骨骼锚定」的正统用户，提供一种**模型附属文件机制**：
  - 在模型加载时，自动扫描同目录下的 `.boneslot.json` 或约定命名的 `.glb` 文件
  - 加载后由模型管理器直接调用 `attachToBone`（不再经过 propRegistry）
  - 此功能作为**可选扩展**，不在本次 ADR 范围内，仅预留扩展点

### 2.2 保留且仅保留 `accessory.ts` 的骨骼锚定能力

`attachToBone` / `detachFromBone` 的逻辑本身是正确的，问题在于它挂在一个独立的「道具」概念上。路径 B 中该能力会被复用，但从 prop-centric API 改为 model-centric API：

```typescript
// 改造后（示意）
modelManager.attachExternalMesh(modelId, mesh, boneName, offset, rotation);
modelManager.detachExternalMesh(modelId, meshId);
```

---

## 三、影响范围

### 3.1 直接删除的文件/模块

| 文件 | 理由 |
|------|------|
| `frontend/src/scene/env/props/props.ts` | 独立道具加载/移除/变换逻辑，全部删除 |
| `frontend/src/scene/env/props/accessory.ts` | 重构成 modelManager 的方法，原文件删除 |
| `frontend/src/scene/env/props/index.ts` | barrel 重导出，删除 |
| `frontend/src/menus/scene-prop-levels.ts` | prop 详情菜单页，删除 |

### 3.2 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `frontend/src/core/scene-state.ts` | 删除 `propRegistry` / `setPropRegistry` |
| `frontend/src/core/load-manager.ts` | 删除 `'prop'` 分支，`ResourceKind` 中去掉 `'prop'` |
| `frontend/src/core/path.ts` | `isStageLike` 去掉 `'prop'` |
| `frontend/src/core/utils.ts` | 删除 `MIME_CATEGORY_MAP` 和 `THUMBNAIL_CATEGORY_MAP` 中的 prop 条目 |
| `frontend/src/scene/scene-serialize.ts` | 删除 props 序列化/反序列化分支，清理 propUuidMap |
| `frontend/src/scene/scene.ts` | 删除 prop 相关注册/清理 |
| `frontend/src/scene/render/lighting-shadow.ts` | 删除 propRegistry 阴影遍历，改为遍历 modelRegistry 全部 |
| `frontend/src/scene/manager/material.ts` | `_externalMeshes` 注册表保留（仍可被 stage/其他依赖使用），清除 prop 相关注释 |
| `frontend/src/scene/manager/thumbnail-capture.ts` | 删除 `renderPropThumbnail` |
| `frontend/src/scene/manager/model-loader.ts` | 删除 `propRegistry.set` 分支（`model-loader.ts:749-755`） |
| `frontend/src/menus/resource-detail-helpers.ts` | 删除 `buildBoneAttachCard`，简化 `buildTransformCard` 和 `buildDangerCard` 中的 `kind === 'prop'` 分支 |
| `frontend/src/menus/library-actions.ts` | 删除 `m.type === 'prop'` 加载分支 |
| `frontend/src/menus/library-core.ts` | 删除 `'prop'` 分类相关逻辑 |
| `frontend/src/menus/scene-stage-levels.ts` | 删除 prop 过滤逻辑（`model-loader.ts` 不再将 prop 目录下的 actor 注册为 prop） |
| `frontend/src/menus/settings-resources.ts` | 删除 prop 路径设置项 |
| `frontend/src/core/action-defs/settings-actions.ts` | 删除 `'settings:set:path:prop'` action |
| `frontend/src/core/backend/browser-adapter.ts` | 删除 `'prop'` 文件类型映射 |
| `frontend/src/core/i18n/locales/*.ts` | 删除 `scene.prop*`、`common.prop`、`settings.paths.prop` 等 key |
| `frontend/src/scene/transform/transform-adapter.ts` | `registerTransformAdapter` 中 props 的 adapter 随 `props.ts` 删除 |
| `frontend/src/__tests__/*.ts` | 所有 prop 相关 mock 和测试用例 |

### 3.3 保留但转移的功能

| 功能 | 去向 |
|------|------|
| 场景装饰的 3D 位置/旋转/缩放 | 归入 scene stage 编排层，使用与现有环境系统一致的 TransformNode 管理 |
| 外部网格的骨骼锚定 | 移至 `ModelManager.attachExternalMesh()`，作为模型管理器的附属能力 |
| 阴影投射 | `lighting-shadow.ts` 的阴影遍历改为遍历 modelRegistry 所有实例（actor + stage）即可覆盖现用场景 |
| 材质调节 | stage 已有材质入口（ADR-045 产出），无需额外适配；角色配件随模型走原有材质 API |

---

## 四、迁移步骤（Phase）

### Phase 1（概念清理）
1. 写此 ADR，确认范围
2. 锁定所有 `kind: 'prop'` 引用点（已在上方清单中列出）
3. 通知用户侧：prop 目录不再作为独立资源库展示

### Phase 2（代码删除）
1. 删除 `props.ts`、`accessory.ts`、`index.ts`、`scene-prop-levels.ts`
2. 删除 `propRegistry` 及相关 API
3. 删除 `load-manager.ts` 的 `'prop'` 分支
4. 清理 `library-actions.ts` 和 `library-core.ts` 的 prop 分类
5. 清理 `scene-serialize.ts` 的 prop 序列化
6. 清理 `lighting-shadow.ts` 的 prop 阴影遍历
7. 清理 `settings-resources.ts` 的 prop 路径设置

### Phase 3（功能归并）
1. 确认 stage 的材质入口已覆盖原 prop 的材质调节需求（ADR-045 已落地）
2. 确认 modelRegistry 遍历已覆盖阴影 caster（stage 场景装饰的网格需在 modelRegistry 中注册）
3. 为路径 B（外部骨骼锚定）预留 API 签名，但不实现

### Phase 4（文档与测试）
1. 删除 `docs/knowledge/props.md`、`props-index.md`、`accessory.md`
2. 更新 `docs/knowledge/README.md` 索引
3. 运行 `npm run check:docs` 验证文档完整性
4. 运行全量测试，修复 prop 相关 mock 依赖

---

## 五、被否决的方案

### 方案 B：保留 prop 但改名为「场景装饰」

仅改名字不解决根本问题——场景装饰的加载时机、生命周期归属与角色配件依然矛盾。改名只是推迟了认知成本。

### 方案 C：将 prop 拆成 scene-decoration 和 character-accessory 两种子类型

引入子类型增加系统复杂度，而两种子类型分别有更自然的归属（stage / model），没必要在中间层增加抽象。

---

## 六、不变量

迁移前后需保证以下行为不变：

1. ✅ 场景文件的加载/保存/恢复不丢失任何已放置的布景网格
2. ✅ 模型的阴影投射不受影响（`lighting-shadow.ts` 改为遍历 `modelRegistry`）
3. ✅ 材质调节能力不丢失（stage 已有材质入口；模型附属随模型）
4. ✅ 场景装饰的位置、旋转、缩放保持在用户最后设置的值
