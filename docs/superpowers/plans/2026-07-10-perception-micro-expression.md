# ADR-079 Phase 1: 微表情迁移至感知层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 lifelike 的情绪微表情 morph 生成从 VMD 关键帧方式迁移到 perception.ts 的 always-on 实时叠加，lifelike 生成器删除。

**Architecture:** 在 `perception.ts` 新增 `_applyMicroExpression(mmdModel, time, emotion)` 实时叠加函数，emotion 状态纳入 `PerceptionState`。`proc-motion-lifelike.ts` 的 morph 生成逻辑删除（骨骼微动保留待 Phase 2 评估）。序列化扩展 `PerceptionState` 字段 + 旧存档迁移。UI 在 `motion-gaze-levels.ts` 新增 emotion 选择与开关。

**Tech Stack:** TypeScript, Babylon.js, babylon-mmd, Vitest

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `frontend/src/scene/motion/perception.ts` | 感知层核心 | 修改：新增 `_applyMicroExpression` + 扩展 `PerceptionState` |
| `frontend/src/__tests__/perception.test.ts` | 感知层测试 | 修改：新增微表情测试 |
| `frontend/src/motion-algos/proc-motion-lifelike.ts` | lifelike VMD 生成 | 修改：移除 emotion morph 生成（骨骼微动保留） |
| `frontend/src/motion-algos/proc-motion-shared.ts` | 程序化动作共享类型 | 修改：移除 `emotion` bone category（如无其他引用） |
| `frontend/src/scene/scene-serialize.ts` | 场景序列化 | 修改：扩展 `PerceptionState` 读写 + 旧存档迁移 |
| `frontend/src/menus/motion-gaze-levels.ts` | Gaze/感知 UI | 修改：新增 emotion 选择 + 微表情开关 |
| `frontend/src/core/i18n/locales/{zh-CN,en,ja,ko,zh-TW}.ts` | i18n | 修改：新增微表情翻译键 |
| `docs/adr/adr-079-perception-layer-expansion.md` | ADR | 修改：Phase 1 完成后状态更新 |

---

## Task 1: 扩展 PerceptionState 类型

**Files:**
- Modify: `frontend/src/scene/motion/perception.ts:31-46`

- [ ] **Step 1: 写失败测试**

在 `frontend/src/__tests__/perception.test.ts` 末尾新增：

```typescript
// =====================================================================
// 微表情（Micro Expression）状态
// =====================================================================

describe('microExpression state', () => {
    it('默认 emotion 为 neutral，microExpressionEnabled 为 true', () => {
        const sut = makeSut();
        const state = sut.getPerceptionState();
        expect(state.emotion).toBe('neutral');
        expect(state.microExpressionEnabled).toBe(true);
    });

    it('setPerceptionState 可更新 emotion', () => {
        const sut = makeSut();
        sut.setPerceptionState({ emotion: 'happy' });
        expect(sut.getPerceptionState().emotion).toBe('happy');
    });

    it('setPerceptionState 可关闭微表情', () => {
        const sut = makeSut();
        sut.setPerceptionState({ microExpressionEnabled: false });
        expect(sut.getPerceptionState().microExpressionEnabled).toBe(false);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL — `state.emotion` is undefined / `state.microExpressionEnabled` is undefined

- [ ] **Step 3: 扩展 PerceptionState 接口与默认值**

在 `frontend/src/scene/motion/perception.ts` 修改：

```typescript
/** 情绪类型（微表情驱动） */
export type Emotion = 'neutral' | 'happy' | 'sad' | 'surprised' | 'angry';

export interface PerceptionState {
    breathEnabled: boolean;
    blinkEnabled: boolean;
    headTrackingEnabled: boolean;
    eyeTrackingEnabled: boolean;
    microExpressionEnabled: boolean;
    emotion: Emotion;
}

/** Gaze 配置类型 */
export type GazeConfig = { headEnabled: boolean; eyeEnabled: boolean };

const DEFAULT_PERCEPTION_STATE: PerceptionState = {
    breathEnabled: true,
    blinkEnabled: true,
    headTrackingEnabled: true,
    eyeTrackingEnabled: true,
    microExpressionEnabled: true,
    emotion: 'neutral',
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS（3 个新测试通过）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/scene/motion/perception.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(perception): 扩展 PerceptionState 加入 emotion 与 microExpressionEnabled"
```

---

## Task 2: 实现 _applyMicroExpression 实时叠加

**Files:**
- Modify: `frontend/src/scene/motion/perception.ts`（新增函数 + 注册到 observer）
- Test: `frontend/src/__tests__/perception.test.ts`

**设计说明**：
- 情绪 → morph 映射：happy→笑み/Smile、sad→困りォ/Troubled、surprised→驚き/Surprised、angry→怒り/Angry、neutral→无
- 叠加方式：读当前 morph weight → Slerp 到目标 weight（平滑过渡，避免跳变）
- 频率：每 3-5 秒一个微表情脉冲（0.1-0.15 权重），非持续高频

- [ ] **Step 1: 写失败测试**

测试通过 observer 回调触发（方案 B），不导出测试专用函数，避免污染生产代码。需 mock `performance.now()` 控制时间。

在 `frontend/src/__tests__/perception.test.ts` 新增：

```typescript
// =====================================================================
// _applyMicroExpression 实时叠加（通过 observer 回调触发）
// =====================================================================

describe('_applyMicroExpression', () => {
    beforeEach(() => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('neutral 情绪不写入任何 morph', () => {
        const sut = makeSut();
        const mockMorphManager = makeMockMorphManager(['笑み', '困りォ', '驚き', '怒り']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        sut.setPerceptionState({ emotion: 'neutral', microExpressionEnabled: true });
        sut.activatePerception('m1');
        // 触发 observer 回调（time=0）
        triggerObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBe(0);
    });

    it('happy 情绪周期性脉冲笑み morph', () => {
        const sut = makeSut();
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');
        // 脉冲峰值在半周期（t = MICRO_EXPR_PERIOD/2 = 2s）
        (performance.now as ReturnType<typeof vi.fn>).mockReturnValue(2000);
        triggerObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBeGreaterThan(0);
        expect(mockMorphManager.getInfluence('笑み')).toBeLessThanOrEqual(0.15);
    });

    it('microExpressionEnabled=false 时不写入', () => {
        const sut = makeSut();
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: false });
        sut.activatePerception('m1');
        (performance.now as ReturnType<typeof vi.fn>).mockReturnValue(2000);
        triggerObserver();
        expect(mockMorphManager.getInfluence('笑み')).toBe(0);
    });

    it('morph 不存在时静默跳过', () => {
        const sut = makeSut();
        const mockMorphManager = makeMockMorphManager([]); // 无 morph
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');
        (performance.now as ReturnType<typeof vi.fn>).mockReturnValue(2000);
        expect(() => triggerObserver()).not.toThrow();
    });
});
```

**测试辅助**（在测试文件顶部新增，或复用已有 mock）：

```typescript
// Mock morphTargetManager（与 _applyBlinking 用的 API 一致）
function makeMockMorphManager(names: string[]) {
    const influences = new Map<string, number>();
    for (const n of names) influences.set(n, 0);
    return {
        getMorphTargetNames: () => names,
        getMorphTargetByName: (name: string) =>
            influences.has(name) ? { set influence(v: number) { influences.set(name, v); } } : null,
        getInfluence: (name: string) => influences.get(name) ?? 0,
    };
}

function makeMockModelWithMorphManager(morphManager: ReturnType<typeof makeMockMorphManager>) {
    return {
        mesh: { morphTargetManager: morphManager },
        runtimeBones: [],
    };
}

// 触发 perception observer 回调
function triggerObserver(): void {
    // mockState.scene.onBeforeRenderObservable.add 返回的 callback 被记录
    // 调用 mockState.scene.lastObserverCallback() 触发
    mockState.scene.triggerLastObserver();
}
```

**注意**：`mockState.scene.triggerLastObserver` 需在现有 mock 中支持——若不存在，在 `makeSut` 的 mock scene 里新增：`onBeforeRenderObservable.add` 记录 callback 到 `lastObserverCallback`，`triggerLastObserver` 调用它。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL — observer 回调中无微表情逻辑，influence 不被写入

- [ ] **Step 3: 实现 _applyMicroExpression**

在 `frontend/src/scene/motion/perception.ts` 新增（紧邻 `_applyBlinking` 之后）。**morph API 与 `_applyBlinking` 一致**：用 `morphTargetManager` + `getMorphTargetByName` + `.influence`，复用 `matchBone` 匹配候选名。

```typescript
// ── 微表情（情绪 morph 实时脉冲） ──

/** 情绪 → morph 名候选（按优先级降序匹配，复用 matchBone） */
const EMOTION_MORPH_CANDIDATES: Record<Exclude<Emotion, 'neutral'>, string[]> = {
    happy: ['笑み', 'Smile', 'smile', 'にっこり', 'Happy'],
    sad: ['困りォ', 'Troubled', 'troubled', '悲しい', 'Sad'],
    surprised: ['驚き', 'Surprised', 'surprised', 'びっくり', 'Surprise'],
    angry: ['怒り', 'Angry', 'angry', '怒', 'Angry2'],
};

/** 微表情脉冲周期（秒） */
const MICRO_EXPR_PERIOD = 4.0;
/** 微表情脉冲峰值权重 */
const MICRO_EXPR_PEAK = 0.12;

function _applyMicroExpression(mmdModel: any, time: number, emotion: Emotion): void {
    if (emotion === 'neutral') return;

    const candidates = EMOTION_MORPH_CANDIDATES[emotion];
    if (!candidates || candidates.length === 0) return;

    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) return;

    // 复用 matchBone 匹配候选 morph 名（与 _applyBlinking 同款模式）
    const morphNames = morphManager.getMorphTargetNames?.() || [];
    const targetName = matchBone(morphNames, candidates);
    if (!targetName) return;

    const targetMorph = morphManager.getMorphTargetByName?.(targetName);
    if (!targetMorph) return;

    // 周期性脉冲：sin²(t * 2π / period) 在 [0,1] 间振荡，乘以峰值权重
    const phase = (time % MICRO_EXPR_PERIOD) / MICRO_EXPR_PERIOD; // [0,1)
    const pulse = Math.sin(phase * Math.PI * 2) ** 2; // [0,1]
    const weight = pulse * MICRO_EXPR_PEAK;

    // 写入 morph 权重（与 _applyBlinking 的 influence 赋值一致）
    targetMorph.influence = weight;
}
```

**导入**：`matchBone` 已在 perception.ts 顶部从 `proc-motion-shared` 导入（[:14-15](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/scene/motion/perception.ts#L14-L15)），无需新增。

- [ ] **Step 4: 注册到 perception observer**

在 `perception.ts` 的 observer 回调内（`activatePerception` 函数中 `scene.onBeforeRenderObservable.add` 的回调），在眨眼之后、gaze 之前新增：

```typescript
        // 3. 微表情
        if (perceptionState.microExpressionEnabled) {
            _applyMicroExpression(mmdModel, time, perceptionState.emotion);
        }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS（所有微表情测试通过）

- [ ] **Step 6: 类型检查**

Run: `cd frontend && npm run check`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add frontend/src/scene/motion/perception.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(perception): 实现 _applyMicroExpression 情绪 morph 实时叠加"
```

---

## Task 3: 移除 lifelike 的 emotion morph 生成（保留骨骼微动）

**范围澄清**：本 Task 只删除 emotion morph VMD 生成块。lifelike 的骨骼微动（L200-263）**保留**——骨骼微动是否迁入感知层属于 ADR-079 Phase 2 范围，本 Phase 不处理。lifelike 生成器在此 Task 后退化为「仅骨骼微动」，不整体删除。

**Files:**
- Modify: `frontend/src/motion-algos/proc-motion-lifelike.ts:265-279`
- Modify: `frontend/src/motion-algos/proc-motion-shared.ts`（移除 `emotion` category 如无其他引用）

- [ ] **Step 1: 确认 emotion category 引用范围**

Run: `cd frontend && rg -n "emotion" src/motion-algos/ src/menus/ src/scene/ --type ts`
检查 `boneToggles.emotion` 是否在 UI 或其他逻辑中被引用。记录引用点。

- [ ] **Step 2: 移除 lifelike 的 emotion morph 生成**

在 `frontend/src/motion-algos/proc-motion-lifelike.ts` 删除 `if (state.boneToggles.emotion)` 块（约 L265-279）：

```typescript
// 删除以下代码块：
    if (state.boneToggles.emotion) {
        const selected = morphNames.slice(0, 3);
        for (let mi = 0; mi < selected.length; mi++) {
            const mName = selected[mi];
            const offset = (mi * loopFrames) / selected.length;
            const flickerStart = Math.round(offset + loopFrames * 0.1);
            if (flickerStart + 4 <= loopFrames) {
                const w = 0.15 * intensity;
                morphs.push({ name: mName, frame: flickerStart, weight: 0 });
                morphs.push({ name: mName, frame: flickerStart + 1, weight: w });
                morphs.push({ name: mName, frame: flickerStart + 3, weight: w });
                morphs.push({ name: mName, frame: flickerStart + 4, weight: 0 });
            }
        }
    }
```

保留骨骼微动生成逻辑（待 Phase 2 评估是否迁移）。

- [ ] **Step 3: 评估 emotion category 保留与否**

若 Step 1 显示 `boneToggles.emotion` 仅在 lifelike 中使用，从 `proc-motion-shared.ts` 的 `PROC_MOTION_BONE_CATEGORIES` 数组和 `_defaultBoneToggles` 中移除 `'emotion'`。若有其他引用（如 UI toggle），保留 category 但标记废弃。

- [ ] **Step 4: 运行测试**

Run: `cd frontend && npx vitest run src/__tests__/procedural-motion.test.ts`
Expected: PASS（若 lifelike 测试断言了 emotion morph，需同步更新断言）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/motion-algos/proc-motion-lifelike.ts frontend/src/motion-algos/proc-motion-shared.ts
git commit -m "refactor(lifelike): 移除 emotion morph 生成（已迁入感知层）"
```

---

## Task 4: 序列化扩展与旧存档迁移

**Files:**
- Modify: `frontend/src/scene/scene-serialize.ts:587-599`

- [ ] **Step 1: 写失败测试**

**映射规则澄清**：旧 `boneToggles.emotion` 的语义是「是否启用微表情生成」（boolean），不是「选择哪种情绪」。迁移映射：
- `boneToggles.emotion === true` → `microExpressionEnabled: true, emotion: 'neutral'`（启用微表情，情绪默认 neutral）
- `boneToggles.emotion === false` 或缺省 → `microExpressionEnabled: false, emotion: 'neutral'`

在 `frontend/src/__tests__/perception.test.ts`（或 `scene-serialize.test.ts` 若存在）新增迁移测试：

```typescript
describe('scene-serialize perception migration', () => {
    it('旧存档无 perception.emotion 时默认 neutral', () => {
        const oldData = { perception: { breathEnabled: true, blinkEnabled: true } };
        // 模拟 setPerceptionState 调用
        const sut = makeSut();
        sut.setPerceptionState(oldData.perception);
        expect(sut.getPerceptionState().emotion).toBe('neutral');
        expect(sut.getPerceptionState().microExpressionEnabled).toBe(true);
    });

    it('旧存档 procMotion.boneToggles.emotion=true 时映射为 microExpressionEnabled=true, emotion=neutral', () => {
        const oldData = { procMotion: { boneToggles: { emotion: true } } };
        // 迁移逻辑在 scene-serialize.ts 中处理
        // 验证：emotion toggle 的语义是「启用微表情」，不映射具体情绪
        // 迁移后：microExpressionEnabled=true, emotion='neutral'
        const migrated = migratePerceptionFromProcMotion(oldData.procMotion);
        expect(migrated.microExpressionEnabled).toBe(true);
        expect(migrated.emotion).toBe('neutral');
    });

    it('旧存档 procMotion.boneToggles.emotion=false 时映射为 microExpressionEnabled=false', () => {
        const oldData = { procMotion: { boneToggles: { emotion: false } } };
        const migrated = migratePerceptionFromProcMotion(oldData.procMotion);
        expect(migrated.microExpressionEnabled).toBe(false);
        expect(migrated.emotion).toBe('neutral');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL（旧 perception 无 emotion 字段时行为未定义）

- [ ] **Step 3: 更新 scene-serialize.ts 迁移逻辑**

在 `frontend/src/scene/scene-serialize.ts` L588-599，扩展 `setPerceptionState` 调用，并**导出 `migratePerceptionFromProcMotion` 供测试引用**：

```typescript
/** 从旧 procMotion 状态迁移为 PerceptionState（供测试与序列化共用） */
export function migratePerceptionFromProcMotion(
    old: Partial<ProcMotionState>
): Partial<PerceptionState> {
    return {
        eyeTrackingEnabled: old.eyeTrackingEnabled ?? true,
        headTrackingEnabled: old.headTrackingEnabled ?? true,
        blinkEnabled: old.boneToggles?.blink ?? true,
        breathEnabled: true,
        // 旧 boneToggles.emotion 语义是「启用微表情」（boolean），不映射具体情绪
        microExpressionEnabled: old.boneToggles?.emotion ?? true,
        emotion: 'neutral',
    };
}
```

序列化加载处调用：

```typescript
    // 优先读 data.perception；旧存档无此字段时从 procMotion 迁移
    if (data.perception) {
        setPerceptionState(data.perception as Partial<PerceptionState>);
    } else if (data.procMotion) {
        setPerceptionState(migratePerceptionFromProcMotion(data.procMotion as Partial<ProcMotionState>));
    }
    activatePerception();
```

**写入侧**（L291 附近）：`getPerceptionState()` 已返回完整 `PerceptionState`，序列化无需改动（`perception: { ...getPerceptionState() }` 已包含新字段）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add frontend/src/scene/scene-serialize.ts frontend/src/__tests__/perception.test.ts
git commit -m "feat(serialize): PerceptionState 扩展 emotion 字段 + 旧存档迁移"
```

---

## Task 5: UI 接入（motion-gaze-levels.ts）

**Files:**
- Modify: `frontend/src/menus/motion-gaze-levels.ts`
- Modify: `frontend/src/core/i18n/locales/{zh-CN,en,ja,ko,zh-TW}.ts`

- [ ] **Step 1: 确认 motion-gaze-levels.ts 现有结构**

Run: `cd frontend && rg -n "addToggleRow|addCollapsible|section-title|breathEnabled|blinkEnabled" src/menus/motion-gaze-levels.ts`
了解现有感知开关 UI 的实现模式（`addToggleRow` + `bind` / `onUpdate`）。

- [ ] **Step 2: 添加 i18n 翻译键**

在 5 个 locale 文件中新增（示例为 zh-CN）：

```typescript
// frontend/src/core/i18n/locales/zh-CN.ts
perception: {
    // ... 现有键 ...
    microExpression: '微表情',
    emotion: '情绪',
    emotionNeutral: '平静',
    emotionHappy: '开心',
    emotionSad: '悲伤',
    emotionSurprised: '惊讶',
    emotionAngry: '愤怒',
},
```

同步在 `en.ts` / `ja.ts` / `ko.ts` / `zh-TW.ts` 添加对应翻译。

- [ ] **Step 3: 在 motion-gaze-levels.ts 新增 UI**

**addModeRow 签名已确认**（[ui-rows.ts:338](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/core/ui-rows.ts#L338)）：`addModeRow<T>(container, label: string, options: Array<{value: T, label: string}>, currentValue: T, onChange: (v: T) => void)`。**onChange 模式与现有感知开关一致**（参考 [:27-35](file:///c:/Users/zhujieling11/MikuMikuAR/frontend/src/menus/motion-gaze-levels.ts#L27-L35)）：`setXxx + activatePerception + getMotionMenu()?.updateControls()`，不用 `triggerAutoSave`。

需新增 import：`addModeRow` 从 `core/ui-helpers` 导入；`setMicroExpressionEnabled`/`setEmotion` 从 `perception` 导入（若 Task 1/2 未新增这两个 setter，在此 Task 补——它们应包装 `setPerceptionState` 并触发持久化）。

在现有感知开关区块（呼吸/眨眼/gaze 之后）新增微表情区块：

```typescript
import { addToggleRow, addModeRow } from '../core/ui-helpers';
import {
    getPerceptionState,
    setEyeTrackingEnabled,
    setHeadTrackingEnabled,
    setBreathEnabled,
    setBlinkEnabled,
    setMicroExpressionEnabled,  // 新增
    setEmotion,                 // 新增
    activatePerception,
} from '../scene/motion/perception';
import type { Emotion } from '../scene/motion/perception';  // 新增

// ... 在 renderCustom 内，gaze 区块之后 ...

// 微表情开关
addToggleRow(
    c,
    t('perception.microExpression'),
    getPerceptionState().microExpressionEnabled,
    (v) => {
        setMicroExpressionEnabled(v);
        activatePerception();
        getMotionMenu()?.updateControls();
    },
);

// 情绪选择（addModeRow 签名：container, label, options, currentValue, onChange）
const emotionOptions: Array<{ value: Emotion; label: string }> = [
    { value: 'neutral', label: t('perception.emotionNeutral') },
    { value: 'happy', label: t('perception.emotionHappy') },
    { value: 'sad', label: t('perception.emotionSad') },
    { value: 'surprised', label: t('perception.emotionSurprised') },
    { value: 'angry', label: t('perception.emotionAngry') },
];
addModeRow<Emotion>(
    c,
    t('perception.emotion'),
    emotionOptions,
    getPerceptionState().emotion,
    (v) => {
        setEmotion(v);
        activatePerception();
        getMotionMenu()?.updateControls();
    },
);
```

**注意**：`setMicroExpressionEnabled` / `setEmotion` 需在 perception.ts 中新增（若 Task 1 未包含）。它们应与现有 `setBreathEnabled` / `setBlinkEnabled` 同款实现——包装 `setPerceptionState({ ... })` 并触发 `triggerAutoSave()`（perception 的 setter 已有此模式，参考 ADR-071 P3）。若 Task 1 的 `setPerceptionState` 已是通用入口且触发持久化，则这两个 setter 可省略，直接调 `setPerceptionState({ microExpressionEnabled: v })`——以现有 `setBreathEnabled` 是否存在为准，grep 确认。

- [ ] **Step 4: 类型检查**

Run: `cd frontend && npm run check`
Expected: PASS

- [ ] **Step 5: 运行全量测试**

Run: `cd frontend && npm run test`
Expected: PASS（无新增失败）

- [ ] **Step 6: 提交**

```bash
git add frontend/src/menus/motion-gaze-levels.ts frontend/src/core/i18n/locales/
git commit -m "feat(ui): motion-gaze-levels 新增微表情开关与情绪选择"
```

---

## Task 6: 更新 ADR-079 状态

**Files:**
- Modify: `docs/adr/adr-079-perception-layer-expansion.md`

- [ ] **Step 1: 更新 ADR 状态行**

```markdown
> **状态**: Phase 1 已实施（2026-07-10）；Phase 2/3 待排期
```

- [ ] **Step 2: 在 ADR 末尾新增完成记录**

```markdown
---

## 实施记录

### Phase 1: 微表情迁移（2026-07-10）

- ✅ `PerceptionState` 扩展 `emotion` + `microExpressionEnabled`
- ✅ `_applyMicroExpression` 实时叠加实现（周期性脉冲，4s 周期，0.12 峰值）
- ✅ `proc-motion-lifelike.ts` 移除 emotion morph 生成
- ✅ 序列化扩展 + 旧存档迁移（`boneToggles.emotion` → `microExpressionEnabled`）
- ✅ UI 接入：motion-gaze-levels 新增情绪选择 + 开关
- ✅ i18n 5 语言同步
```

- [ ] **Step 3: 提交**

```bash
git add docs/adr/adr-079-perception-layer-expansion.md
git commit -m "docs(adr-079): Phase 1 微表情迁移完成"
```

---

## 验收标准

- [ ] `npm run check` 通过
- [ ] `npm run test` 通过（无新增失败）
- [ ] `npm run build` 通过
- [ ] 微表情在 neutral 时不写入任何 morph
- [ ] 微表情在 happy/sad/surprised/angry 时周期性脉冲对应 morph
- [ ] 旧存档加载后 `emotion` 默认 `neutral`，`microExpressionEnabled` 默认 `true`
- [ ] UI 可切换微表情开关与情绪
- [ ] `proc-motion-lifelike.ts` 不再生成 emotion morph VMD
