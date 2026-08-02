# ADR-233: 程序化动作 per-mode 独立参数 —— 拆分单一状态为待机/自动舞蹈各自参数集

> **状态**: ✅ 已完成（2026-08-02 落地，全量单测绿）
> **日期**: 2026-08-02
>
> **编号**: 233
>
> **关联**: [ADR-207](adr-207-motion-menu-restructure.md)（动作菜单重构 + 统一详情页，本 ADR 是对其「程序化动作共享参数」遗留限制的收敛）、[ADR-121](adr-121-global-motion-intent.md)（双槽位动作分配）、[ADR-162](adr-162-perception-permodel-phase1.md)（感知层 per-model）
>
> **来源**: 程序化动作统一进详情页（ADR-207 后续）后，用户实测发现「待机呼吸」与「自动舞蹈」共用一套强度/速度/骨骼微动/插值参数，切换模式参数跟着跑，无法分别微调；同时暴露 idle 生成器从未读取 `boneToggles`（骨骼微动开关对 idle 是摆设）的既有缺口。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-08-02

---

## 1. 背景

程序化动作参数此前是单一扁平 `ProcMotionState`：

```ts
interface ProcMotionState {
    mode: 'off' | 'idle' | 'autodance';   // 当前激活模式
    intensity: number;
    speed: number;
    boneToggles: Record<BoneCategory, boolean>;
    vpdApplyEnabled: boolean;
    interpOverride: 'auto' | 'sharp' | ...;
    // + bpmQuantizeEnabled / eyeTracking / headTracking / multiMorphEnabled
}
```

问题：
1. **参数无模式维度**：把待机呼吸调成「轻柔呼吸 + 慢速」再切到自动舞蹈，舞蹈也用同一套轻柔/慢速参数——两类动作的自然参数需求完全不同，无法并存。
2. **idle 不读骨骼微动**：`generateIdleVmd` 只用 `speed`/`intensity`，`boneToggles` 只在 `generateAutoDanceVmd` 生效。UI 上待机呼吸的「骨骼微动」开关是摆设（关闭后待机照旧摆）。

## 2. 决策

### 2.1 类型拆分：全局顶层 + per-mode params

```ts
export type ProcModeKey = Exclude<ProcMotionMode, 'off'>; // 'idle' | 'autodance'

export interface ProcMotionParams {
    intensity: number;
    speed: number;
    boneToggles: Record<ProcMotionBoneCategory, boolean>;
    vpdApplyEnabled: boolean;
    interpOverride: 'auto' | 'sharp' | 'ease-in-out' | 'ease-out';
}

export interface ProcMotionState {
    mode: ProcMotionMode;              // 当前激活模式（全局）
    bpmQuantizeEnabled: boolean;       // 全局：节拍器运行时设置
    eyeTrackingEnabled: boolean;       // 全局：感知层
    headTrackingEnabled: boolean;      // 全局：感知层
    params: Record<ProcModeKey, ProcMotionParams>;  // idle / autodance 各自独立
}
```

`multiMorphEnabled` 已迁移至 lipsync（`scene-migrate.ts`），不再属于程序化状态。

### 2.2 存储分层不变，参数维度新增

沿用既有优先级 `per-model inst.procMotion > activeMotion.procMotion > _fallbackProcState`，只是写入/读取落到 `params[mode]`：
- bridge setter 加 `mode` 首参（`setProcMotionIntensity/Speed/BoneToggle/BoneToggles/VpdApplyEnabled/InterpOverride(mode, ...)`）；
- `setProcMotionMode` / 感知层开关走顶层写入（`_writeTopLevel`），不进 params。

### 2.3 生成器按模式取参

`generateIdleVmd(params, bones)` / `generateAutoDanceVmd(params, bpm, morphs, bones)` 收 `ProcMotionParams`；bridge 生成时用 `state.params[targetMode]`。trunk/limbs 辅助函数的 `state` 参数本未被使用，改为 `ProcMotionParams` 类型透传。

### 2.4 idle 尊重骨骼微动（顺带修复既有缺口）

`generateIdleVmd` 对每个骨类别段（center/upper2/waist/allParent/肩/臂/腕/足IK）先查 `params.boneToggles[cat]`，关闭则整段不生成——与自动舞蹈行为对齐。

### 2.5 防御：`getProcMotionState()` 深层拷贝

浅拷贝会让调用方 mutate 返回对象时污染内部 `params` 引用（新测试暴露）。改为对 `params.idle/autodance` 及其 `boneToggles` 逐层拷贝。

## 3. 迁移与兼容

新增纯函数 `migrateProcState(raw)`（`proc-motion-shared.ts`）：

- **新结构**（含 `params`）→ 原样归一（逐字段合并默认）；
- **旧扁平**（`intensity/speed/boneToggles/...` 在顶层）→ 拆到 `params.idle` 与 `params.autodance`，**两边同值**（等价旧行为，用户旧存档零感知）；
- 缺失字段 / 测试 mock 的 `{}` → 显式取默认，不依赖 `DEFAULT_PROC_STATE` 存在。

应用点：`scene-serialize.ts` 三处加载（全局恢复 / motion 导入 / legacy 单例）+ `proc-motion-bridge.setProcMotionState` 入口。`scene-migrate.migratePerceptionFromProcMotion` 兼容新旧两种 shape（旧顶层 `boneToggles` 或新 `params.*.boneToggles`）。

## 4. 实施文件

| 文件 | 变更 |
|------|------|
| `motion-algos/proc-motion-shared.ts` | 新类型 + DEFAULT + `migrateProcState` |
| `motion-algos/proc-motion-idle.ts` | 收 params + 尊重 boneToggles |
| `motion-algos/proc-motion-autodance.ts` / `-bones-trunk/-limbs.ts` | 收 params |
| `scene/motion/proc-motion-bridge.ts` | setter per-mode + 顶层写入 + 深层拷贝 + 迁移入口 |
| `menus/motion-procmotion-levels.ts` | 参数卡绑定 `params[mode]`（标题带模式名） |
| `menus/motion-detail-ui.ts` | targetMode 推导（查看的 proc / 激活模式） |
| `menus/model-detail.ts` | procEdit 传 procId |
| `scene/scene-serialize.ts` / `scene-migrate.ts` | 迁移应用 + 兼容 |

## 5. 测试

- 更新：`procedural-motion.test.ts`、`proc-motion-bridge.{state,toggles,lifecycle}.test.ts`、mocks ×2、serialize 测试。
- 新增：`proc-motion-migrate.test.ts`（旧扁平→嵌套、新结构透传、缺失字段默认）；per-mode 独立性（idle/autodance 强度速度互不影响）；idle 骨骼微动开关（关 arm 无左腕/右腕帧）；`getProcMotionState` 深层拷贝回归。

## 6. 风险与约束

| 风险 | 缓解 |
|------|------|
| 旧存档参数语义变化（拆两模式同值） | 等价旧行为，用户无感知；两模式独立后各自微调 |
| idle 尊重 boneToggles 改变既有待机观感 | 用户已确认；关闭开关才有差异，默认全开不变 |
| setter 签名破坏性变更 | 调用方仅 UI 层 + 测试，已全部同步 |
| 感知层（eye/head tracking）误入 per-mode | 明确保持全局顶层，不随程序化切换 |
