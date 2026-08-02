> **状态**: 🟢 已修复
>
> **日期**: 2026-08-02
> **严重程度**: 🔴 P1
> **影响范围**: `frontend/src/scene/motion/motion-modules/body-posture.ts`、`foot-modules.ts`、`hand-modules.ts`（共 3 个模块；`riding-model.ts` 写法正确不受影响）
> **发现方式**: 用户手动测试（动作详情页 → 动作覆盖 → 身体姿态，弯腰滑块拉满无效果）
> **回归自**: `91dbe42a 更新骨骼`（将模块 `action` 由默认 `bake` 改为 `ensureActive`，引入 early-return）
> **修复方案**: 三个模块的 `ensureActive` 均改为「先 `bake(modelId)` 重烤，再对帧钩子注册做幂等保护」
> **波及范围**: 复制粘贴同源 bug —— body-posture 的弯腰/倾斜/扭转、foot 的脚旋转(pitch/yaw/roll)、hand 的手腕旋转 + 手指姿势，均在首次启用后冻结

# 动作模块 `ensureActive` 早期 return 跳过重烤（跨模块同源 bug）

## 问题描述

以下模块拖动旋转/预设类滑块到任意值，角色无任何反应；冲突 banner 却显示模块已赢得骨骼冲突（"当前生效"）：

- **身体姿态**：弯腰(bend)/倾斜(tilt)/扭转(twist) 失效（身体高度/前后走帧钩子正常）
- **脚模块(左/右)**：脚旋转 pitch/yaw/roll 失效（脚位置偏移走帧钩子正常）
- **手模块(左/右)**：手腕旋转 pitch/yaw/roll + 手指姿势 失效（手臂位置偏移走帧钩子正常）

`身体位置偏移` 类参数正常实时生效——因为它们由每帧帧钩子驱动，而旋转/预设类参数由 `bake` 一次性写入后不再更新。

## 根因分析

调用链：
```
滑块 onChange → base.setParam('bend', v)
  → doAction(modelId)            // body-posture 覆写为 ensureActive
    → ensureActive(modelId)
        if (_bodyFrameHooks.has(modelId)) return;   // ← 首次启用后永远早退
        bake(modelId);            // ← 唯一写旋转覆盖的路径，被跳过
```

- 首次启用：`_bodyFrameHooks` 未注册 → `bake` 用默认值（全 0）写入 上半身 覆盖 = `[0,0,0]`。
- 之后每次 `setParam`：`_bodyFrameHooks.has` 为真 → **直接 return，`bake` 不再执行** → 引擎里的旋转覆盖值永远停在启用时刻（全 0）。

冲突 banner 的"赢"是首次 `bake` 时 `claimBones` 记录的，与覆盖值是否更新无关——因此出现"赢了冲突但角色不动"的假象。

只有 body-posture 把 `action` 覆写为 `ensureActive`（其他模块用默认 `bake`，每次 `setParam` 都重烤），故**仅弯腰/倾斜/扭转失效，其他模块正常**。

## 修复

三个模块统一将 `bake(modelId)` 提到 early-return 之前，仅对帧钩子注册保持幂等（与 `riding-model.ts` 既有的正确写法一致）：

```ts
function ensureActive(modelId: string): void {
    const hadHook = _xxxFrameHooks.has(modelId);
    bake(modelId);            // 始终按当前参数重烤旋转/预设覆盖
    if (hadHook) return;      // 仅帧钩子注册需幂等
    const unregister = registerBoneOverrideFrameHook(/* ... */);
    _xxxFrameHooks.set(modelId, unregister);
}
```

`bake` 内部 `prepareBake` 已对 `!state.enabled` 门控，disabled 时不写覆盖，安全。

**已修复文件**：
- `body-posture.ts`（弯腰/倾斜/扭转）
- `foot-modules.ts`（脚旋转 pitch/yaw/roll）
- `hand-modules.ts`（手腕旋转 + 手指姿势）

**未受影响**：`riding-model.ts` 的 `ensureActive` 在 `91dbe42a` 中正确写成 `bake(modelId)` 在钩子判断之前，是该模式的对照正确实现。

## 长治久安（2026-08-02 已做）

根因是 3 个模块复制粘贴了同一段「先判 hook 存在再 bake」的错误 `ensureActive`。已在 `module-base.ts` 抽公共工厂 `createEnsureActive(bake, hookManager, registerHook)`，把**正确顺序固化**：每次都先 `bake` 重烤，仅对帧钩子注册做幂等。body-posture/foot/hand 改为经工厂创建 `action`（`_registerBodyPositionHook` 等钩子注册闭包外提），从结构上杜绝下次再抄错。

- 新增 `module-base.ts`：`createEnsureActive` + 导出 `FrameHookManager` 类型（复用 `createFrameHookManager` 返回类型，不引入 bone-override 依赖）。
- 知识卡 `motion-module-base.md` 同步 `symbols`（createEnsureActive / FrameHookManager）与不变量。
- riding-model 因 autoPedal 需动态注册/注销钩子，逻辑特殊，保留自定义 `ensureActive`，不套用工厂。

## 验证

- `npm run dev` → 模型 → 动作详情页 → 动作覆盖 → 身体姿态
  - 拖「弯腰」→ 角色上半身应实时前倾；拖回 0 恢复
  - 拖「倾斜」「扭转」同理
  - 「身体高度」「身体前后」本就实时，仍正常
- 回归单测（已补）：`src/__tests__/scene/motion-modules-registry.param.test.ts` 的
  `setParam 触发 re-bake` 用例，断言 enable 后改 bend/pitch/fingerPreset 会重调 `setBoneOverride` 带新值。
  临时把 `createEnsureActive` 改回早退写法，4 条用例全部 FAIL → 证明测试能抓住回归。
- `npx vitest run src/__tests__/scene/bone-override.test.ts src/__tests__/scene/bone-override-store.test.ts src/__tests__/scene/motion-modules-registry.*.test.ts` 全过

## 教训

模块 `action` 覆写为"带帧钩子的 ensureActive"时，**帧钩子注册幂等 ≠ 烘焙幂等**。烘焙（写引擎覆盖）应在每次 `setParam` 执行，只有一次性资源（帧钩子、observer）才需早退保护。此类"启用后参数变更不生效"的 bug 单测难以覆盖 DOM 渲染，但 `bake→getAllOverrides` 的逻辑路径是可单测的。
