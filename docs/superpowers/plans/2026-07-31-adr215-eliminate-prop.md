# ADR-215 取消道具类型 实施计划

> **For agentic workers:** 按 Phase 顺序实施，每 Phase 内按 Task 编号依次执行。每完成一个 Task 提交一次（"完成一个，提交一个"流程）。

**Goal:** 消除 `kind: 'prop'` 资源类型和 `propRegistry`，将角色配件归入 `modelRegistry`（模型附属关系），场景装饰归入 `stage/` 体系。

**Architecture:** 两条路径各归其位：
- 角色配件（剑/麦克风/头饰等 PMX）→ `modelRegistry` 中的普通 `actor`，通过 `parentId`/`attachedBone` 建立附属关系
- 场景装饰 → `stage/` 目录体系，由舞台编排层管理

**Tech Stack:** TypeScript, Babylon.js, babylon-mmd, Vitest

---

## File Structure（改动清单）

| 文件 | 责任 | 改动类型 |
|------|------|---------|
| `frontend/src/scene/env/props/props.ts` | 道具加载/移除/变换/轨道控制 | **删除** |
| `frontend/src/scene/env/props/accessory.ts` | 骨骼锚定系统 | **删除** |
| `frontend/src/scene/env/props/index.ts` | barrel 重导出 | **删除** |
| `frontend/src/core/scene-state.ts` | 删除 propRegistry/setPropRegistry | **修改** |
| `frontend/src/core/types.ts` | 删除 PropInstance；ModelInstance 增加附属字段 | **修改** |
| `frontend/src/core/load-manager.ts` | 删除 'prop' 分支 | **修改** |
| `frontend/src/scene/scene-serialize.ts` | 删除 props 序列化；模型加入 parentId 字段 | **修改** |
| `frontend/src/scene/scene.ts` | 删除 prop 相关注册/清理 | **修改** |
| `frontend/src/scene/render/lighting-shadow.ts` | 删除 propRegistry 阴影遍历 | **修改** |
| `frontend/src/scene/manager/model-loader.ts` | 删除 propRegistry.set 分支 | **修改** |
| `frontend/src/scene/manager/model-manager.ts` | 新增 attachModelToBone/detachModelFromBone 等 | **修改** |
| `frontend/src/scene/manager/thumbnail-capture.ts` | 删除 renderPropThumbnail | **修改** |
| `frontend/src/menus/scene-prop-levels.ts` | prop 详情菜单页 | **删除** |
| `frontend/src/menus/resource-detail-helpers.ts` | 删除 buildBoneAttachCard；统一 actor 逻辑 | **修改** |
| `frontend/src/menus/library-actions.ts` | 删除 prop 加载分支 | **修改** |
| `frontend/src/menus/library-core.ts` | 删除 prop 分类逻辑 | **修改** |
| `frontend/src/menus/scene-stage-levels.ts` | 删除 prop 过滤逻辑 | **修改** |
| `frontend/src/menus/settings-resources.ts` | 删除 prop 路径设置项 | **修改** |
| `frontend/src/core/action-defs/settings-actions.ts` | 删除 prop path action | **修改** |
| `frontend/src/core/backend/browser-adapter.ts` | 删除 prop 文件类型映射 | **修改** |
| `frontend/src/core/path.ts` | isStageLike 去掉 'prop' | **修改** |
| `frontend/src/core/utils.ts` | 删除 MIME_CATEGORY_MAP/THUMBNAIL_CATEGORY_MAP 中 prop 条目 | **修改** |
| `frontend/src/scene/transform/transform-adapter.ts` | 删除 prop adapter | **修改** |
| `frontend/src/core/i18n/locales/*.ts` | 删除 prop/accessory 相关 i18n key | **修改** |
| `frontend/src/__tests__/*.ts` | 删除 prop 相关 mock 和测试用例 | **修改** |
| `docs/knowledge/props.md` | 道具系统知识卡 | **删除** |
| `docs/knowledge/props-index.md` | 道具 barrel 知识卡 | **删除** |
| `docs/knowledge/accessory.md` | 附件系统知识卡 | **删除** |
| `docs/knowledge/README.md` | 更新索引 | **修改** |
| `docs/adr/adr-215-eliminate-prop-kind.md` | 状态改为"实施中" | **修改** |

---

## Phase 2: 删除 prop 体系（代码清理）

> 本 Phase 不引入新功能，仅删除 prop 相关代码。所有改动在同一个 Phase 内完成，按 Task 分步提交。

### Task 2.1: 删除 prop 核心文件 + scene-state 清理

**Files:**
- Delete: `frontend/src/scene/env/props/props.ts`
- Delete: `frontend/src/scene/env/props/accessory.ts`
- Delete: `frontend/src/scene/env/props/index.ts`
- Modify: `frontend/src/core/scene-state.ts`（删除 propRegistry 相关）
- Modify: `frontend/src/core/types.ts`（删除 PropInstance 类型）

- [ ] **Step 1: 确认无其他引用 props.ts / accessory.ts**

```bash
cd frontend && grep -r "from.*env/props" src/ --include="*.ts" | grep -v "env/props/"
```

预期：只有 `load-manager.ts`、`scene-serialize.ts`、`scene.ts` 有引用（后续 Task 处理）。

- [ ] **Step 2: 删除 props 目录下的三个文件**

```bash
rm frontend/src/scene/env/props/props.ts
rm frontend/src/scene/env/props/accessory.ts
rm frontend/src/scene/env/props/index.ts
```

如果 `env/props/` 目录只剩空，删除目录。

- [ ] **Step 3: 删除 scene-state.ts 中 propRegistry**

在 `frontend/src/core/scene-state.ts`：
- 删除第 11 行 import 中的 `PropInstance`（保留 `ModelInstance, FeetState`）
- 删除第 60-65 行（propRegistry + setPropRegistry）

- [ ] **Step 4: 删除 types.ts 中 PropInstance 类型**

在 `frontend/src/core/types.ts` 删除第 255-283 行（PropInstance 类型定义）。

- [ ] **Step 5: 类型检查确认无编译错误**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -50
```

预期：有大量引用 prop 的错误（后续 Task 逐步修复）。确认没有意外的非 prop 相关错误。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/scene/env/props/ frontend/src/core/scene-state.ts frontend/src/core/types.ts
git commit -m "refactor(adr-215): delete prop core files, propRegistry, PropInstance type"
```

---

### Task 2.2: 清理 load-manager.ts + path.ts + utils.ts

**Files:**
- Modify: `frontend/src/core/load-manager.ts`
- Modify: `frontend/src/core/path.ts`
- Modify: `frontend/src/core/utils.ts`

- [ ] **Step 1: 删除 load-manager.ts 中 'prop' 分支**

在 `frontend/src/core/load-manager.ts`：
- 第 12 行：`ResourceKind` 中删除 `'prop'` → 变为 `'actor' | 'stage' | 'vmd' | 'audio' | 'camera-vmd' | 'light' | 'personalLight'`
- 第 175-185 行：删除整个 `case 'prop':` 分支

- [ ] **Step 2: 删除 path.ts 中 isStageLike 的 'prop'**

在 `frontend/src/core/path.ts` 找到 `isStageLike` 函数，删除 `'prop'` 条目。

- [ ] **Step 3: 删除 utils.ts 中 prop 条目**

在 `frontend/src/core/utils.ts`：
- 删除 `MIME_CATEGORY_MAP` 中的 prop 键值对
- 删除 `THUMBNAIL_CATEGORY_MAP` 中的 prop 键值对

- [ ] **Step 4: 提交**

```bash
git add frontend/src/core/load-manager.ts frontend/src/core/path.ts frontend/src/core/utils.ts
git commit -m "refactor(adr-215): remove prop from load-manager, path, utils"
```

---

### Task 2.3: 清理 scene 层（scene.ts / lighting-shadow / model-loader / thumbnail-capture / transform-adapter）

**Files:**
- Modify: `frontend/src/scene/scene.ts`
- Modify: `frontend/src/scene/render/lighting-shadow.ts`
- Modify: `frontend/src/scene/manager/model-loader.ts`
- Modify: `frontend/src/scene/manager/thumbnail-capture.ts`
- Modify: `frontend/src/scene/transform/transform-adapter.ts`

- [ ] **Step 1: 清理 scene.ts**

在 `frontend/src/scene/scene.ts`：
- 搜索 `from.*env/props` 的 import，删除
- 搜索 `propRegistry` 所有引用，删除相关代码
- 搜索 `removeProp` 函数，删除
- 搜索 `reattachAllAccessories` / `detachModelAccessories` 调用，**暂时注释掉**（Phase 3 会重建）

- [ ] **Step 2: 清理 lighting-shadow.ts**

在 `frontend/src/scene/render/lighting-shadow.ts`：
- 删除 `propRegistry` 的 import
- 删除阴影遍历中的 propRegistry 循环（约 L23-30）
- 改为遍历 `modelRegistry` 全部实例（actor + 附属）的 meshes

- [ ] **Step 3: 清理 model-loader.ts**

在 `frontend/src/scene/manager/model-loader.ts`：
- 删除 `propRegistry.set` 分支（约 L749-755）

- [ ] **Step 4: 清理 thumbnail-capture.ts**

在 `frontend/src/scene/manager/thumbnail-capture.ts`：
- 删除 `renderPropThumbnail` 函数导出

- [ ] **Step 5: 清理 transform-adapter.ts**

在 `frontend/src/scene/transform/transform-adapter.ts`：
- 删除 `kinds: ['prop']` 的 adapter 注册

- [ ] **Step 6: 提交**

```bash
git add frontend/src/scene/
git commit -m "refactor(adr-215): remove prop from scene layer (scene/lighting/model-loader/thumbnail/transform)"
```

---

### Task 2.4: 清理菜单层（scene-prop-levels / resource-detail-helpers / library-actions / library-core / scene-stage-levels / settings-resources）

**Files:**
- Delete: `frontend/src/menus/scene-prop-levels.ts`
- Modify: `frontend/src/menus/resource-detail-helpers.ts`
- Modify: `frontend/src/menus/library-actions.ts`
- Modify: `frontend/src/menus/library-core.ts`
- Modify: `frontend/src/menus/scene-stage-levels.ts`
- Modify: `frontend/src/menus/settings-resources.ts`
- Modify: `frontend/src/core/action-defs/settings-actions.ts`

- [ ] **Step 1: 删除 scene-prop-levels.ts**

```bash
rm frontend/src/menus/scene-prop-levels.ts
```

- [ ] **Step 2: 清理 resource-detail-helpers.ts**

在 `frontend/src/menus/resource-detail-helpers.ts`：
- 搜索 `buildBoneAttachCard`，删除该函数导出（Phase 3 会在 actor 详情页重建）
- 搜索 `kind === 'prop'` 分支，改为统一走 actor 逻辑

- [ ] **Step 3: 清理 library-actions.ts**

在 `frontend/src/menus/library-actions.ts`：
- 删除 `m.type === 'prop'` 加载分支
- 搜索所有 `prop` 相关 import，删除

- [ ] **Step 4: 清理 library-core.ts**

在 `frontend/src/menus/library-core.ts`：
- 删除 `'prop'` 分类相关逻辑（路径处理、缩略图键生成等）

- [ ] **Step 5: 清理 scene-stage-levels.ts**

在 `frontend/src/menus/scene-stage-levels.ts`：
- 删除 prop 过滤逻辑（约 L33-39）

- [ ] **Step 6: 清理 settings-resources.ts + settings-actions.ts**

在 `frontend/src/menus/settings-resources.ts`：
- 删除 prop 路径设置项

在 `frontend/src/core/action-defs/settings-actions.ts`：
- 删除 `'settings:set:path:prop'` action

- [ ] **Step 7: 提交**

```bash
git add frontend/src/menus/ frontend/src/core/action-defs/
git commit -m "refactor(adr-215): remove prop from menus (levels/actions/library/settings)"
```

---

### Task 2.5: 清理 browser-adapter + i18n + 测试

**Files:**
- Modify: `frontend/src/core/backend/browser-adapter.ts`
- Modify: `frontend/src/core/i18n/locales/zh-CN.ts`
- Modify: `frontend/src/core/i18n/locales/zh-TW.ts`
- Modify: `frontend/src/core/i18n/locales/en.ts`
- Modify: `frontend/src/core/i18n/locales/ja.ts`
- Modify: `frontend/src/core/i18n/locales/ko.ts`
- Modify: `frontend/src/__tests__/`（多个文件）

- [ ] **Step 1: 清理 browser-adapter.ts**

在 `frontend/src/core/backend/browser-adapter.ts`：
- 删除 `'prop'` 文件类型映射

- [ ] **Step 2: 清理 i18n**

在 5 个语种文件中搜索并删除以下 key（按命名空间分组）：
- `scene.prop*`（如 `scene.propTitle`, `scene.propTransform` 等）
- `common.prop`
- `settings.paths.prop`
- `scene.accessory.*`
- `props.*`
- `env.prop*`

使用 grep 精确定位每个 key 再删除：
```bash
cd frontend && grep -rn "prop\|accessory" src/core/i18n/locales/ --include="*.ts" | grep -v "propagat\|process\|proper\|procedural\|procmotion\|proportion"
```

- [ ] **Step 3: 清理测试文件**

搜索所有测试文件中的 prop 相关 mock 和测试用例：
```bash
cd frontend && grep -rln "propRegistry\|PropInstance\|loadProp\|removeProp\|scene-prop-levels\|accessory\|renderPropThumbnail" src/__tests__/
```

逐个文件删除 prop 相关代码。

- [ ] **Step 4: 运行类型检查**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

预期：0 错误（所有 prop 引用已清理完毕）。

- [ ] **Step 5: 运行全量测试**

```bash
cd frontend && npm run test -- --run
```

预期：删除 prop 测试后，其余测试全绿。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/core/backend/ frontend/src/core/i18n/ frontend/src/__tests__/
git commit -m "refactor(adr-215): remove prop from browser-adapter, i18n, tests"
```

---

### Task 2.6: 清理 scene-serialize.ts + 删除文档知识卡

**Files:**
- Modify: `frontend/src/scene/scene-serialize.ts`
- Delete: `docs/knowledge/props.md`
- Delete: `docs/knowledge/props-index.md`
- Delete: `docs/knowledge/accessory.md`
- Modify: `docs/knowledge/README.md`

- [ ] **Step 1: 清理 scene-serialize.ts**

在 `frontend/src/scene/scene-serialize.ts`：
- 删除 props 序列化分支（约 L538-564）
- 清理 `propUuidMap` 相关逻辑
- 反序列化中搜索 `prop` 相关代码并删除

- [ ] **Step 2: 删除知识卡**

```bash
rm docs/knowledge/props.md
rm docs/knowledge/props-index.md
rm docs/knowledge/accessory.md
```

- [ ] **Step 3: 更新 README.md 索引**

在 `docs/knowledge/README.md` 删除相关行引用。

- [ ] **Step 4: 运行文档校验**

```bash
npm run check:docs
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/scene/scene-serialize.ts docs/knowledge/
git commit -m "refactor(adr-215): remove prop serialization, delete knowledge cards"
```

---

## Phase 3: 模型附属功能实现

> 本 Phase 引入新功能。先建立 ModelInstance 附属字段，再实现 modelManager 的 attach/detach API，最后补 UI。

### Task 3.1: ModelInstance 增加附属字段

**Files:**
- Modify: `frontend/src/core/types.ts`

- [ ] **Step 1: 在 ModelInstance 类型中追加附属字段**

在 `frontend/src/core/types.ts` 的 `ModelInstance` 类型末尾（`orbitDistance` 字段之后）追加：

```typescript
/** [doc:adr-215] 如果此模型是其他模型的附属，记录父模型 ID（ADR-193 稳定标识） */
parentId?: string;
/** [doc:adr-215] 附属到的骨骼名（空表示场景级跟随，不 attachToBone） */
attachedBone?: string;
/** [doc:adr-215] 骨骼局部偏移 (x, y, z) */
attachedOffset?: [number, number, number];
/** [doc:adr-215] 骨骼局部旋转（欧拉角度）[pitch, yaw, roll] */
attachedRotation?: [number, number, number];
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/core/types.ts
git commit -m "feat(adr-215): add attachment fields to ModelInstance (parentId/attachedBone/attachedOffset/attachedRotation)"
```

---

### Task 3.2: 实现 attachModelToBone / detachModelFromBone

**Files:**
- Modify: `frontend/src/scene/manager/model-manager.ts`

- [ ] **Step 1: 实现 attachModelToBone**

在 `model-manager.ts` 末尾追加：

```typescript
// ======== [doc:adr-215] 模型附属关系管理 ========

/**
 * 将子模型（角色配件）附属到父模型的指定骨骼上。
 * 含 DAG 校验、单父限制、骨骼名 guard。
 * @returns 是否成功
 */
export function attachModelToBone(
    childId: string,
    parentId: string,
    boneName: string,
    offset: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0]
): boolean {
    const childInst = modelRegistry.get(childId);
    if (!childInst) {
        logWarn('model-manager', 'attachModelToBone: child not found:', childId);
        return false;
    }
    const parentInst = modelRegistry.get(parentId);
    if (!parentInst?.mmdModel) {
        logWarn('model-manager', 'attachModelToBone: parent not found or no mmd runtime:', parentId);
        return false;
    }

    // DAG 校验：防止成环
    if (childId === parentId || isReachable(childId, parentId)) {
        logWarn('model-manager', 'attachModelToBone: would create cycle');
        feedbackStatus('scene.accessory.cycleDetected', undefined, false);
        return false;
    }

    // 骨骼名 guard
    const rb = parentInst.mmdModel.runtimeBones.find((b) => b.name === boneName);
    if (!rb) {
        logWarn('model-manager', 'attachModelToBone: bone not found:', boneName);
        feedbackStatus('scene.accessory.boneNotFound', undefined, false, { bone: boneName });
        return false;
    }

    const linkedBone = (rb as unknown as { linkedBone?: import('@babylonjs/core/Bones/bone').Bone }).linkedBone;
    if (!linkedBone) {
        logWarn('model-manager', 'attachModelToBone: bone has no linkedBone:', boneName);
        return false;
    }

    // 记录附属关系
    childInst.parentId = parentId;
    childInst.attachedBone = boneName;
    childInst.attachedOffset = offset;
    childInst.attachedRotation = rotation;

    const target = childInst.container ?? childInst.rootMesh;
    target.position.set(offset[0], offset[1], offset[2]);
    const rotQ = Quaternion.FromEulerAngles(
        (rotation[0] * Math.PI) / 180,
        (rotation[1] * Math.PI) / 180,
        (rotation[2] * Math.PI) / 180
    );
    target.rotationQuaternion = rotQ;
    target.attachToBone(linkedBone, parentInst.rootMesh);

    showInfoToast(t('scene.accessory.attached', { name: childInst.name, bone: boneName }));
    triggerAutoSave();
    return true;
}

/** 从子模型 ID 向上追溯：检查 parentId 是否可达 ancestorId（DAG 校验用） */
function isReachable(fromId: string, ancestorId: string): boolean {
    const visited = new Set<string>();
    let currentId: string | undefined = fromId;
    while (currentId) {
        if (visited.has(currentId)) return false; // 已有环，不应到这里
        visited.add(currentId);
        const inst = modelRegistry.get(currentId);
        if (inst?.parentId === ancestorId) return true;
        currentId = inst?.parentId;
    }
    return false;
}

/**
 * 解除子模型的骨骼附属，回到场景坐标模式。
 * 保留在 modelRegistry 中，可独立操作或重新挂载。
 */
export function detachModelFromBone(childId: string): void {
    const childInst = modelRegistry.get(childId);
    if (!childInst) return;

    const target = childInst.container ?? childInst.rootMesh;
    const worldMat = target.getWorldMatrix().clone();
    target.detachFromBone();

    childInst.parentId = undefined;
    childInst.attachedBone = undefined;
    childInst.attachedOffset = undefined;
    childInst.attachedRotation = undefined;

    target.position = worldMat.getTranslation();
    target.rotationQuaternion = Quaternion.FromRotationMatrix(worldMat.getRotationMatrix());

    showInfoToast(t('scene.accessory.detached', { name: childInst.name }));
    triggerAutoSave();
}

/**
 * 重新挂载所有附属模型（场景恢复时调用）。
 * 遍历 modelRegistry 中所有 parentId !== undefined 的实例。
 */
export function reattachAllAttachments(): void {
    for (const [childId, inst] of modelRegistry) {
        if (inst.parentId && inst.attachedBone) {
            const target = inst.container ?? inst.rootMesh;
            try { target.detachFromBone(); } catch { /* cleanup */ }
            attachModelToBone(
                childId,
                inst.parentId,
                inst.attachedBone,
                inst.attachedOffset ?? [0, 0, 0],
                inst.attachedRotation ?? [0, 0, 0]
            );
        }
    }
}

/**
 * 卸载父模型时，级联卸载其附属子模型。
 * 遍历 modelRegistry 中所有 parentId === parentId 的实例并移除。
 */
export function detachChildModels(parentId: string): void {
    for (const [childId, inst] of modelRegistry) {
        if (inst.parentId === parentId) {
            removeModel(childId);
        }
    }
}
```

- [ ] **Step 2: 补充 import**

在 `model-manager.ts` 顶部补充缺失的 import：
```typescript
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { showInfoToast } from '@/core/toast';
import { triggerAutoSave } from '@/core/config';
import { t } from '@/core/i18n/t';
import { logWarn } from '@/core/logger';
import { feedbackStatus } from '@/core/feedback';
```

需确认 `modelRegistry` 和 `removeModel` 在当前文件内已有。

- [ ] **Step 3: 更新 scene.ts 中的调用**

将 `scene.ts` 中之前的 `reattachAllAccessories` / `detachModelAccessories` 调用替换为：
- `reattachAllAttachments`（从 `model-manager` 导入）
- `detachChildModels`（从 `model-manager` 导入）

- [ ] **Step 4: 提交**

```bash
git add frontend/src/scene/manager/model-manager.ts frontend/src/scene/scene.ts
git commit -m "feat(adr-215): add attachModelToBone/detachModelFromBone/reattachAllAttachments"
```

---

### Task 3.3: 序列化/反序列化加入 parentId 字段 + deferred reattach

**Files:**
- Modify: `frontend/src/scene/scene-serialize.ts`

- [ ] **Step 1: 序列化端：ModelInstance 加入 parentId 等字段**

在 `scene-serialize.ts` 的模型序列化逻辑中，为每个模型追加：
```typescript
parentId: inst.parentId,
attachedBone: inst.attachedBone,
attachedOffset: inst.attachedOffset,
attachedRotation: inst.attachedRotation,
```

- [ ] **Step 2: 反序列化端：deferred reattach**

反序列化流程：
1. 先按场景文件把所有模型（含父与子）全部加载进 `modelRegistry`
2. 再统一遍历 `modelRegistry`，对每个 `parentId !== undefined` 的实例调用 `attachModelToBone`
3. 若父模型尚未就绪，放入「待重连队列」，父模型加载完成后消费队列补建

- [ ] **Step 3: 提交**

```bash
git add frontend/src/scene/scene-serialize.ts
git commit -m "feat(adr-215): serialize parentId/attachedBone, deferred reattach on deserialize"
```

---

### Task 3.4: UI — actor 详情页增加「附属关系」卡片

**Files:**
- Modify: `frontend/src/menus/resource-detail-helpers.ts`

- [ ] **Step 1: 新增 buildAttachmentCard 函数**

在 `resource-detail-helpers.ts` 中新增 `buildAttachmentCard`，替代原 `buildBoneAttachCard`：

```typescript
/**
 * [doc:adr-215] 模型附属关系卡片。
 * 将当前模型附属到其他模型（父模型选择 + 骨骼选择 + 偏移/旋转）。
 * 取代原 buildBoneAttachCard（prop 专用）。
 */
export function buildAttachmentCard(modelId: string): PopupRow[] {
    // 获取 modelRegistry 中所有其他模型作为可选父模型
    // 获取父模型的 runtimeBones 作为可选骨骼
    // 已附属时显示当前附属信息 + 解除按钮
    // 未附属时显示「附属到模型」配置入口
}
```

- [ ] **Step 2: 在 actor 详情页中集成**

在 actor 详情页的卡片列表中加入 `buildAttachmentCard`。

- [ ] **Step 3: i18n 补充**

在 5 个语种文件中补充附属关系相关的 key（如 `model-detail.attachment` 等）。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/menus/resource-detail-helpers.ts frontend/src/core/i18n/
git commit -m "feat(adr-215): add buildAttachmentCard for actor detail page"
```

---

### Task 3.5: 卸载父模型时级联卸载子模型

**Files:**
- Modify: `frontend/src/scene/manager/model-manager.ts`（或 `scene.ts`）

- [ ] **Step 1: 在 removeModel 中增加级联逻辑**

在 `removeModel` 函数末尾，调用 `detachChildModels(id)` 级联卸载所有附属子模型。

- [ ] **Step 2: 提交**

```bash
git add frontend/src/scene/manager/model-manager.ts
git commit -m "feat(adr-215): cascade unload child models when parent is removed"
```

---

## Phase 4: 文档与测试

### Task 4.1: 更新 ADR 文档状态

- [ ] **Step 1: 修改 ADR-215 状态**

在 `docs/adr/adr-215-eliminate-prop-kind.md` 第 3 行：
```diff
-- **状态**: 📋 规划
+- **状态**: 🔄 实施中
```

- [ ] **Step 2: 运行 gen:status 刷新索引**

```bash
npm run gen:status -- --reverse
```

- [ ] **Step 3: 提交**

```bash
git add docs/adr/adr-215-eliminate-prop-kind.md docs/status.md
git commit -m "docs(adr-215): update status to in-progress"
```

---

### Task 4.2: 全量测试 + 检查

- [ ] **Step 1: 运行全量检查**

```bash
cd frontend && npm run check
npm run check:docs
npm run check:funcmap
```

- [ ] **Step 2: 运行全量测试**

```bash
cd frontend && npm run test -- --run
```

- [ ] **Step 3: 运行契约测试**

```bash
cd frontend && npm run test -- src/__tests__/bindings/app.contract.test.ts
```

- [ ] **Step 4: 修复所有失败**

逐一修复编译错误和测试失败，每修复一批提交一次。

---

## 验收清单

- [ ] `npm run check` 0 错误
- [ ] `npm run test -- --run` 全绿
- [ ] `app.contract.test.ts` 通过
- [ ] `npm run check:docs` 通过
- [ ] `npm run check:funcmap` 通过
- [ ] 手动验证：模型库中所有 PMX 文件仍可见、可加载
- [ ] 手动验证：角色配件可加载为 actor，可通过附属关系 UI 挂到主模型骨骼
- [ ] 手动验证：卸载父模型时子模型级联卸载
- [ ] 手动验证：场景保存/恢复不丢失附属关系
- [ ] 手动验证：阴影投射正常（遍历 modelRegistry + stage）
- [ ] 手动验证：材质调节可用

## 不变量

迁移前后保证：
1. ✅ 模型库中所有 PMX 文件仍然可见、可加载
2. ✅ 场景文件的加载/保存/恢复不丢失附属关系
3. ✅ 模型的阴影投射不受影响
4. ✅ 材质调节能力不丢失
5. ✅ 骨骼锚定后的视觉位置和跟随行为与当前 `attachToBone` 一致

## 风险

| 风险 | 缓解 |
|------|------|
| 大范围删除导致编译错误链式爆发 | 按 Task 逐一提交，每次提交前 `tsc --noEmit` 验证当前 Task 无新增错误 |
| 附属关系序列化/反序列化顺序依赖 | 采用 deferred reattach：先全加载再重建附属链，父缺失入待重连队列 |
| 场景装饰的归属迁移边界模糊 | 场景装饰文件（glTF/glb/PMX）在 `stage/` 目录下管理，加载后作为 scene stage 的附属 TransformNode |
| 用户现有的 prop 场景文件兼容性 | 旧场景文件反序列化时检测到 props 字段 → 跳过并提示用户场景文件需手动迁移 |