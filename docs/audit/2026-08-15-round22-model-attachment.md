# [ADR-215 模型附属关系守护] — 审核结果（round22 · 测试反推）

## 审核范围

- **测试文件**：`frontend/src/__tests__/model-attachment.test.ts`（261 行，18 用例，`[doc:adr-215]` 守护测试）
- **被测源码**：`frontend/src/scene/manager/model-manager.ts:1172-1354`（[doc:adr-215] 附属关系区：`attachModelToBone` / `detachModelFromBone` / `reattachAllAttachments` / `detachChildModels` / `_hasAncestor`），级联路径 `remove()` 于 309-311
- **契约来源**：`docs/adr/adr-215-eliminate-prop-kind.md` §2.4（DAG/单父/骨骼名 guard）、§3.3（deferred reattach）、§7 不变量（附属不丢失、视觉位置一致、级联销毁）

## 总体结论

**⚠️ 有条件通过** — 18 个用例全绿（77ms），guard 矩阵覆盖广、断言大体有效、无跳过用例；但存在 1 处 **P2**（DAG `childIsDescendant` 分支误拒合法「重挂到祖先」操作且报错文案与事实不符，且为全部 DAG 用例中唯一未被覆盖的分支）与 3 处 **P3**（恢复期副作用风暴、字段写入与 mesh 操作非原子、测试对位置/资源释放不变量的断言空转）。建议修复 P2 后合入，P3 排期处理。

## 亮点

- **guard 顺序与失败路径完备**：child 存在 → parent+mmdModel → DAG 成环 → 骨骼名解析 → linkedBone → 换父先 detach → 写入字段 → mesh 操作 → toast/autoSave，每步失败都 logWarn + 返回 false 不落字段。`model-manager.ts:1200-1279`
- **`_hasAncestor` 防死循环**：visited 集合守卫，对已损坏的环状数据防御性返回 false，不会无限循环。`model-manager.ts:1179-1193`
- **级联销毁快照化**：`detachChildModels` 先 filter 快照再逐个 `remove()`，避免迭代中突变；`remove()` 内先级联删子（309）后清理父，资源释放链完整（mesh.dispose + 材质/共享 toon 纹理去重 dispose + boneOverlay + vmd-layers 状态，314-364，含 round17/GPU 泄漏修复注释）。
- **reattach 错误不静默**：`detachFromBone` 包 try/catch 且 logWarn（1320-1330）；半附属态（parentId 已置、attachedBone 缺失）正确跳过（1318）。
- **单父三态测试与 fork 语义吻合**：换父覆盖、跨父先 detach、同父换骨不 detach（test 189-224）；已核实 babylon-mmd fork `attachToBone`（`transformNode.pure.js:748-757`）为直接覆盖 `this.parent` 的 parent-swap 语义（非经典 BoneLookController），同网格重复 attach 无 controller 泄漏，测试期望与真实行为一致。

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🔴 P1 | — | — | 无 | — |
| 🟠 P2 | frontend/src/scene/manager/model-manager.ts | 1227-1235 | `childIsDescendant` 在「重挂到祖先」场景误判成环：链 c→b→a（c 挂 b、b 挂 a）后再挂 c→a 被拒——`_hasAncestor(b,a)=true` 触发。但 parentId 为单父覆盖写（1261），旧边 c→b 消失，结果图 c→a、b→a 无环（已用 node 复刻 `_hasAncestor`+校验逻辑实测：返回 false、若允许则无环）。报错文案 "would create cycle"（1232）与事实不符。三个 DAG 用例（test 163-187）全部只命中 check1/check2，此分支**零覆盖** | ① 推荐：删除 `childIsDescendant` 分支——`_hasAncestor(parentId, childId)`（check2）已足以防止全部成环（成环 ⟺ 新边 child→parent 后 parent 祖先链含 child）；② 若有意禁止挂祖先：改报错文案（复用 `scene.accessory.attachFailed`），并补「c→b→a 后挂 c→a」用例固化预期 |
| 🟡 P3 | frontend/src/scene/manager/model-manager.ts | 1316-1340（含 1276-1277） | `reattachAllAttachments` 对每个附属模型走完整 `attachModelToBone` → N 次 `showInfoToast` + N 次 `triggerAutoSave`。场景恢复（`scene-serialize.ts:945`）时产生 toast 风暴与恢复中途的自动保存调度，无意义副作用 | reattach 路径增加静默标志（内部直调不 toast），autoSave 合并为恢复完成后一次 |
| 🟡 P3 | frontend/src/scene/manager/model-manager.ts | 1261-1274 / 1296-1303 | 字段写入与 mesh 操作非原子：attach 先写 parentId/attachedBone/offset/rotation（1261-1264）再 `attachToBone`（1274），无 try/catch；若 attachToBone 抛错（如 linkedBone 属已销毁模型，fork 实现 `bone.getSkeleton().prepare(true)` / `getFinalMatrix()` 可能空指针，见 transformNode.pure.js:752-754）→ 字段已落而 mesh 未挂，与 reattach 跳过条件（1318）语义冲突的半态。detach 反向：先 detachFromBone（1298）后清字段（1300-1303），抛错则字段残留 | mesh 操作先行并 try/catch，成功后再落字段；或失败时回滚字段 |
| 🟡 P3 | frontend/src/__tests__/model-attachment.test.ts | 120-128 / 226-235 / 237-248 | 断言强度不足三处：① 旋转只断言 `rotationQuaternion` toBeDefined，mock `FromEulerAngles` 恒返回 (0,0,0,1)，度→弧度转换/欧拉顺序回归不会被捕获；② detach「回到场景坐标」在 mock getWorldMatrix 恒零位姿下为空转，position/rotationQuaternion 从世界矩阵回读未真实验证；③ 级联卸载只断言 registry 移除（get undefined），子模型 dispose/材质释放链未被验证（stub `meshes=[]` 使 remove 的释放路径空转）——§7「级联销毁」资源释放不变量实为真空转 | 给 MockQuaternion.FromEulerAngles 实现真实角度→四元数（或参数化注入期望值），断言具体数值；级联用例为子模型塞 1 个 MockMesh 并断言 dispose 被调用 |
| 🟢 P4 | frontend/src/scene/manager/model-manager.ts | 1245-1247 | `rb as unknown as { linkedBone?: import('@babylonjs/core/Bones/bone').Bone }` 内联结构 cast 绕过类型（RuntimeModel 骨骼元素来自 babylon-mmd IMmdModel，无 linkedBone 声明）。非 `as any` 但属类型逃生口 | 在 core/types.ts 侧 augment 骨骼元素类型补 `linkedBone?: Bone`，消除双重 cast |
| 🟢 P4 | frontend/src/__tests__/model-attachment.test.ts | 11-14 | `vi.mock('@/scene/manager/outfit-overlay')` 实际无效：model-manager 不静态 import outfit-overlay（经 scene-action-bridge 运行期注册），测试中 bridge 注册表为空，stderr 出现 "disposeOverlay/restoreMaterials 未注册" 告警。注释「重依赖 mock」具误导性 | 删除该 mock，或在 setup 中 registerSceneAction no-op 消除告警，测试头注释改述 bridge 契约 |
| 🟢 P4 | frontend/src/scene/manager/model-manager.ts | 1346-1353 | `detachChildModels` 命名与行为相反：实际是级联**销毁**（调 `remove()`），与 `detachModelFromBone`（解除附属、保留实例）语义易混 | 注释明示「销毁语义（ADR §2.3）」，或后续重命名 `cascadeRemoveChildren` |

## 测试质量评价

- **优点**：18 用例无 `.skip`/`.todo`；守卫矩阵完整（未知 child / 未知 parent / 无 mmdModel / 未知骨骼 / 无 linkedBone / 半附属态跳过）；DAG 三形态全覆盖（自环、直接环、多层环）；单父三态（换父覆盖、跨父先 detach、同父换骨不 detach）；detach no-op 断言 toast+autoSave 双副作用均不触发；级联用快照断言移除。stub 最小化（rootMesh 只提供 attach/detach 所需方法），隔离策略「全 mock 重依赖 + 本地 Babylon 数学 mock」有效——env-wetness / material / toast / feedback / i18n 均为 model-manager 真实 import 路径且 no-op 化，拦截真实。
- **缺口**：① `childIsDescendant` 分支零覆盖（P2 的温床，见上）；② reattach 失败路径（父模型缺失/骨骼消失 → attach 返回 false、字段保留待重连，ADR §3.3 deferred reattach 不变量）无用例；③ 位置/资源释放断言空转（P3-3）；④ 并发维度：四 API 全部同步、无 async 交错窗口，快速 attach/detach 无法在单操作中途交叉，测试不覆盖属合理，但可补一个「连续换父 3 次后字段与 mesh 状态一致」的冒烟用例防未来异步化回归。
- **mock 合理性**：唯一无效 mock 为 outfit-overlay（P4-2）；`as unknown as ModelInstance` 等测试侧 cast（23/67/76/115 等）可接受，建议注释说明。

## 验证记录

- `cd frontend && npm run test -- src/__tests__/model-attachment.test.ts`：**18 passed (77ms)**，基线绿（含 5 条预期 logWarn stderr + 2 条 bridge「未注册」告警）。
- `npm run check`（tsc）：**未运行**——本审核为只读审核、未修改任何生产/测试代码，按任务允许跳过；如需可后续补跑。
- DAG 误判已用 node 复刻 `_hasAncestor` + attach 校验逻辑实测：c→b→a 后挂 c→a 返回 false；强行走覆盖写则图无环。

---

审核日期：2026-08-15
审核员：子代理 round22-model-attachment
