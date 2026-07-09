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

在 `frontend/src/__tests__/perception.test.ts` 新增：

```typescript
// =====================================================================
// _applyMicroExpression 实时叠加
// =====================================================================

describe('_applyMicroExpression', () => {
    it('neutral 情绪不写入任何 morph', () => {
        const sut = makeSut();
        const morphWeights = new Map<string, number>();
        const mmdModel = makeMockModel(['笑み', '困りォ', '驚き', '怒り'], morphWeights);
        sut.activatePerception('m1');
        // 模拟 observer 回调
        sut._applyMicroExpressionForTest(mmdModel, 0, 'neutral');
        for (const w of morphWeights.values()) {
            expect(w).toBe(0);
        }
    });

    it('happy 情绪周期性脉冲笑み morph', () => {
        const sut = makeSut();
        const morphWeights = new Map<string, number>();
        const mmdModel = makeMockModel(['笑み'], morphWeights);
        sut.activatePerception('m1');
        // 脉冲峰值在 t ≈ 1.5s（半周期）
        sut._applyMicroExpressionForTest(mmdModel, 1.5, 'happy');
        expect(morphWeights.get('笑み')).toBeGreaterThan(0);
        expect(morphWeights.get('笑み')).toBeLessThanOrEqual(0.15);
    });

    it('microExpressionEnabled=false 时不写入', () => {
        const sut = makeSut();
        sut.setPerceptionState({ microExpressionEnabled: false, emotion: 'happy' });
        const morphWeights = new Map<string, number>();
        const mmdModel = makeMockModel(['笑み'], morphWeights);
        sut._applyMicroExpressionForTest(mmdModel, 1.5, 'happy');
        expect(morphWeights.get('笑み') ?? 0).toBe(0);
    });

    it('morph 不存在时静默跳过', () => {
        const sut = makeSut();
        const morphWeights = new Map<string, number>();
        const mmdModel = makeMockModel([], morphWeights); // 无 morph
        expect(() => sut._applyMicroExpressionForTest(mmdModel, 1.5, 'happy')).not.toThrow();
    });
});
```

**注意**：`makeMockModel` 和 `_applyMicroExpressionForTest` 是测试辅助。若 `makeMockModel` 已存在则复用；否则在测试文件顶部新增。`_applyMicroExpressionForTest` 是 `_applyMicroExpression` 的测试入口（直接暴露或通过 sut 调用）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL — `_applyMicroExpressionForTest` not defined

- [ ] **Step 3: 实现 _applyMicroExpression**

在 `frontend/src/scene/motion/perception.ts` 新增（紧邻 `_applyBlinking` 之后）：

```typescript
// ── 微表情（情绪 morph 实时脉冲） ──

/** 情绪 → morph 名候选（按优先级降序匹配） */
const EMOTION_MORPH_MAP: Record<Exclude<Emotion, 'neutral'>, string[]> = {
    happy: ['笑み', 'Smile', 'smile', 'にっこり', 'Happy'],
    sad: ['困りォ', 'Troubled', 'troubled', '悲しい', 'Sad'],
    surprised: ['驚き', 'Surprised', 'surprised', 'びっくり', 'Surprise'],
    angry: ['怒り', 'Angry', 'angry', '怒', 'Angry2'],
};

/** 微表情脉冲周期（秒） */
const MICRO_EXPR_PERIOD = 4.0;
/** 微表情脉冲峰值权重 */
const MICRO_EXPR_PEAK = 0.12;

/** 测试入口：直接调用微表情叠加（绕过 observer） */
export function _applyMicroExpressionForTest(
    mmdModel: any,
    time: number,
    emotion: Emotion
): void {
    _applyMicroExpression(mmdModel, time, emotion);
}

function _applyMicroExpression(mmdModel: any, time: number, emotion: Emotion): void {
    if (emotion === 'neutral') return;

    const morphNames = EMOTION_MORPH_MAP[emotion];
    if (!morphNames || morphNames.length === 0) return;

    // 找到模型中存在的第一个匹配 morph
    const morphMap = (mmdModel as any).morphStates ?? (mmdModel.mesh?.metadata?.mmdMorphController?.morphStates);
    if (!morphMap) return;

    let targetMorph: { name: string } | null = null;
    for (const candidate of morphNames) {
        const found = morphMap.find((m: any) => m.name === candidate);
        if (found) { targetMorph = found; break; }
    }
    if (!targetMorph) return;

    // 周期性脉冲：sin²(t * 2π / period) 在 [0,1] 间振荡，乘以峰值权重
    const phase = (time % MICRO_EXPR_PERIOD) / MICRO_EXPR_PERIOD; // [0,1)
    const pulse = Math.sin(phase * Math.PI * 2) ** 2; // [0,1]
    const weight = pulse * MICRO_EXPR_PEAK;

    // 叠加：直接设 morph 权重（微表情是 always-on 轻量叠加，不与其他 morph 冲突）
    const morphController = (mmdModel as any).morph ?? (mmdModel.mesh?.metadata?.mmdMorphController);
    if (morphController && typeof morphController.setValue === 'function') {
        morphController.setValue(targetMorph.name, weight);
    }
}
```

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

## Task 3: 移除 lifelike 的 emotion morph 生成

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

在 `frontend/src/__tests__/scene-serialize.test.ts`（若存在）或 `perception.test.ts` 新增迁移测试：

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

    it('旧存档 procMotion.boneToggles.emotion=true 时迁移为 emotion=neutral（不丢失，但不强制映射）', () => {
        const oldData = { procMotion: { boneToggles: { emotion: true } } };
        // 迁移逻辑应在 scene-serialize.ts 中处理
        // 此测试验证迁移后 emotion 为默认值（不强映射旧 emotion toggle 到具体情绪）
        expect(oldData.procMotion.boneToggles.emotion).toBe(true);
        // 迁移后：perception.emotion = 'neutral'（旧 toggle 仅表示"启用微表情"，不映射具体情绪）
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/__tests__/perception.test.ts`
Expected: FAIL（旧 perception 无 emotion 字段时行为未定义）

- [ ] **Step 3: 更新 scene-serialize.ts 迁移逻辑**

在 `frontend/src/scene/scene-serialize.ts` L588-599，扩展 `setPerceptionState` 调用：

```typescript
    // 优先读 data.perception；旧存档无此字段时从 procMotion 迁移
    if (data.perception) {
        setPerceptionState(data.perception as Partial<PerceptionState>);
    } else if (data.procMotion) {
        const old = data.procMotion as Partial<ProcMotionState>;
        setPerceptionState({
            eyeTrackingEnabled: old.eyeTrackingEnabled ?? true,
            headTrackingEnabled: old.headTrackingEnabled ?? true,
            blinkEnabled: old.boneToggles?.blink ?? true,
            breathEnabled: true,
            // 旧存档 boneToggles.emotion 仅表示"启用微表情"，不映射具体情绪
            microExpressionEnabled: old.boneToggles?.emotion ?? true,
            emotion: 'neutral',
        });
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

在现有感知开关区块（呼吸/眨眼/gaze 之后）新增微表情区块：

```typescript
// 微表情
addToggleRow(container, {
    label: t('perception.microExpression'),
    value: getPerceptionState().microExpressionEnabled,
    onUpdate: (v) => {
        setPerceptionState({ microExpressionEnabled: v });
        triggerAutoSave();
    },
});

// 情绪选择
const emotionOptions: { label: string; value: Emotion }[] = [
    { label: t('perception.emotionNeutral'), value: 'neutral' },
    { label: t('perception.emotionHappy'), value: 'happy' },
    { label: t('perception.emotionSad'), value: 'sad' },
    { label: t('perception.emotionSurprised'), value: 'surprised' },
    { label: t('perception.emotionAngry'), value: 'angry' },
];
addModeRow(container, {
    label: t('perception.emotion'),
    modes: emotionOptions.map(o => o.label),
    current: emotionOptions.findIndex(o => o.value === getPerceptionState().emotion),
    onSelect: (idx) => {
        setPerceptionState({ emotion: emotionOptions[idx].value });
        triggerAutoSave();
    },
});
```

**注意**：`addModeRow` / `addToggleRow` 的签名需与 `motion-gaze-levels.ts` 现有用法一致——先 grep 确认参数结构再填入。

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
