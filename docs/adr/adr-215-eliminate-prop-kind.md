# ADR-215: 取消「道具」资源类型 — 模型附属关系替代 prop + accessory 体系

- **状态**: 🔄 实施中
- **日期**: 2026-07-30
- **相关**: ADR-045（统一加载架构）、ADR-048（变换系统统一）、ADR-049（轨道控制扩展）、ADR-061（骨骼挂载 Accessory）、ADR-212（命名审计）、ADR-193（稳定模型标识）
- **源码锚点**: `frontend/src/scene/env/props/`（全目录）、`frontend/src/menus/scene-prop-levels.ts`、`frontend/src/menus/resource-detail-helpers.ts`、`frontend/src/core/scene-state.ts`（propRegistry）、`frontend/src/core/load-manager.ts`（`'prop'` 分支）、`frontend/src/scene/scene-serialize.ts`（props 序列化）、`frontend/src/menus/library-actions.ts`（`m.type === 'prop'` 分支）、`frontend/src/scene/render/lighting-shadow.ts`（propRegistry 阴影遍历）
- **ADR 冲突**: 本 ADR 完成时 `scene/env/props/accessory.ts`（ADR-061 产出）连同 `props.ts` 整体废弃

---

## 一、问题陈述

### 1.1 「道具」是一个虚构的中间概念

当前系统中 `kind: 'prop'` 的资源类型试图涵盖两类完全不同的使用场景：

| 使用场景 | 实际配布方式 | 用户预期 |
|---------|-------------|---------|
| **场景装饰**（椅子/路灯/树木） | 随舞台配布，或作为独立布景文件 | 属于场景/舞台的一部分 |
| **角色配件**（剑/麦克风/头饰） | 随高人气角色 PMX 打包，内部已做骨骼绑定 | 随角色一起加载，不该是独立实体 |

「道具」把两类本质不同的事物强行统一，导致：

1. **场景布景**需要走独立的 `loadProp` + 独立详情页（变换/材质/危险），体验割裂
2. **角色武器**需要 `attachToBone` 复杂链路——但 MMD 配布文化中武器直接嵌在 PMX 网格里就解决了
3. propRegistry 与 modelRegistry 功能重叠（`model-loader.ts:749` 已把 prop 目录下的 PMX 同时注册到 propRegistry）

### 1.2 现有代码已出现裂痕

- `model-loader.ts:749-755`：prop 目录下的 PMX 同时注册到 `propRegistry` → 说明「一个 PMX 文件是 actor 还是 prop」只取决于它在哪个目录，没有本质区别
- `accessory.ts` 的命名自 ADR-212 已被标记为「不知道放哪就扔进 env/」的典型案例
- `scene-stage-levels.ts:33-39`：道具列表视图已经从 modelRegistry 中过滤位于 prop 目录下的 actor 模型 → 实质上是把 prop 当成一个**文件夹分类**来用，而不是一个资源类型

---

## 二、决策

### 2.1 取消 `kind: 'prop'` 资源类型，废除 propRegistry

`ResourceKind` 中移除 `'prop'`，`propRegistry` 整体删除。**两条路径各归其位**（决策已收敛为方案 B）：

- **角色配件**（剑/麦克风/头饰等随角色使用的 PMX）→ 走「模型附属关系（Model Attachment）」：作为 `modelRegistry` 中的普通 `actor`，通过 `parentId` / `attachedBone` 挂到主模型。
- **场景装饰**（椅子/路灯/树木等布景）→ 走「舞台/场景资产」体系：归入 `stage/` 目录，作为舞台的附属 `TransformNode`，与舞台一起序列化。

两类不再共享任何中间类型，也不进 `propRegistry`。原有两类使用场景分别吸收：

#### 场景装饰 → 归入舞台/场景资产

- 场景装饰文件（glTF/glb/PMX）直接在 `stage/` 目录下管理
- 加载后作为 scene stage 的附属 TransformNode，与舞台一起序列化/反序列化
- 不再有独立的「道具库」入口和 prop 详情页

#### 角色配件 → 模型附属关系（Model Attachment）

**核心思路**：不改变模型扫描/分类体系，角色配件 PMX 一律作为 `actor` 加载到 `modelRegistry`（与初音、其他角色同级）。在 `ModelInstance` 上增加可选附属字段：

```typescript
interface ModelInstance {
  // ... 现有字段
  /** 如果此模型是其他模型的附属，记录父模型 ID（ADR-193 稳定标识） */
  parentId?: string;
  /** 附属到的骨骼名（空表示场景级跟随，不 attachToBone） */
  attachedBone?: string;
  /** 骨骼局部偏移 */
  attachedOffset?: [number, number, number];
  /** 骨骼局部旋转（度） */
  attachedRotation?: [number, number, number];
}
```

**关键原则**：模型库扫描器**零改动**。一把剑的 `.pmx` 和初音的 `.pmx` 在资源库中同样显示为模型，用户加载后通过 UI 建立附属关系。

### 2.2 骨骼锚定能力迁移

在 `model-manager.ts` **新建** `attachModelToBone` / `detachModelFromBone`（model-centric API），原 `accessory.ts` 的 `attachToBone` 随文件删除一并移除——是「新建等价 API + 删旧」，而非单纯搬迁：

```typescript
// 新 API（model-manager.ts）
function attachModelToBone(
    childId: string,         // 附属模型（武器）的 modelRegistry id
    parentId: string,        // 主模型（角色）的 modelRegistry id
    boneName: string,        // 目标骨骼名
    offset?: [number, number, number],
    rotation?: [number, number, number]
): boolean;

function detachModelFromBone(childId: string): void;
```

`reattachAllAccessories` / `detachModelAccessories` 保留，改为遍历 `modelRegistry` 中所有 `parentId !== undefined` 的实例。

### 2.3 卸载连锁

卸载父模型（角色）时，级联卸载其附属子模型（角色配件），语义与当前 `detachModelAccessories` 一致，遍历目标从 `propRegistry` 变为 `modelRegistry`。

**区分「解除附属」与「销毁实例」**：

- 用户主动「解除附属」（`detachModelFromBone`）：子模型仅脱离父级，保留在 `modelRegistry` 中，可再次独立加载或挂到其他模型。
- 卸载父模型触发的级联：视为「随主体一起销毁」——因为该配件本就是为这个角色加载的。若配件是用户此前**独立加载**后再附属的，级联销毁会一并移除，这是预期行为；如需保留，应在此之前先「解除附属」。

场景装饰不属于此连锁：它们由 `stage` 体系按舞台生命周期管理，随舞台一起释放。

### 2.4 附属关系完整性约束

- **DAG 校验**：建立 `parentId` 时禁止成环（A 附属 B、B 又附属 A，或更深的环）。建立前做可达性检查，拒绝会成环的请求并提示用户。
- **单父限制**：一个子模型同时只能有一个 `parentId`（一对多、多对一允许，多对多禁止）。换父需先 `detach` 再 `attach`。
- **骨骼名解析 guard**：`attachedBone` 必须能在父模型 `runtimeBones` 中找到；找不到时拒绝附属并提示「父模型无此骨骼」，不静默失败。

---

## 三、设计细节

### 3.1 用户交互路径

```
模型库浏览
  └─ 看到所有 PMX（角色、武器、配件…一律显示，均为 actor）
       ├─ 加载 初音ミク.pmx → modelRegistry 多了一个 actor
       └─ 加载 初音ミク_剣.pmx → modelRegistry 又多了一个 actor
            └─ 右键/详情页 → 新增「附属到模型」入口
                 ├─ 选择父模型：下拉列表（modelRegistry 中排除自己）
                 ├─ 选择骨骼：父模型的 runtimeBones 下拉列表
                 └─ 可选偏移/旋转滑块（同当前 boneOffset/boneRotation）
```

> 场景装饰不入模型库：它们由 `stage/` 体系管理，在舞台编排层放置。原 `scene-prop-levels` 对 prop 目录的过滤随之取消——模型库中将自然显示角色配件 actor。大模型库内的分类/检索可由后续目录或标签筛选增强（不在本 ADR 强制范围）。

### 3.2 关键设计约束

| 约束 | 理由 |
|------|------|
| 角色配件 PMX 走 `modelRegistry`；场景装饰不入 `modelRegistry`，归 `stage` 体系 | 两者本质不同：配件是角色的运行时附属，装饰是舞台的持久布景；`propRegistry` 才是问题的根源 |
| 扫描器零改动 | 不需要引入 manifest 或特殊标签来区分「这是武器还是角色」 |
| `parentId` 存 **ADR-193 稳定模型标识**（非运行期实例 id） | 跨会话/重加载后仍能正确重建附属链，避免运行期指针失效 |
| 骨骼锚定走 `attachToBone`，场景级跟随走 `setParent` | `attachedBone` 为空时子模型仅用 `setParent` 跟随父模型的场景坐标 |

### 3.3 序列化表示

```typescript
interface SerializedModel {
  // ... 现有字段
  parentId?: string;          // ADR-193 稳定标识引用
  attachedBone?: string;
  attachedOffset?: [number, number, number];
  attachedRotation?: [number, number, number];
}
```

反序列化采用 **deferred reattach**：先按场景文件把所有模型（含父与子）全部加载进 `modelRegistry`，再统一重建附属链——若某子模型的 `parentId` 指向的父模型尚未就绪，将其放入「待重连队列」，父模型加载完成后消费队列补建。这样不依赖严格的序列化顺序，父模型缺失也不会导致子模型挂空。

### 3.4 与当前系统的对应关系

| 当前 | 迁移后 |
|------|--------|
| `propRegistry` + `modelRegistry` 双源 | 仅 `modelRegistry` 单源（场景装饰不入 registry，归 `stage`） |
| `props.ts` 的 `loadProp` / `removeProp` | 全部走 `loadManager.load({kind:'actor',...})` / `removeModel` |
| `accessory.ts` 的 `attachPropToBone(propId, ...)` | `modelManager.attachModelToBone(childId, ...)` |
| `accessory.ts` 的 `detachModelAccessories(modelId)` | `modelManager.detachChildModels(parentId)` |
| `scene-prop-levels.ts`（prop 详情页） | 在 actor 详情页的通用骨架中增加「附属关系」卡片 |
| `buildBoneAttachCard` | actor 详情页中新增「附属到主模型」+「子模型管理」两个卡片 |
| prop 路径设置 | 删除（外部道具不再需要独立目录） |

---

## 四、影响范围

### 4.1 直接删除的文件/模块

| 文件 | 理由 |
|------|------|
| `frontend/src/scene/env/props/props.ts` | 独立道具加载/移除/变换逻辑，全部删除 |
| `frontend/src/scene/env/props/accessory.ts` | 骨骼锚定能力移入 model-manager，原文件删除 |
| `frontend/src/scene/env/props/index.ts` | barrel 重导出，删除 |
| `frontend/src/menus/scene-prop-levels.ts` | prop 详情菜单页，删除 |

### 4.2 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `frontend/src/core/types.ts` | `ModelInstance` 增加 `parentId` / `attachedBone` / `attachedOffset` / `attachedRotation` 可选字段；删除或忽略 `PropInstance` |
| `frontend/src/core/scene-state.ts` | 删除 `propRegistry` / `setPropRegistry` |
| `frontend/src/core/load-manager.ts` | 删除 `'prop'` 分支；`ResourceKind` 中去掉 `'prop'` |
| `frontend/src/core/path.ts` | `isStageLike` 去掉 `'prop'` |
| `frontend/src/core/utils.ts` | 删除 `MIME_CATEGORY_MAP` 和 `THUMBNAIL_CATEGORY_MAP` 中的 prop 条目 |
| `frontend/src/scene/scene-serialize.ts` | 删除 props 序列化/反序列化分支，清理 propUuidMap；ModelInstance 序列化加入 parentId 等字段 |
| `frontend/src/scene/scene.ts` | 删除 prop 相关注册/清理 |
| `frontend/src/scene/render/lighting-shadow.ts` | 删除 propRegistry 阴影遍历，改为遍历 modelRegistry 全部实例 + stage 装饰 |
| `frontend/src/scene/manager/material.ts` | 核查 `_externalMeshes` 是否仍被 `stage`/其他模块引用；若无引用则随 prop 一并删除，否则清除 prop 相关注释（当前疑似死代码，需实现期确认） |
| `frontend/src/scene/manager/thumbnail-capture.ts` | 删除 `renderPropThumbnail`；角色配件缩略图直接复用 actor 缩略图路径（`captureModelThumbnail`），不另起一套 |
| `frontend/src/scene/manager/model-loader.ts` | 删除 `propRegistry.set` 分支（`model-loader.ts:749-755`） |
| `frontend/src/scene/manager/model-manager.ts` | **新增** `attachModelToBone` / `detachModelFromBone` / `reattachAllAttachments` / `detachChildModels` |
| `frontend/src/menus/resource-detail-helpers.ts` | 删除 `buildBoneAttachCard`；`buildTransformCard` 和 `buildDangerCard` 中的 `kind === 'prop'` 分支改为统一走 actor 逻辑 |
| `frontend/src/menus/library-actions.ts` | 删除 `m.type === 'prop'` 加载分支 |
| `frontend/src/menus/library-core.ts` | 删除 `'prop'` 分类相关逻辑 |
| `frontend/src/menus/scene-stage-levels.ts` | 删除 prop 过滤逻辑 |
| `frontend/src/menus/settings-resources.ts` | 删除 prop 路径设置项 |
| `frontend/src/core/action-defs/settings-actions.ts` | 删除 `'settings:set:path:prop'` action |
| `frontend/src/core/backend/browser-adapter.ts` | 删除 `'prop'` 文件类型映射 |
| `frontend/src/core/i18n/locales/*.ts` | 删除 `scene.prop*`、`common.prop`、`settings.paths.prop`、`scene.accessory.*` 等 key |
| `frontend/src/scene/transform/transform-adapter.ts` | props 的 adapter 随 `props.ts` 删除；modelManager 注册的 adapter 已覆盖 actor |
| `frontend/src/__tests__/*.ts` | 所有 prop 相关 mock 和测试用例 |

### 4.3 保留但迁移的功能

| 功能 | 去向 |
|------|------|
| 场景装饰的 3D 位置/旋转/缩放 | 归入 scene stage 编排层，使用与现有环境系统一致的 TransformNode 管理 |
| 外部网格的骨骼锚定 | `modelManager.attachModelToBone(childId, parentId, boneName, offset, rotation)` |
| 阴影投射 | `lighting-shadow.ts` 的阴影遍历改为遍历 `modelRegistry` 全部实例（actor + 附属）与 `stage` 装饰 |
| 材质调节 | stage 已有材质入口（ADR-045 产出）；附属模型随主模型走原有材质 API |

---

## 五、迁移步骤

### Phase 1（概念清理）— 本 ADR
1. 写此 ADR，确认范围与设计（方案 B：两路各归其位）
2. 锁定所有 `kind: 'prop'` 和 `propRegistry` 引用点（已在上方清单中列出）

### Phase 2（删除 prop 体系）
1. 删除 `props.ts`、`accessory.ts`、`index.ts`、`scene-prop-levels.ts`
2. 删除 `propRegistry` / `setPropRegistry`
3. 删除 `load-manager.ts` 的 `'prop'` 分支
4. 清理 `library-actions.ts` / `library-core.ts` 的 prop 分类
5. 清理 `scene-serialize.ts` 的 prop 序列化 + propUuidMap
6. 清理 `lighting-shadow.ts` 的 prop 阴影遍历
7. 清理 `settings-resources.ts` + `settings-actions.ts` 的 prop 路径
8. 清理 `browser-adapter.ts` 的 prop 文件类型
9. 清理 i18n 中 prop / accessory 相关 key
10. 清理测试 mock 和测试用例

### Phase 3（模型附属功能实现）
1. `ModelInstance` 增加 `parentId` / `attachedBone` / `attachedOffset` / `attachedRotation` 字段（parentId 取 ADR-193 稳定标识）
2. `model-manager.ts` 新增 `attachModelToBone` / `detachModelFromBone` / `reattachAllAttachments` / `detachChildModels`，含 DAG 校验与骨骼名 guard（§2.4）
3. `resource-detail-helpers.ts`（或新的 model-detail 卡片）新增「附属到主模型」UI（父模型选择 + 骨骼选择 + 偏移/旋转）
4. 卸载父模型时级联卸载子模型（§2.3 语义边界）
5. 序列化/反序列化加入 parentId 等字段，采用 deferred reattach（§3.3）

### Phase 4（文档与测试）
1. 删除 `docs/knowledge/props.md`、`props-index.md`、`accessory.md`
2. 更新 `docs/knowledge/README.md` 索引
3. 运行 `npm run check:docs` 验证文档完整性
4. 运行全量测试

---

## 六、被否决的方案

### 方案 A：保留 prop 但改名为「场景装饰」

仅改名字不解决根本问题——场景装饰的加载时机、生命周期归属与角色配件依然矛盾。改名只是推迟了认知成本。

### 方案 B：拆成 scene-decoration 和 character-accessory 两种子类型

引入子类型增加系统复杂度，而两种子类型分别有更自然的归属（stage / model），没必要在中间层增加抽象。

> 注：本节「方案 B」指被否决的「拆子类型」方案，与 §2.1 决策中采用的**方案 B（两路各归其位）**命名相同但含义不同——后者是「角色配件归 modelRegistry、场景装饰归 stage」的落点选择，非新增子类型。为避免歧义，决策采用的落点记为 **方案 B′**。

### 方案 C：引入 manifest 文件标记附属关系

给角色文件夹加 `.mmd-bundle.json` 声明哪些文件是主体、哪些是配件。太重——破坏了「加载 PMX 就能用」的零摩擦体验，且与现有 MMD 配布文件的目录结构不兼容。

---

## 七、不变量

迁移前后需保证以下行为不变：

1. ✅ 场景文件的加载/保存/恢复不丢失任何已放置的布景网格和模型附属关系
2. ✅ 模型的阴影投射不受影响（`lighting-shadow.ts` 改为遍历 `modelRegistry` + `stage`）
3. ✅ 材质调节能力不丢失（stage 已有材质入口；附属模型随模型走原有材质 API）
4. ✅ 模型库中所有 PMX 文件仍然可见、可加载（角色配件统一为 actor）
5. ✅ 骨骼锚定后的视觉位置和跟随行为与当前 `attachToBone` 完全一致

---

## 八、审核记录（2026-07-30）

思路层审核后收敛为**方案 B′（两路各归其位）**，并消化以下审查意见：

- **P1（已解决 · 原自相矛盾）**：原约束表「所有 PMX 统一走 modelRegistry」与「场景装饰走 stage」冲突。B′ 解读下二者本就分属两条路径——角色配件 PMX 入 `modelRegistry`，场景装饰归 `stage` 体系（不入 `modelRegistry`）。已重写 §2.1 与约束表 3.2。
- **P2（已吸纳 · 稳定标识）**：`parentId` 必须存 ADR-193 稳定模型标识，而非运行期实例 id；已写入约束表 3.2 与 §3.3 deferred reattach。
- **P2（已吸纳 · 反序列化顺序）**：§3.3 改为 deferred reattach（先全加载再重建附属链，父缺失入待重连队列），不再依赖序列化顺序。
- **P3（已吸纳 · 级联 vs 销毁）**：§2.3 明确「解除附属」与「随主体销毁」的语义边界。
- **P3（已吸纳 · 环/单父/骨骼名）**：§2.4 新增 DAG 校验、单父限制、骨骼名 guard。
- **P4（措辞修正）**：§2.2 改为「新建等价 API + 删旧」而非搬迁；§4.2 `_externalMeshes` 标记为待确认死代码；`renderPropThumbnail` 删除后缩略图复用 actor 路径。
- **P3（UX 备注）**：场景装饰归入 `stage/` 后不再出现在模型库，原 `scene-prop-levels` 的 prop 目录过滤随之取消，模型库中将自然显示角色配件 actor；如需在大模型库内区分，后续可加目录/标签筛选（不在本 ADR 强制范围）。
