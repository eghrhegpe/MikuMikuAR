# ADR-110: IMmdModel 接口类型补全 — 上游 PR 计划

**状态**: 草案 · 待立项

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-07-14

**来源**: `docs/research/babylon-mmd-api-analysis.md` §3.1 接口缺口 / §五 P0

**关联**: ADR-064（IMmdModel 类型缺口即时止血，本地 module augmentation）、ADR-098（vmd-layers cast 消解，批次一）

**影响面**: `frontend/src/core/types.ts`（本地 augmentation 待移除）、babylon-mmd 上游仓库（`noname0310/babylon-mmd`）

---

## 问题

`IMmdModel` 接口（`babylon-mmd/esm/Runtime/IMmdModel`）缺少三个运行时方法/属性，导致项目在 4 个位置使用 `as any` / `as unknown as` 绕过类型检查。

### 类型缺口清单

| # | 位置 | 问题代码 | 根因 |
|---|------|----------|------|
| 1 | `core/types.ts:70-73` | `RuntimeModel = IMmdModel & { setRuntimeAnimation(...); createRuntimeAnimation(...); }` | `IMmdModel` 接口缺少 `setRuntimeAnimation` 和 `createRuntimeAnimation` 方法 |
| 2 | ~~`vmd-layers.ts:577`~~ | ~~`composite as unknown as IMmdBindableModelAnimation`~~ | ✅ ADR-098 已消解（激活 `MmdCompositeRuntimeModelAnimation` module augmentation 后直接传入） |
| 3 | `vmd-loader.ts:74` | `(vmdLoader as unknown as { dispose?: () => void }).dispose?.()` | `VmdLoader` 类型未暴露 `dispose()` 方法 |
| 4 | `vmd-loader.ts:109` | `(inst.mmdModel as { currentAnimation?: ... }).currentAnimation` | `IMmdModel` 不含 `currentAnimation` 属性 |

### 当前止血方案

`core/types.ts` 通过 TypeScript module augmentation 本地声明合并：

```typescript
// core/types.ts:70-73
export type RuntimeModel = IMmdModel & {
    setRuntimeAnimation(animation: unknown): void;
    createRuntimeAnimation(animation: unknown): unknown;
};
```

`vmd-loader.ts` 中两处 cast 仍存在，未纳入 augmentation。

---

## 决策

**向 `noname0310/babylon-mmd` 提交 PR，补全 `IMmdModel` 接口和 `VmdLoader` 类型声明，验收合并后移除本地 augmentation。**

### 选项

| 选项 | 结论 | 理由 |
|------|------|------|
| **A. 提上游 PR** | **✅ 采用** | 根治问题，消除所有 4 处 cast，项目不再依赖本地 augmentation |
| B. 仅本地 augmentation 全覆盖 | ❌ 否决 | 临时止血已完成，长期应推动上游修复 |
| C. 不动（维持现状） | ❌ 否决 | 4 处 cast 在 babylon-mmd 升级时是静默断裂风险点 |

---

## 约束

### PR 内容范围

| 修改目标 | 需要添加的声明 | 当前状态 |
|----------|---------------|---------|
| `IMmdModel` 接口 | `setRuntimeAnimation(animation: IMmdBindableModelAnimation): void` | 缺失 |
| `IMmdModel` 接口 | `createRuntimeAnimation(animation: IMmdBindableModelAnimation): IMmdRuntimeModelAnimation` | 缺失 |
| `IMmdModel` 接口 | `currentAnimation?: IMmdBindableModelAnimation` | 缺失 |
| `VmdLoader` 类 | `dispose(): void` | 缺失 |

### 不包含的范围

- `IMmdRuntimeBone.worldMatrix` 类型——已在 `IMmdRuntimeBone` 中正确定义为 `Float32Array`，`proc-motion-bridge.ts` 中的 `as any` 是冗余 cast，属项目内部清理，不涉及上游。
- `MmdCompositeAnimation` 的 `IMmdBindableModelAnimation` 兼容——已在 `mmdCompositeRuntimeModelAnimation.d.ts` 中通过 module augmentation 声明，无需重复提交。

### 验证方法

1. 提交 PR 后，在项目 `package.json` 中临时指向 PR 分支（`"babylon-mmd": "noname0310/babylon-mmd#pr-xxx"`）
2. 删除 `core/types.ts` 中 `RuntimeModel` 的 intersection type，改为 `type RuntimeModel = IMmdModel`
3. 删除 `vmd-loader.ts` 中两处 `as unknown as` cast
4. 运行 `npm run check`（`tsc --noEmit`）确认零类型错误
5. 运行 `npm run build` 确认构建通过
6. 运行 `npm run test` 确认单元测试无回归

---

## 实现计划

### 步骤一：fork 并本地验证（预估 1 天）

```bash
# fork noname0310/babylon-mmd 到个人仓库
# clone 到本地
git clone https://github.com/<user>/babylon-mmd.git
cd babylon-mmd

# 在 src/Runtime/IMmdModel.ts 中添加：
#   setRuntimeAnimation(animation: IMmdBindableModelAnimation): void;
#   createRuntimeAnimation(animation: IMmdBindableModelAnimation): IMmdRuntimeModelAnimation;
#   currentAnimation?: IMmdBindableModelAnimation;

# 在 src/Loader/vmdLoader.ts 中添加：
#   dispose(): void;

# 本地构建
npm run build
```

### 步骤二：项目内临时指向验证（预估 0.5 天）

```json
// package.json 临时指向
"babylon-mmd": "file:../babylon-mmd/packages/core"
```

### 步骤三：提交 PR（预估 0.5 天）

- 提交到 `noname0310/babylon-mmd` 主仓库
- PR 描述中说明：
  - 缺失的 4 个声明项
  - 项目侧因此产生的 4 处 cast（附代码位置）
  - 项目侧 module augmentation 的代码（证明最小修复集）
  - 类型兼容性验证结果（`tsc --noEmit` 通过）

### 步骤四：上游合并后清理（预估 0.5 天）

- 更新 `package.json` 版本号（或指向合并后的 commit）
- 删除 `core/types.ts` 中 `RuntimeModel` 的 intersection type 定义
- 清理 `vmd-loader.ts` 中两处 `as unknown as` cast
- 删除 `vmd-loader.ts` 中的 `(vmdLoader as unknown as { dispose?: () => void }).dispose?.()` → 改为 `vmdLoader.dispose()`
- 删除 `(inst.mmdModel as { currentAnimation?: ... }).currentAnimation` → 改为 `inst.mmdModel.currentAnimation`

---

## 后果

### 正面

- ✅ 消除 4 处 `as any` / `as unknown as`，类型安全与可维护性提升
- ✅ 移除本地 module augmentation，减少 `core/types.ts` 样板代码
- ✅ 上游社区受益，其他 babylon-mmd 使用者不再遇到相同问题
- ✅ babylon-mmd 升级时不再需要核查 augmentation 是否冲突

### 负面

- ⚠️ 上游 PR 的合并时间不可控，可能需等待数个版本周期
- ⚠️ 若上游拒绝（如作者认为 `setRuntimeAnimation` 是内部方法），需回退到本地 augmentation 全覆盖方案
- ⚠️ PR 提交后 `core/types.ts` 的 augmentation 需保留直到上游版本发布，期间升级 babylon-mmd 需检查 augmentation 是否与新版冲突

### 回退方案

若上游 PR 长时间未合并（> 2 个版本周期），回退到本地 augmentation 全覆盖：

- 在 `core/types.ts` 中补全 `VmdLoader` 的 `dispose()` 声明
- 不在 `vmd-loader.ts` 中保留 `as unknown as` cast
- 添加注释说明上游未合并，待日后清理

---

## 与 ADR-064 / ADR-098 的关系

| ADR | 处理的内容 | 与本 ADR 的关系 |
|-----|-----------|----------------|
| ADR-064 | 本地 module augmentation 止血 `RuntimeModel` | 本 ADR 的上游 PR 合并后可移除 augmentation |
| ADR-098 | 消解 `vmd-layers.ts` 的 composite cast | 已消解 1 处，剩余 3 处由本 ADR 处理 |
| 本 ADR | 上游 PR 根治剩余 3 处 + 移除本地 augmentation | 是 ADR-064 的长期方案 + ADR-098 的延续 |