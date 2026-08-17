# ADR-275: 脚部地面跟随即刻废弃的收尾 — 落地事件源以「是否真在解算」为准

> **状态**: ✅ 已采纳（2026-10-24）
> **日期**: 2026-10-24
>
> **取代**：ADR-085（脚部地面跟随）的运行时决策——脚部跟随不再按模型默认启用，落地检测转由 ADR-088 Phase B 的降级检测承担。ADR-085 的算法推导与 WASM/IK 迁移史仍作为参考保留。

## 背景

### 一行提交留下的坑

`88d75986`「废弃脚部地面跟随」（2026-08-12）只做了三件事，共 3 files / +9 / -9：

```
frontend/src/scene/scene.ts                       |  2 +-
frontend/src/__tests__/scene.test.ts              |  2 +-
frontend/src/__tests__/scene/replace-model-inherit.test.ts | 14 +++++++-------
```

scene.ts 的那一行，是脚部跟随每帧从 `modelRegistry` 收集模型时的状态构造：

```ts
feet: { ...createDefaultFeetState(), enabled: false }
```

提交信息只有标题「废弃脚部地面跟随」四个字——没有 ADR、没有 buglog、没有改动注释。
而同一段代码上方还留着旧注释「always-on 配置：enabled=true, intensity=1」。

### 停产但没断电：事件源断链

脚部跟随与脚步声是两个系统，靠一个回调接在一起：

| 环节 | 位置 | 行为 |
|---|---|---|
| 生产者 | `frontend/src/scene/motion/feet-adjustment.ts:282-283` | 只有模型通过 `enabled && intensity>0` 门（同文件 `405`）才会 `_onFootLand(...)` |
| 消费者 | `frontend/src/scene/motion/footstep.ts:168-169`（改前） | `if (!isFeetAdjustmentRunning()) startFallbackDetection(scene, cb)` |
| 探针 | `frontend/src/scene/motion/feet-adjustment.ts:129-131`（改前） | `isFeetAdjustmentRunning()` 只回答 `_unregisterHandle !== null`——**observer 注册过没有** |

`boot-motion.ts` 的 `bootFeetAdjustment()` 无条件调用 `startFeetAdjustment(...)`，所以 `_unregisterHandle` 恒非空 → `isFeetAdjustmentRunning()` 恒为 `true`。

于是链条是：

1. 每个模型 `enabled: false` → 生产者一个事件都不发；
2. 探针却回答"在跑" → 消费者认为事件源存在 → **不启动降级检测**；
3. 结果：两个事件源同时为零。

用户侧表现：设置里打开「启用脚步声」（`frontend/src/menus/settings-media.ts:218-232`，绑定 `ui.footstepEnabled`，默认 `v === true` 即关闭），没有任何声音——而 ADR-088 Phase B 的降级检测本来就是为了这种情况写的。

### 为什么半年没被发现

- 脚步声开关**默认关闭**（`get: (v) => v === true`），要主动打开才暴露；
- 三个门禁全部安静：`tsc` 无类型错、`vitest` 有 26 个用例且全部通过（它们 mock 了 `isFeetAdjustmentRunning`，把"在跑"当成默认前提，`frontend/src/__tests__/footstep.test.ts:101`）、`check:coupling` 与依赖无关；
- 测试锁的是**接线形状**，不是**事件真的会来**：`footstep.test.ts:180-193`（改前）断言"running=true 就不启动降级检测"——正好把这个 bug 写成了规格。

## 决策

### 1. 生产者暴露"真的在解算"的观测位

`frontend/src/scene/motion/feet-adjustment.ts` 新增：

```ts
let _anyEnabled = false;          // 上一帧是否有模型真正启用
export function isFeetAdjustmentEnabled(): boolean { return _anyEnabled; }
```

- 每次 tick 开头 `_anyEnabled = false`，有模型跨过 `enabled && intensity>0 && runtimeBones.length>0` 门时置 `true`；
- `stopFeetAdjustment()` 一并复位；
- 未跑过帧时为 `false`——**不乐观假定**，因为启动瞬间本来就没有事件能力。

### 2. 消费者改问正确的问题

`frontend/src/scene/motion/footstep.ts`：

```ts
if (!isFeetAdjustmentEnabled()) {
    startFallbackDetection(scene, (e) => {
        if (isFeetAdjustmentEnabled()) return;   // 脚部跟随一旦接管就让位
        callback(e);
    });
}
```

- 判据从"observer 注册过"换成"上一帧真的解算了"，这正是"事件会不会来"的充分条件；
- 包一层互斥闸：若将来脚部跟随被重新启用（且真有模型 `enabled: true`），降级检测立即让位，不会一步两声。今天这条分支不可达，但它让"重新启用脚部跟随"这个动作退化为改一个开关，而不是再排查一次双声。

### 3. 测试改为锁行为，不锁接线

- `frontend/src/__tests__/footstep.test.ts`：新增回归锚点「observer 已注册但无模型启用 → 仍启动降级检测」，以及「脚部跟随接管后降级回调让位」。原来那条"running=true 就不启动"的用例被替换——它锁的正是 bug。
- `frontend/src/__tests__/feet-adjustment.engine.test.ts`：新增 `isFeetAdjustmentEnabled` 的三态用例（未跑帧 false → 启用后 true → 关掉后 false → stop 后 false）。

## 备选方案

| 方案 | 为什么没选 |
|---|---|
| **A. 删掉脚部跟随的注册**（`boot-motion.ts` 不再 `startFeetAdjustment`） | 一步修好声音，但把 400 行的 `feet-adjustment.ts` 变成只有测试引用的死模块：`check:dead-code` 基线（38 / 17 / 1）会涨；且"废弃"与"删除"是两件事，删除需要单独评估 `bone-override / wasm-ik-resolver` 的连带影响。 |
| **B. 保留注册，只在 `enabled:false` 处加注释说明** | 注释不会失败。这正是 `88d75986` 已经证明过的做法——四个月后没人知道声音是哑的。 |
| **C. 给脚部跟随加一个设置开关，让用户自己开** | 把"是否修 bug"变成"是否配置正确"。而且脚部跟随被废弃是有原因的（见 ADR-085 的状态行与 ADR-202 §六），恢复开关等于复活一个已被判定不该默认开启的子系统。 |
| **D. 每个 tick 把 enabled 状态广播成事件，脚步声订阅** | 为一处布尔判断引入事件总线，属于用架构解决判断问题；且订阅者要处理"第一个事件到达前"的空窗，与方案 1 的"未跑帧即 false"等价却更重。 |

**采纳的方案**：生产者暴露观测位（1 行状态 + 1 行置位 + 1 个查询）+ 消费者改判据（1 个 `if` + 1 层包装）+ 测试改锁定对象。

## 影响

改动文件：

| 文件 | 改动 |
|---|---|
| `frontend/src/scene/motion/feet-adjustment.ts` | `+_anyEnabled` 状态、`+isFeetAdjustmentEnabled()`、tick 内置位/复位、stop 复位 |
| `frontend/src/scene/motion/footstep.ts` | 判据换成 `isFeetAdjustmentEnabled()`，降级回调包互斥闸 |
| `frontend/src/__tests__/footstep.test.ts` | mock 增 `isFeetAdjustmentEnabled`；替换 2 条旧用例，新增 4 条（含回归锚点） |
| `frontend/src/__tests__/feet-adjustment.engine.test.ts` | 新增 `isFeetAdjustmentEnabled` 三态用例 |
| `docs/adr/adr-085-feet-adjustment.md` | 状态行标注「被 ADR-275 取代」 |
| `docs/buglog/脚步声开关打开后静默无声.md` | 新增 buglog（根因 + 时间线） |

不改的：`startFeetAdjustment` 的注册位置与 `boot-steps.ts` 的 24 步顺序（脚部跟随仍先于 footstep 启动，`footstep` 的 `requires: ['feet-adjustment']` 继续成立）。

行为变化只有一处：**打开「启用脚步声」后第一次落地就能听见声音**（此前恒静音）。

## 教训

1. **"已注册"不是"在工作"** —— 任何 `isXRunning()` 若答案只来自注册状态，就不能用来判断"事件/产出是否存在"。要么回答"有没有产出"，要么改名成 `isXRegistered()`。
2. **废弃一个子系统，要顺着它的消费边走到头** —— `88d75986` 改的是生产者的开关，没收尾的是消费者的判据；一条 1 行的 `if` 依赖把整条链路留在了"两边都没事件"的状态。
3. **测试锁接线会保护 bug** —— `footstep.test.ts` 那条用例精确断言了错误行为，26 个绿勾反而成了证据。回归用例应当能在"把判据改回 `isFeetAdjustmentRunning()`"时变红（已手工验证：改回即 3 红，文件 SHA-256 恢复后一致）。

## 附注：一次误撤销（2026-10-24）

本 ADR 落地并推送后，同一工作树里并行的 ADR-274（严格模式阶梯）线把 `b657572e` + `f75c4b9c` 判为"越界修改"整体撤销（`9689f8fa`，13 files / -317 行，含本文档与 buglog），提交信息写"脚部地面跟随疑似静音 bug 另立项，待用户确认后再动手"。经用户确认后以反向撤销恢复。

两条教训：

1. **分工要按工作树隔离，不按"授权范围"口头划分** —— 同一棵工作树里两条线各自提交、各自判界，撤别人的东西比改自己的更省事，于是先动手的赢。
2. **撤销一份已推送的修复，成本高于新写一份** —— 撤销连带丢掉决策记录与回归测试；恢复时 `docs/status.md` / `docs/adr/index.md` 已经和 ADR-274 的状态行冲突，只能重新生成。

## 相关文档

> ADR-088 脚步声/SFX 总线、ADR-273 场景启动顺序显式化
