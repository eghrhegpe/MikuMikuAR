# ADR-163: 感知层冲突可视化 — 闭环「左右脑互博」用户层可见性

> **状态**: 已完成（2026-07-21；P2-1 重 claim / P2-2 unpin 入口 / P2-3 banner 泛化由 ADR-166 收口；独立审核 frontend 1821 测试 0 失败）
> **关联**: ADR-071（程序化与感知边界）、ADR-116（冲突可视化）、ADR-147（显式管线调度器）、ADR-150（gaze delta）、ADR-162（per-model）
> **来源**: 2026-07-19 topics [6a5b5da3] 用户层「左右脑互博」可见性未闭环风险
> **日期**: 2026-07-21

---

## 一、问题陈述

### 1.1 背景

ADR-147 已建立模块层（per-motion）的冲突可视化：[motion-override-levels.ts:82-113](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/motion-override-levels.ts#L82-L113) `updateConflictBanner` 渲染 `getAllConflicts(modelId)` 快照，显示模块间骨骼抢占。

ADR-150 修复了 gaze 的「物理覆写」根因，但**感知层与模块层的冲突用户仍不可见**：

| 场景 | 用户行为 | 实际后果 | 用户感知 |
|------|---------|---------|---------|
| 模块层抢占头部骨骼 | 调 gaze 滑块 | 模块层 P1 抢占，感知层 gaze 失效 | 滑块无效果，无提示 |
| Bone Override 写躯干 | 调 breathing 滑块 | Bone Override 先执行，breathing delta 叠加 | 效果被部分覆盖，无提示 |
| 模块层关闭感知层 claim | 调 balance 滑块 | claimBones 失败，balance 不写入 | 滑块无效果，无提示 |

### 1.2 根因

感知层**未接入 claimBones 系统**：

| 文件 | 现状 |
|------|------|
| [perception.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception.ts) | 不导入 registry.ts，不调 claimBones |
| [perception-gaze.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-gaze.ts) | 直接写骨骼，不声明所有权 |
| [perception-breathing.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-breathing.ts) | 同上 |
| [perception-balance.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception-balance.ts) | 同上 |

感知层 delta 叠加（ADR-150 + breathing/balance 修复）避免了**物理覆写**，但 claimBones 系统仍认为感知层"不存在"，冲突 banner 无法显示感知层参与的冲突。

---

## 二、设计方案

### 2.1 核心决策：感知层声明 priority=P3，被动让位

感知层调 `claimBones` 声明骨骼所有权，但 priority=P3（最低，符合项目规范"用户手动覆盖优先级最低"的反向：感知层是 always-on 兜底，应让位于用户主动配置）。

```
priority 体系：
  P1（10）= Bone Override 用户手动
  P2（20）= 模块层（body-posture / sway-motion / finger-pose）
  P3（100）= 感知层（perception.gaze / perception.breath / perception.balance）
```

### 2.2 感知层模块划分

| 感知层模块 ID | 认领骨骼 | 优先级 |
|---------------|---------|--------|
| `perception.gaze.head` | `頭, 首, head, Head` | P3 (100) |
| `perception.gaze.eye` | `右目, 左目, Eye_R, Eye_L, ...` | P3 (100) |
| `perception.breath` | `上半身, 上半身2, 首, 頭, ...` | P3 (100) |
| `perception.balance.center` | `center, 全ての親, ...` | P3 (100) |
| `perception.balance.upper` | `上半身2` | P3 (100) |
| `perception.balance.waist` | `腰` | P3 (100) |
| `perception.expression` | （morph，不涉及骨骼） | N/A |

### 2.3 claimBones 接入时机

感知层在 **activatePerception** 时调 `claimBones` 一次（非每帧），与模块层 enable 时同款：

```typescript
// perception.ts activatePerception 内
const claimedHead = claimBones(modelId, 'perception.gaze.head', HEAD_BONES);
const claimedEye = claimBones(modelId, 'perception.gaze.eye', EYE_BONES);
const claimedBreath = claimBones(modelId, 'perception.breath', BREATH_BONES);
// ...

// 记录实际认领的骨骼，用于 deactivate 时 release
_perceptionOwnedBones.set(modelId, { head: claimedHead, eye: claimedEye, ... });
```

### 2.4 让位策略

感知层 P3 被 P1/P2 抢占时：
- `claimBones` 返回的 `claimed` 不含被抢占骨骼
- 感知层 observer 内部检查 `claimed.includes(bone)`，不在则跳过该骨骼写入
- 冲突已由 `BoneOverrideStore` 自动记录到 `_conflicts`

### 2.5 UI 可视化

#### 2.5.1 感知层 banner（复用 motion-override-levels 模式）

在 [motion-gaze-levels.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/motion-gaze-levels.ts) 顶部加冲突 banner：

```typescript
// 复用 updateConflictBanner 模式
function updatePerceptionConflictBanner(el: HTMLElement, modelId: string | null): void {
    if (!modelId) { el.textContent = ''; el.style.display = 'none'; return; }
    
    // 查询感知层被抢占的骨骼
    const perceptionModules = [
        'perception.gaze.head', 'perception.gaze.eye',
        'perception.breath', 'perception.balance.center',
        'perception.balance.upper', 'perception.balance.waist',
    ];
    const lines: string[] = [];
    for (const modId of perceptionModules) {
        const conflicts = getModuleConflicts(modelId, modId);
        if (conflicts.length > 0) {
            const detail = conflicts.map(c => `${c.bone}←${c.byModule}`).join('、');
            lines.push(`⚠ ${modId}: ${detail}`);
        }
    }
    // ... 渲染
}
```

#### 2.5.2 滑块旁冲突标记

在感知层滑块（如 `breathAmplitude`）旁加 `lucide:alert-triangle` 图标，tooltip 显示「被 Bone Override 覆写」：

```typescript
{
    id: 'perception:breathAmp',
    kind: 'slider',
    label: 'motion.breathAmplitude',
    bind: 'perception.breathAmplitude',
    // 新增：冲突标记
    conflictHint: 'perception.breath',  // 查询该模块是否有冲突
}
```

### 2.6 冲突场景示例

| 场景 | claimBones 结果 | UI 显示 |
|------|----------------|---------|
| 仅感知层开启 | 感知层 claim 成功 | 无 banner |
| Bone Override 抢占头部 | 感知层 claim 失败 | `⚠ perception.gaze.head: 頭←bone-override` |
| 模块层 body-posture 抢占躯干 | 感知层 breath claim 失败 | `⚠ perception.breath: 上半身←body-posture` |
| 用户关闭 Bone Override | 感知层重新 claim 成功 | banner 消失 |

---

## 三、改动范围

| 文件 | 改动 | 风险 |
|------|------|------|
| [perception.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception.ts) | activate 时调 claimBones；deactivate 时 releaseOwnedBones | 🟠 中 |
| [perception-gaze/breathing/balance.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion) | observer 内检查 claimed 再写入 | 🟡 低 |
| [motion-gaze-levels.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/motion-gaze-levels.ts) | 加 perceptionConflictBanner + 滑块 conflictHint | 🟡 低 |
| [menu-schema.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/menu-schema.ts) | MenuNode 加 `conflictHint?: string` 字段 | 🟢 低 |
| [registry.ts](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/motion-modules/registry.ts) | 感知层模块 ID 需在 `_registry` 注册（或豁免） | 🟡 低 |

---

## 四、风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 感知层 claimBones 后被抢占，感知功能"失效" | 🟠 中 | 这是预期行为（用户主动配置优先），banner 提示用户 |
| claimBones 在 activate 时调一次，骨骼后续变化未跟踪 | 🟡 低 | 模块层 disable 时会 releaseOwnedBones，感知层可重新 claim |
| 循环依赖：perception → registry → bone-override-store | 🟢 低 | registry 不导入 perception，无循环 |
| 感知层模块 ID 污染 _registry | 🟡 低 | 感知层 ID 用 `perception.` 前缀，与模块层 `body-posture` 等区分 |
| 性能：claimBones 仅 activate 时调一次 | 🟢 低 | 非每帧调用，无性能影响 |

---

## 五、实施计划

| 阶段 | 内容 |
|------|------|
| **Phase 1** | perception.ts activate 调 claimBones；记录 ownedBones |
| **Phase 2** | observer 内检查 claimed 再写入；deactivate 调 releaseOwnedBones |
| **Phase 3** | motion-gaze-levels 加 perceptionConflictBanner |
| **Phase 4** | menu-schema MenuNode 加 conflictHint 字段；滑块加标记 |
| **Phase 5** | 测试：模拟抢占场景，验证 banner 显示与感知层让位 |

---

## 六、验收标准

| 标准 | 验证方法 |
|------|---------|
| Bone Override 开启头部后，gaze 头部跟随失效 | 实测 |
| 感知层 banner 显示「perception.gaze.head: 頭←bone-override」 | UI 检查 |
| 关闭 Bone Override 后，gaze 恢复，banner 消失 | 实测 |
| 滑块旁冲突标记正确显示 | UI 检查 |
| 感知层 claimBones 不影响模块层优先级 | 单测 |
| 现有 57 项 perception 测试不破坏 | `npm run test` |

---

## 七、与 ADR-150 / ADR-162 的协同

| ADR | 关系 |
|-----|------|
| ADR-150（gaze delta） | 物理层闭环：避免 gaze 覆写 VMD |
| ADR-162（per-model） | 状态层扩展：perception → per-model context |
| **ADR-163（本）** | 可见性层闭环：用户能看到感知层与模块层的冲突 |

三者共同闭环「左右脑互博」的三层风险：
1. **物理层**（ADR-150）：delta 叠加避免覆写
2. **状态层**（ADR-162）：per-model 避免单例限制
3. **可见性层**（ADR-163）：冲突 banner 让用户知道发生了什么

---

## 八、开放问题

1. **感知层 claimBones 是否需要 stage 字段？** ADR-147 M8 为 BoneConflict 加了 `loserStage`/`winnerStage`，感知层应填 `stage='perception'`。
2. **滑块 conflictHint 是否需要实时更新？** 当前设计是每次菜单刷新时重算，与模块层 banner 一致。
3. **感知层被抢占时是否自动关闭对应开关？** 当前设计不自动关闭，保持用户配置不变，仅提示。避免用户重新开启时又被抢占的循环。
