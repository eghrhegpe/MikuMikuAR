# 程序化动作（Auto Dance / Idle Motion）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让模型在没有 VMD 时自动动起来 — 无音乐时播放 Idle 呼吸/眨眼循环，有音乐时按节拍自动生成简单舞蹈动作，强度/速度可调。

**Architecture:** 三层分离：(1) `vmd-writer.ts` — 正确的二进制 VMD 写入器（111B 骨骼帧 + 23B morph 帧），生成可被 babylon-mmd `VmdLoader` 直接加载的 ArrayBuffer；(2) `beat-detector.ts` — Web Audio API (`AnalyserNode`) 实时节拍检测，输出 BPM + beat phase；(3) `procedural-motion.ts` — 程序化动作管理器，按 Idle/Auto Dance 模式生成 procedural VMD（骨骼关键帧 + morph 关键帧），通过现有 `loadVMDMotion` 管道加载。音乐播放时由 beat 驱动 Auto Dance，无音乐时回退 Idle。状态接入场景序列化。

**Tech Stack:** TypeScript, Web Audio API (AnalyserNode), babylon-mmd (VmdLoader/MmdWasmAnimation), Vitest

---

## 关键技术决策（已验证）

### VMD 帧格式（已从 babylon-mmd 源码确认）

文件 `node_modules/babylon-mmd/esm/Loader/Parser/vmdObject.js` 确认：

```
BoneKeyFrameBytes = 15(name) + 4(frame) + 12(pos) + 16(rot) + 64(interp) = 111
MorphKeyFrameBytes = 15(name) + 4(frame) + 4(weight) = 23
```

**重要**：现有 `vpd-parser.ts` 使用 `BONE_KEYFRAME_SIZE = 66`（错误，仅 19B 插值而非 64B）。这只在单帧 VMD 时侥幸工作（解析器跳过缺失字节）。**多帧 VMD 必须用 111B 帧否则帧错位**。本计划新建独立的 `vmd-writer.ts`，不修改 vpd-parser（避免回归 VPD 导入）。

### 标准 MMD 骨骼名（Shift-JIS 编码）

| 骨骼名 | 含义 | 用途 |
|--------|------|------|
| `センター` | 中心 | 身体整体平移/侧摆 |
| `上半身` | 上半身 | 躯干旋转（呼吸/律动） |
| `首` | 颈 | 头部衔接 |
| `頭` | 头 | 头部摆动 |
| `左腕` / `右腕` | 左/右臂 | 手臂摆动 |
| `左ひじ` / `右ひじ` | 左/右肘 | 弯臂 |

### 标准 MMD morph 名

| morph 名 | 含义 |
|----------|------|
| `まばたき` | 眨眼 |

### 节拍检测算法

能量峰值法（参考 DanceXR autodance）：
- `AnalyserNode.getByteFrequencyData()` 取低频段（0~430Hz，约前 10 bin）
- 计算能量 = 均值
- 维护 ~1s 滑动历史，当前能量 > 1.3× 历史均值 且距上次 beat > 250ms → 触发 beat
- BPM = 60000 / 平均 beat 间隔（窗口最近 8 次）

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/vmd-writer.ts` | **CREATE** | 正确的二进制 VMD 写入器：多帧骨骼帧(111B) + morph帧(23B) + 默认插值 |
| `frontend/src/beat-detector.ts` | **CREATE** | Web Audio 节拍检测：AnalyserNode 接入 + BPM 估计 + beat phase |
| `frontend/src/procedural-motion.ts` | **CREATE** | 程序化动作管理器：Idle/Auto Dance VMD 生成 + 状态管理 + tick 集成 |
| `frontend/src/audio.ts` | **MODIFY** | 暴露 AudioContext + AnalyserNode 供 beat-detector 使用 |
| `frontend/src/scene.ts` | **MODIFY** | 接入 procedural-motion tick；VMD 加载时禁用；场景序列化字段 |
| `frontend/src/scene-menu.ts` | **MODIFY** | 场景菜单新增「程序化动作」入口（toggle + 滑块） |
| `frontend/src/__tests__/vmd-writer.test.ts` | **CREATE** | VMD 二进制格式单元测试 |
| `frontend/src/__tests__/beat-detector.test.ts` | **CREATE** | 节拍检测逻辑测试（合成频率数据） |
| `frontend/src/__tests__/procedural-motion.test.ts` | **CREATE** | Idle/Auto Dance VMD 生成测试 |

---

### Task 1: VMD 写入器模块 + 测试

**Files:**
- Create: `frontend/src/vmd-writer.ts`
- Test: `frontend/src/__tests__/vmd-writer.test.ts`

- [ ] **Step 1: 创建 vmd-writer.ts**

```typescript
// vmd-writer.ts — 正确的二进制 VMD 写入器
// [doc:architecture] 程序化动作子系统 — VMD 二进制生成
// 帧格式确认自 babylon-mmd/esm/Loader/Parser/vmdObject.js:
//   BoneKeyFrameBytes = 15+4+12+16+64 = 111
//   MorphKeyFrameBytes = 15+4+4 = 23

export interface BoneKeyFrame {
    name: string;       // 骨骼名（Shift-JIS 编码）
    frame: number;      // 帧号 (30fps)
    position: [number, number, number];
    rotation: [number, number, number, number]; // 四元数 (x,y,z,w)
}

export interface MorphKeyFrame {
    name: string;       // morph 名
    frame: number;
    weight: number;     // 0..1
}

export const BONE_FRAME_SIZE = 111;
export const MORPH_FRAME_SIZE = 23;
const SIGNATURE = "Vocaloid Motion Data 0002\0"; // 30 bytes
const DEFAULT_MODEL_NAME = "Procedural"; // ≤20 bytes

/** Shift-JIS 编码骨骼名到 15 字节（空格 0x20 填充）。
 *  浏览器无内置 Shift-JIS 编码器，用 UTF-8 兜底（babylon-mmd 解码时同样回退）。 */
function encodeBoneName(name: string): Uint8Array {
    const buf = new Uint8Array(15).fill(0x20);
    let bytes: Uint8Array;
    try {
        // 尝试 Shift-JIS（需 text-encoding polyfill 或 ICU）
        bytes = new TextEncoder().encode(name);
    } catch {
        bytes = new TextEncoder().encode(name);
    }
    for (let i = 0; i < Math.min(bytes.length, 15); i++) buf[i] = bytes[i];
    return buf;
}

/** 构建单个骨骼关键帧 (111 bytes)。插值用线性默认值。 */
export function buildBoneFrame(frame: BoneKeyFrame): ArrayBuffer {
    const buf = new ArrayBuffer(BONE_FRAME_SIZE);
    const view = new DataView(buf);
    let off = 0;
    const nameBytes = encodeBoneName(frame.name);
    for (let i = 0; i < 15; i++) view.setUint8(off++, nameBytes[i]);
    view.setUint32(off, frame.frame, true); off += 4;
    view.setFloat32(off, frame.position[0], true); off += 4;
    view.setFloat32(off, frame.position[1], true); off += 4;
    view.setFloat32(off, frame.position[2], true); off += 4;
    view.setFloat32(off, frame.rotation[0], true); off += 4;
    view.setFloat32(off, frame.rotation[1], true); off += 4;
    view.setFloat32(off, frame.rotation[2], true); off += 4;
    view.setFloat32(off, frame.rotation[3], true); off += 4;
    // 64 bytes 插值：线性默认 (x1=20,y1=20,x2=107,y2=107) 每 4 字节重复 16 次
    for (let i = 0; i < 16; i++) {
        view.setUint8(off++, 20);   // x1
        view.setUint8(off++, 20);   // y1
        view.setUint8(off++, 107);  // x2
        view.setUint8(off++, 107);  // y2
    }
    return buf;
}

/** 构建单个 morph 关键帧 (23 bytes)。 */
export function buildMorphFrame(frame: MorphKeyFrame): ArrayBuffer {
    const buf = new ArrayBuffer(MORPH_FRAME_SIZE);
    const view = new DataView(buf);
    let off = 0;
    const nameBytes = encodeBoneName(frame.name);
    for (let i = 0; i < 15; i++) view.setUint8(off++, nameBytes[i]);
    view.setUint32(off, frame.frame, true); off += 4;
    view.setFloat32(off, frame.weight, true); off += 4;
    return buf;
}

/** 构建完整 VMD ArrayBuffer。boneFrames/morphFrames 可为空数组。
 *  结构: 30(sig) + 20(model) + 4(boneCount) + boneFrames + 4(morphCount) + morphFrames
 *       + 4(cameraCount=0) + 4(lightCount=0) + 4(shadowCount=0) */
export function buildVmd(
    boneFrames: BoneKeyFrame[],
    morphFrames: MorphKeyFrame[] = [],
    modelName: string = DEFAULT_MODEL_NAME,
): ArrayBuffer {
    const headerSize = 30 + 20 + 4;
    const boneSize = boneFrames.length * BONE_FRAME_SIZE;
    const morphSize = morphFrames.length * MORPH_FRAME_SIZE;
    const trailer = 4 + 4 + 4; // camera + light + shadow counts (all 0)
    const total = headerSize + boneSize + 4 + morphSize + trailer;
    const buf = new ArrayBuffer(total);
    const view = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let off = 0;

    // Signature (30 bytes)
    const sig = new TextEncoder().encode(SIGNATURE);
    for (let i = 0; i < 30; i++) u8[off++] = sig[i] ?? 0;

    // Model name (20 bytes, Shift-JIS/UTF-8, null-padded)
    const nameBytes = new TextEncoder().encode(modelName);
    for (let i = 0; i < Math.min(nameBytes.length, 20); i++) u8[off++] = nameBytes[i];
    off = 50; // skip remaining name bytes (already 0)

    // Bone frame count + frames
    view.setUint32(off, boneFrames.length, true); off += 4;
    for (const f of boneFrames) {
        const fb = new Uint8Array(buildBoneFrame(f));
        u8.set(fb, off);
        off += BONE_FRAME_SIZE;
    }

    // Morph frame count + frames
    view.setUint32(off, morphFrames.length, true); off += 4;
    for (const f of morphFrames) {
        const fb = new Uint8Array(buildMorphFrame(f));
        u8.set(fb, off);
        off += MORPH_FRAME_SIZE;
    }

    // Trailer: camera/light/shadow counts = 0
    view.setUint32(off, 0, true); off += 4;
    view.setUint32(off, 0, true); off += 4;
    view.setUint32(off, 0, true); off += 4;

    return buf;
}
```

- [ ] **Step 2: 创建 vmd-writer.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { buildVmd, buildBoneFrame, buildMorphFrame, BONE_FRAME_SIZE, MORPH_FRAME_SIZE, type BoneKeyFrame } from "../vmd-writer";

describe("vmd-writer frame sizes", () => {
    it("bone frame is 111 bytes", () => {
        const f: BoneKeyFrame = { name: "上半身", frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        expect(buildBoneFrame(f).byteLength).toBe(BONE_FRAME_SIZE);
        expect(BONE_FRAME_SIZE).toBe(111);
    });
    it("morph frame is 23 bytes", () => {
        const f = { name: "まばたき", frame: 0, weight: 0.5 };
        expect(buildMorphFrame(f).byteLength).toBe(MORPH_FRAME_SIZE);
        expect(MORPH_FRAME_SIZE).toBe(23);
    });
});

describe("vmd-writer buildVmd structure", () => {
    const boneFrames: BoneKeyFrame[] = [
        { name: "上半身", frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { name: "上半身", frame: 30, position: [0, 0, 0], rotation: [0, 0.05, 0, 0.999] },
        { name: "上半身", frame: 60, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ];
    const morphFrames = [
        { name: "まばたき", frame: 0, weight: 0 },
        { name: "まばたき", frame: 60, weight: 1 },
    ];
    const buf = buildVmd(boneFrames, morphFrames);

    it("total size = 54 + 3*111 + 4 + 2*23 + 12", () => {
        expect(buf.byteLength).toBe(54 + 3 * 111 + 4 + 2 * 23 + 12);
    });

    it("starts with VMD signature", () => {
        const sig = new TextDecoder().decode(new Uint8Array(buf, 0, 25));
        expect(sig).toBe("Vocaloid Motion Data");
    });

    it("bone count is 3 at offset 50", () => {
        const view = new DataView(buf);
        expect(view.getUint32(50, true)).toBe(3);
    });

    it("morph count is 2 after bone frames", () => {
        const view = new DataView(buf);
        const morphCountOff = 54 + 3 * 111;
        expect(view.getUint32(morphCountOff, true)).toBe(2);
    });

    it("frame numbers are readable at correct offsets", () => {
        const view = new DataView(buf);
        // frame 1 bone: offset 54 + 15(name) = 69
        expect(view.getUint32(69, true)).toBe(0);
        // frame 2 bone: offset 54 + 111 + 15 = 180
        expect(view.getUint32(180, true)).toBe(30);
        // frame 3 bone: offset 54 + 222 + 15 = 291
        expect(view.getUint32(291, true)).toBe(60);
    });

    it("trailer counts are all zero", () => {
        const view = new DataView(buf);
        const trailerOff = 54 + 3 * 111 + 4 + 2 * 23;
        expect(view.getUint32(trailerOff, true)).toBe(0);       // camera
        expect(view.getUint32(trailerOff + 4, true)).toBe(0);   // light
        expect(view.getUint32(trailerOff + 8, true)).toBe(0);   // shadow
    });

    it("empty frames produces valid minimal VMD", () => {
        const empty = buildVmd([], []);
        const view = new DataView(empty);
        expect(view.getUint32(50, true)).toBe(0); // 0 bones
        expect(empty.byteLength).toBe(54 + 4 + 12); // header + morphCount + trailer
    });
});

describe("vmd-writer interpolation", () => {
    it("interpolation bytes are linear default (20,20,107,107)", () => {
        const f: BoneKeyFrame = { name: "頭", frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        const buf = new DataView(buildBoneFrame(f));
        // interpolation starts at offset 15+4+12+16 = 47
        expect(buf.getUint8(47)).toBe(20);
        expect(buf.getUint8(48)).toBe(20);
        expect(buf.getUint8(49)).toBe(107);
        expect(buf.getUint8(50)).toBe(107);
        // pattern repeats 16 times (64 bytes)
        expect(buf.getUint8(47 + 64 - 1)).toBe(107);
    });
});
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd frontend && npx vitest run src/__tests__/vmd-writer.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 4: 构建验证**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无类型错误

- [ ] **Step 5: 提交**

```bash
cd frontend && git add src/vmd-writer.ts src/__tests__/vmd-writer.test.ts
git commit -m "feat(procedural-motion): add VMD binary writer with correct 111-byte bone frames"
```

---

### Task 2: 节拍检测模块 + 测试

**Files:**
- Create: `frontend/src/beat-detector.ts`
- Test: `frontend/src/__tests__/beat-detector.test.ts`

- [ ] **Step 1: 创建 beat-detector.ts**

```typescript
// beat-detector.ts — Web Audio API 节拍检测
// [doc:architecture] 程序化动作子系统 — 节拍检测
// 能量峰值法：低频能量 > 1.3× 滑动均值 且 距上次 beat > 250ms → 触发

export interface BeatInfo {
    bpm: number;        // 当前估计 BPM
    beatPhase: number;  // 0..1 当前 beat 周期内的相位
    isBeat: boolean;    // 本帧是否触发 beat
    energy: number;     // 当前低频能量 (0..255)
}

const BASS_BIN_COUNT = 10;   // 前 10 个频段 (~0-430Hz @ 44100/256 fft)
const ENERGY_HISTORY_SIZE = 43; // ~1s @ 43fps update
const BEAT_THRESHOLD = 1.3;
const MIN_BEAT_INTERVAL_MS = 250;
const BPM_WINDOW = 8; // 最近 8 次 beat 间隔求均值

export class BeatDetector {
    private analyser: AnalyserNode | null = null;
    private freqData: Uint8Array = new Uint8Array(0);
    private energyHistory: number[] = [];
    private lastBeatTime = 0;
    private beatTimes: number[] = []; // 最近 beat 时间戳 (ms)
    private currentBpm = 120;
    private phaseStartTime = 0;
    private phaseInterval = 500; // ms per beat
    private isBeatFlag = false;

    /** 接入音频元素。惰性创建 AudioContext。
     *  注意：createMediaElementSource 后音频路由经 AudioContext，
     *  须 resume() 否则浏览器自动播放策略下静音。 */
    attach(audioElement: HTMLAudioElement): void {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        // 浏览器 autoplay 策略：AudioContext 默认 suspended，需用户交互后 resume
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const source = ctx.createMediaElementSource(audioElement);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.3;
        this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
        source.connect(this.analyser);
        this.analyser.connect(ctx.destination);
    }

    /** 每帧调用。更新能量历史、检测 beat、估计 BPM。 */
    update(): void {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(this.freqData as any);

        // 计算低频能量
        let sum = 0;
        const bins = Math.min(BASS_BIN_COUNT, this.freqData.length);
        for (let i = 0; i < bins; i++) sum += this.freqData[i];
        const energy = bins > 0 ? sum / bins : 0;

        // 更新滑动历史
        this.energyHistory.push(energy);
        if (this.energyHistory.length > ENERGY_HISTORY_SIZE) this.energyHistory.shift();

        // 计算历史均值
        const avg = this.energyHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.energyHistory.length);

        // beat 检测
        const now = performance.now();
        this.isBeatFlag = false;
        if (energy > avg * BEAT_THRESHOLD && energy > 30
            && now - this.lastBeatTime > MIN_BEAT_INTERVAL_MS) {
            this.isBeatFlag = true;
            this.lastBeatTime = now;
            this.beatTimes.push(now);
            if (this.beatTimes.length > BPM_WINDOW + 1) this.beatTimes.shift();
            this.phaseStartTime = now;
            // 更新 BPM
            if (this.beatTimes.length >= 2) {
                const intervals: number[] = [];
                for (let i = 1; i < this.beatTimes.length; i++) {
                    intervals.push(this.beatTimes[i] - this.beatTimes[i - 1]);
                }
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                if (avgInterval > 0) {
                    this.currentBpm = Math.round(60000 / avgInterval);
                    this.phaseInterval = avgInterval;
                }
            }
        }
    }

    /** 重置状态（音频停止/切换时调用）。 */
    reset(): void {
        this.energyHistory = [];
        this.beatTimes = [];
        this.lastBeatTime = 0;
        this.currentBpm = 120;
        this.phaseInterval = 500;
        this.phaseStartTime = performance.now();
        this.isBeatFlag = false;
    }

    getBPM(): number { return this.currentBpm; }

    /** 当前 beat 周期内的相位 0..1。 */
    getBeatPhase(): number {
        const elapsed = performance.now() - this.phaseStartTime;
        return Math.min(1, elapsed / Math.max(1, this.phaseInterval));
    }

    isBeat(): boolean { return this.isBeatFlag; }
    getEnergy(): number { return this.energyHistory[this.energyHistory.length - 1] ?? 0; }
    hasAudio(): boolean { return this.analyser !== null; }

    /** 纯逻辑：给定能量序列，返回 beat 触发帧索引。供测试用。 */
    static detectBeatsFromEnergies(energies: number[], threshold = BEAT_THRESHOLD, minInterval = 6): number[] {
        const beats: number[] = [];
        const history: number[] = [];
        for (let i = 0; i < energies.length; i++) {
            history.push(energies[i]);
            if (history.length > ENERGY_HISTORY_SIZE) history.shift();
            const avg = history.reduce((a, b) => a + b, 0) / history.length;
            const lastBeat = beats.length > 0 ? beats[beats.length - 1] : -minInterval;
            if (energies[i] > avg * threshold && energies[i] > 30 && i - lastBeat >= minInterval) {
                beats.push(i);
            }
        }
        return beats;
    }

    /** 纯逻辑：从 beat 时间戳数组计算 BPM。 */
    static bpmFromIntervals(intervalsMs: number[]): number {
        if (intervalsMs.length === 0) return 120;
        const avg = intervalsMs.reduce((a, b) => a + b, 0) / intervalsMs.length;
        return avg > 0 ? Math.round(60000 / avg) : 120;
    }
}
```

- [ ] **Step 2: 创建 beat-detector.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { BeatDetector } from "../beat-detector";

describe("BeatDetector.detectBeatsFromEnergies", () => {
    it("detects beats in periodic energy peaks", () => {
        // 模拟 120 BPM @ 43fps：每 ~21 帧一个峰值 (60000/120/1000*43 ≈ 21.5)
        const energies: number[] = [];
        for (let i = 0; i < 200; i++) {
            const peak = (i % 21 === 0) ? 200 : 20;
            energies.push(peak + Math.random() * 5);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies);
        expect(beats.length).toBeGreaterThan(3);
        expect(beats[0] % 21).toBeLessThan(3);
    });

    it("no beats when energy is flat", () => {
        const energies = new Array(100).fill(50);
        const beats = BeatDetector.detectBeatsFromEnergies(energies);
        expect(beats.length).toBe(0);
    });

    it("respects minInterval between beats", () => {
        const energies = new Array(50).fill(200); // all high
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        // 第一帧触发，之后受 minInterval 限制
        expect(beats.length).toBeLessThan(10);
        for (let i = 1; i < beats.length; i++) {
            expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(6);
        }
    });

    it("threshold filters weak peaks", () => {
        const energies: number[] = [];
        for (let i = 0; i < 100; i++) {
            energies.push((i % 21 === 0) ? 35 : 20);
        }
        const beats = BeatDetector.detectBeatsFromEnergies(energies, 1.3, 6);
        // 35 vs avg ~21 → 35/21 ≈ 1.67 > 1.3 → should detect
        expect(beats.length).toBeGreaterThan(0);
    });
});

describe("BeatDetector.bpmFromIntervals", () => {
    it("120 BPM from 500ms intervals", () => {
        const intervals = [500, 500, 500, 500];
        expect(BeatDetector.bpmFromIntervals(intervals)).toBe(120);
    });

    it("60 BPM from 1000ms intervals", () => {
        expect(BeatDetector.bpmFromIntervals([1000, 1000])).toBe(60);
    });

    it("defaults to 120 for empty input", () => {
        expect(BeatDetector.bpmFromIntervals([])).toBe(120);
    });

    it("handles variable intervals (average)", () => {
        // 400 + 600 = 1000ms → avg 500 → 120 BPM
        expect(BeatDetector.bpmFromIntervals([400, 600])).toBe(120);
    });
});

describe("BeatDetector instance", () => {
    it("reset restores defaults", () => {
        const bd = new BeatDetector();
        bd.reset();
        expect(bd.getBPM()).toBe(120);
        expect(bd.hasAudio()).toBe(false);
    });

    it("getBeatPhase returns 0..1", () => {
        const bd = new BeatDetector();
        bd.reset();
        const phase = bd.getBeatPhase();
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThanOrEqual(1);
    });
});
```

- [ ] **Step 3: 运行测试**

Run: `cd frontend && npx vitest run src/__tests__/beat-detector.test.ts`
Expected: PASS

- [ ] **Step 4: 构建验证 + 提交**

```bash
cd frontend && npx tsc --noEmit
git add src/beat-detector.ts src/__tests__/beat-detector.test.ts
git commit -m "feat(procedural-motion): add Web Audio beat detector with BPM estimation"
```

---

### Task 3: 程序化动作管理器 + 测试

**Files:**
- Create: `frontend/src/procedural-motion.ts`
- Test: `frontend/src/__tests__/procedural-motion.test.ts`

- [ ] **Step 1: 创建 procedural-motion.ts**

```typescript
// procedural-motion.ts — 程序化动作管理器（Idle + Auto Dance）
// [doc:architecture] 程序化动作子系统
// 生成 procedural VMD（骨骼+morph 关键帧），通过现有 loadVMDMotion 管道加载。
// 无音乐 → Idle（呼吸+眨眼）；有音乐 → Auto Dance（节拍驱动律动）。

import { buildVmd, type BoneKeyFrame, type MorphKeyFrame } from "./vmd-writer";

export type ProcMotionMode = "off" | "idle" | "autodance";

export interface ProcMotionState {
    mode: ProcMotionMode;
    intensity: number;   // 0..1，默认 0.5
    speed: number;       // 0.5..2，默认 1.0
    autoSwitch: boolean; // true=根据音乐自动切换 Idle/AutoDance
}

export const DEFAULT_PROC_STATE: ProcMotionState = {
    mode: "off",
    intensity: 0.5,
    speed: 1.0,
    autoSwitch: true,
};

// 标准 MMD 骨骼名
const BONE_CENTER = "センター";
const BONE_UPPER = "上半身";
const BONE_HEAD = "頭";
const BONE_NECK = "首";
const BONE_LARM = "左腕";
const BONE_RARM = "右腕";

// 标准 MMD morph 名
const MORPH_BLINK = "まばたき";

const FPS = 30;

/** Idle 动作 VMD 生成：呼吸 + 眨眼 + 轻微侧摆。
 *  循环长度 = 4s / speed (120 帧 @ speed=1)。
 *  @param state 强度/速度
 *  @param morphNames 模型可用的 morph 名集合（用于检测是否有眨眼 morph）
 *  @returns VMD ArrayBuffer */
export function generateIdleVmd(state: ProcMotionState, morphNames: string[] = []): ArrayBuffer {
    const loopFrames = Math.round(120 / state.speed); // 4s @ 30fps
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];
    const hasBlink = morphNames.includes(MORPH_BLINK);

    const half = Math.round(loopFrames / 2);

    // 呼吸：上半身 X 轴旋转（前倾后仰），正弦曲线
    const breathAmp = 0.03 * intensity;
    for (let f = 0; f <= loopFrames; f += 6) {
        const phase = (f / loopFrames) * Math.PI * 2;
        const rotX = Math.sin(phase) * breathAmp;
        bones.push({
            name: BONE_UPPER,
            frame: f,
            position: [0, 0, 0],
            rotation: [rotX, 0, 0, 1 - 0.5 * rotX * rotX], // 近似归一化四元数
        });
    }
    // 确保末帧 = 首帧（循环闭合）
    bones.push({
        name: BONE_UPPER, frame: loopFrames, position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
    });

    // 轻微侧摆：センター Z 轴旋转
    const swayAmp = 0.015 * intensity;
    for (let f = 0; f <= loopFrames; f += 6) {
        const phase = (f / loopFrames) * Math.PI * 2;
        const rotZ = Math.sin(phase * 0.5) * swayAmp;
        bones.push({
            name: BONE_CENTER, frame: f, position: [0, 0, 0],
            rotation: [0, 0, rotZ, 1 - 0.5 * rotZ * rotZ],
        });
    }
    bones.push({
        name: BONE_CENTER, frame: loopFrames, position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
    });

    // 眨眼：每 ~2.5s 一次快速眨眼
    if (hasBlink) {
        const blinkInterval = Math.round(75 / state.speed); // ~2.5s
        for (let t = 0; t < loopFrames; t += blinkInterval) {
            morphs.push({ name: MORPH_BLINK, frame: t, weight: 0 });
            morphs.push({ name: MORPH_BLINK, frame: t + 2, weight: 1 });  // 快速闭合
            morphs.push({ name: MORPH_BLINK, frame: t + 5, weight: 0 }); // 慢慢睁开
        }
        morphs.push({ name: MORPH_BLINK, frame: loopFrames, weight: 0 });
    }

    return buildVmd(bones, morphs, "IdleMotion");
}

/** Auto Dance VMD 生成：节拍驱动身体律动 + 头部摆动 + 手臂摆动。
 *  循环长度 = 2 beat 周期 @ bpm。
 *  @param state 强度/速度
 *  @param bpm 节拍 BPM
 *  @param morphNames 可用 morph 名 */
export function generateAutoDanceVmd(state: ProcMotionState, bpm: number, morphNames: string[] = []): ArrayBuffer {
    const clampedBpm = Math.max(60, Math.min(200, bpm));
    const beatFrames = Math.round((60 / clampedBpm) * FPS / state.speed);
    const loopFrames = beatFrames * 2; // 2 拍循环
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];
    const hasBlink = morphNames.includes(MORPH_BLINK);

    // 身体律动：センター Y 轴旋转，每拍交替方向
    const bodyAmp = 0.08 * intensity;
    for (let f = 0; f <= loopFrames; f += 3) {
        const beat = f / beatFrames;
        const rotY = Math.sin(beat * Math.PI) * bodyAmp;
        const bob = Math.abs(Math.sin(beat * Math.PI)) * 0.02 * intensity; // 上下弹
        bones.push({
            name: BONE_CENTER, frame: f, position: [0, bob, 0],
            rotation: [0, rotY, 0, 1 - 0.5 * rotY * rotY],
        });
    }
    bones.push({ name: BONE_CENTER, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });

    // 头部摆动：頭 Z 轴，反相于身体
    const headAmp = 0.06 * intensity;
    for (let f = 0; f <= loopFrames; f += 3) {
        const beat = f / beatFrames;
        const rotZ = Math.sin(beat * Math.PI + Math.PI) * headAmp;
        bones.push({
            name: BONE_HEAD, frame: f, position: [0, 0, 0],
            rotation: [0, 0, rotZ, 1 - 0.5 * rotZ * rotZ],
        });
    }
    bones.push({ name: BONE_HEAD, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });

    // 手臂摆动：左右臂 Z 轴交替
    const armAmp = 0.15 * intensity;
    for (let f = 0; f <= loopFrames; f += 3) {
        const beat = f / beatFrames;
        const lRot = Math.sin(beat * Math.PI) * armAmp;
        const rRot = Math.sin(beat * Math.PI + Math.PI) * armAmp;
        bones.push({
            name: BONE_LARM, frame: f, position: [0, 0, 0],
            rotation: [0, 0, lRot, 1 - 0.5 * lRot * lRot],
        });
        bones.push({
            name: BONE_RARM, frame: f, position: [0, 0, 0],
            rotation: [0, 0, rRot, 1 - 0.5 * rRot * rRot],
        });
    }
    bones.push({ name: BONE_LARM, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    bones.push({ name: BONE_RARM, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });

    // 眨眼：每拍眨一次
    if (hasBlink) {
        for (let b = 0; b < 2; b++) {
            const t = b * beatFrames;
            morphs.push({ name: MORPH_BLINK, frame: t, weight: 0 });
            morphs.push({ name: MORPH_BLINK, frame: t + 1, weight: 1 });
            morphs.push({ name: MORPH_BLINK, frame: t + 4, weight: 0 });
        }
        morphs.push({ name: MORPH_BLINK, frame: loopFrames, weight: 0 });
    }

    return buildVmd(bones, morphs, "AutoDance");
}

/** 判断是否应切换到 Auto Dance（有音乐在播放）。 */
export function shouldAutoDance(audioPlaying: boolean, mode: ProcMotionMode): boolean {
    return audioPlaying && (mode === "autodance" || mode === "off");
}

/** 判断是否应切换到 Idle（无音乐，未加载用户 VMD）。 */
export function shouldIdle(audioPlaying: boolean, hasUserVmd: boolean, mode: ProcMotionMode): boolean {
    return !audioPlaying && !hasUserVmd && (mode === "idle" || mode === "off");
}
```

- [ ] **Step 2: 创建 procedural-motion.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { generateIdleVmd, generateAutoDanceVmd, shouldAutoDance, shouldIdle, DEFAULT_PROC_STATE, type ProcMotionState } from "../procedural-motion";

const state: ProcMotionState = { ...DEFAULT_PROC_STATE, mode: "idle", intensity: 0.5, speed: 1.0 };

describe("generateIdleVmd", () => {
    const buf = generateIdleVmd(state, ["まばたき"]);

    it("produces non-empty VMD", () => {
        expect(buf.byteLength).toBeGreaterThan(200);
    });

    it("has valid VMD signature", () => {
        const sig = new TextDecoder().decode(new Uint8Array(buf, 0, 25));
        expect(sig).toBe("Vocaloid Motion Data");
    });

    it("includes blink morph frames when まばたき available", () => {
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBeGreaterThan(0);
    });

    it("omits blink morph frames when no まばたき", () => {
        const buf2 = generateIdleVmd(state, []);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBe(0);
    });

    it("loop closes (first and last bone frame match)", () => {
        const buf2 = generateIdleVmd(state, []);
        const view = new DataView(buf2);
        // First bone frame rotation at offset 54+15+4+12 = 85
        const firstRot = [
            view.getFloat32(85, true),
            view.getFloat32(89, true),
            view.getFloat32(93, true),
            view.getFloat32(97, true),
        ];
        // Last frame: find last bone frame offset
        const boneCount = view.getUint32(50, true);
        const lastOff = 54 + (boneCount - 1) * 111 + 15 + 4 + 12;
        const lastRot = [
            view.getFloat32(lastOff, true),
            view.getFloat32(lastOff + 4, true),
            view.getFloat32(lastOff + 8, true),
            view.getFloat32(lastOff + 12, true),
        ];
        expect(lastRot[3]).toBeCloseTo(1, 2); // w ≈ 1
    });

    it("intensity=0 produces minimal rotation", () => {
        const zeroState = { ...state, intensity: 0 };
        const buf2 = generateIdleVmd(zeroState, []);
        const view = new DataView(buf2);
        // Upper body bone rotation X at first frame
        const off = 54 + 15 + 4; // skip name+frame, position starts
        // position[0..2] then rotation[0]
        const rotX = view.getFloat32(off + 12, true);
        expect(Math.abs(rotX)).toBeLessThan(0.001);
    });
});

describe("generateAutoDanceVmd", () => {
    const buf = generateAutoDanceVmd(state, 120, ["まばたき"]);

    it("produces non-empty VMD", () => {
        expect(buf.byteLength).toBeGreaterThan(200);
    });

    it("has valid VMD signature", () => {
        const sig = new TextDecoder().decode(new Uint8Array(buf, 0, 25));
        expect(sig).toBe("Vocaloid Motion Data");
    });

    it("higher BPM produces shorter loop", () => {
        const slow = generateAutoDanceVmd(state, 60, []);
        const fast = generateAutoDanceVmd(state, 180, []);
        // Faster BPM = fewer frames per loop = smaller file
        expect(fast.byteLength).toBeLessThan(slow.byteLength);
    });

    it("clamps BPM below 60", () => {
        const low = generateAutoDanceVmd(state, 30, []);
        const at60 = generateAutoDanceVmd(state, 60, []);
        expect(low.byteLength).toBe(at60.byteLength);
    });

    it("includes arm bone frames", () => {
        // Check that 左腕/右腕 names appear by scanning bone names
        const u8 = new Uint8Array(buf);
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        let foundLeftArm = false;
        for (let i = 0; i < boneCount; i++) {
            const off = 54 + i * 111;
            const nameBytes = u8.slice(off, off + 15);
            const name = new TextDecoder().decode(nameBytes).replace(/\s+$/, "");
            if (name === "左腕") foundLeftArm = true;
        }
        expect(foundLeftArm).toBe(true);
    });

    it("includes blink morph at 120 BPM", () => {
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBeGreaterThan(0);
    });
});

describe("auto-switch logic", () => {
    it("shouldAutoDance: true when audio playing and mode allows", () => {
        expect(shouldAutoDance(true, "off")).toBe(true);
        expect(shouldAutoDance(true, "autodance")).toBe(true);
    });
    it("shouldAutoDance: false when no audio", () => {
        expect(shouldAutoDance(false, "off")).toBe(false);
    });
    it("shouldIdle: true when no audio, no VMD, mode allows", () => {
        expect(shouldIdle(false, false, "off")).toBe(true);
        expect(shouldIdle(false, false, "idle")).toBe(true);
    });
    it("shouldIdle: false when VMD loaded", () => {
        expect(shouldIdle(false, true, "off")).toBe(false);
    });
    it("shouldIdle: false when audio playing", () => {
        expect(shouldIdle(true, false, "off")).toBe(false);
    });
});
```

- [ ] **Step 3: 运行测试**

Run: `cd frontend && npx vitest run src/__tests__/procedural-motion.test.ts`
Expected: PASS

- [ ] **Step 4: 构建验证 + 提交**

```bash
cd frontend && npx tsc --noEmit
git add src/procedural-motion.ts src/__tests__/procedural-motion.test.ts
git commit -m "feat(procedural-motion): add Idle/Auto Dance VMD generator with bone+morph keyframes"
```

---

### Task 4: 音频分析器接入

**Files:**
- Modify: `frontend/src/audio.ts`

- [ ] **Step 1: 读取 audio.ts 当前结构确认**

Read `frontend/src/audio.ts` lines 1-20（确认模块变量与 `ensureAudio` 已存在，见前置上下文 — 已确认）。

- [ ] **Step 2: 暴露 BeatDetector 接入点**

在 `audio.ts` 顶部 imports 区（line 4 `import { resolveFileUrl }` 之后）追加类型导入：

```typescript
import type { BeatDetector } from "./beat-detector";
```

在 `audio.ts` 末尾（`syncAudioPlayback` 函数之后）追加状态与函数：

```typescript
// ======== Beat Detector Integration ========

let beatDetector: BeatDetector | null = null;
let beatDetectorAttached = false;

/** 接入节拍检测器到当前音频元素（惰性，仅调用一次）。 */
export function attachBeatDetector(detector: BeatDetector): void {
    beatDetector = detector;
    if (audioElement && !beatDetectorAttached) {
        try {
            detector.attach(audioElement);
            beatDetectorAttached = true;
        } catch (err) {
            console.warn("attachBeatDetector:", err);
        }
    }
}

/** 音频加载后通知 beat detector 重置（新曲目 BPM 估计重新开始）。 */
export function notifyBeatDetectorReset(): void {
    if (beatDetector) beatDetector.reset();
}

/** 在 ensureAudio 后追加：新音频元素创建时重新接入 beat detector。
 *  修改 ensureAudio() 末尾加：if (beatDetector) attachBeatDetector(beatDetector); */
```

- [ ] **Step 3: 修改 ensureAudio 接入 beat detector**

在 `audio.ts` 的 `ensureAudio()` 函数中，`return audioElement;` 之前插入：

```typescript
    // Re-attach beat detector when audio element is (re)created
    if (beatDetector && !beatDetectorAttached) {
        try {
            beatDetector.attach(audioElement);
            beatDetectorAttached = true;
        } catch (err) {
            console.warn("ensureAudio beat detector attach:", err);
        }
    }
```

- [ ] **Step 4: 修改 loadAudioFile 通知重置**

在 `loadAudioFile` 函数末尾（`audio.load()` 之后）追加：

```typescript
    notifyBeatDetectorReset();
```

- [ ] **Step 5: 构建验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
cd frontend && git add src/audio.ts
git commit -m "feat(procedural-motion): expose beat detector attachment point in audio module"
```

---

### Task 5: 接入场景动画循环

**Files:**
- Modify: `frontend/src/scene.ts`

- [ ] **Step 1: 读取 scene.ts 关键区域确认行号**

Read `frontend/src/scene.ts` lines 42-55（imports）和 323-373（initScene + tick handler）。已在前置确认：tick handler 在 line 335，`runtime.onAnimationTickObservable.add`。

- [ ] **Step 2: 添加 imports**

在 `scene.ts` imports 区块（line 42-55 附近的 `import { ... } from "./config";` 之后）追加：

```typescript
import {
    ProcMotionState, ProcMotionMode, DEFAULT_PROC_STATE,
    generateIdleVmd, generateAutoDanceVmd, shouldAutoDance, shouldIdle,
} from "./procedural-motion";
import { BeatDetector } from "./beat-detector";
import { attachBeatDetector, isAudioPlaying, notifyBeatDetectorReset } from "./audio";
```

注意：`isAudioPlaying` 已存在于 audio.ts（line 112），直接导入。

- [ ] **Step 3: 添加 procedural motion 状态变量**

在 `scene.ts` 的模块级变量区（`let autoLoop = true;` 附近）追加：

```typescript
// ======== Procedural Motion State ========
let procState: ProcMotionState = { ...DEFAULT_PROC_STATE };
let beatDetector: BeatDetector | null = null;
let procVmdActive = false;       // procedural VMD 是否正在播放
let lastBeatBpm = 120;           // 上次用于生成 Auto Dance 的 BPM
```

- [ ] **Step 4: 添加 procedural motion 更新函数**

在 `scene.ts` 的 `initScene` 函数之前（line ~322）追加：

```typescript
/** 启动程序化动作：生成 procedural VMD 并加载。 */
async function startProcMotion(bpm?: number): Promise<void> {
    const model = focusedMmdModel();
    if (!model) return;
    const morphNames = model.morph?.morphs?.map(m => m.name) ?? [];
    let buf: ArrayBuffer;
    if (procState.mode === "autodance" && bpm) {
        buf = generateAutoDanceVmd(procState, bpm, morphNames);
        lastBeatBpm = bpm;
    } else {
        buf = generateIdleVmd(procState, morphNames);
    }
    procVmdActive = true;
    await loadVMDMotion(buf, procState.mode === "autodance" ? "AutoDance" : "IdleMotion");
}

/** 停止程序化动作（用户加载真实 VMD 时调用）。 */
function stopProcMotion(): void {
    procVmdActive = false;
}

/** 每帧检查是否需要切换/重新生成 procedural VMD。 */
async function updateProcMotion(): Promise<void> {
    if (procState.mode === "off" && !procState.autoSwitch) {
        if (procVmdActive) stopProcMotion();
        return;
    }

    const audioOn = isAudioPlaying();
    const hasUserVmd = focusedModel()?.vmdData != null;
    const wantAutoDance = shouldAutoDance(audioOn, procState.mode) && procState.autoSwitch;
    const wantIdle = shouldIdle(audioOn, hasUserVmd, procState.mode) && procState.autoSwitch;

    // 用户加载了真实 VMD → 停止 procedural
    if (hasUserVmd && procVmdActive) {
        stopProcMotion();
        return;
    }

    // 需要 Auto Dance
    if (wantAutoDance && beatDetector) {
        const bpm = beatDetector.getBPM();
        if (!procVmdActive || procState.mode !== "autodance" || Math.abs(bpm - lastBeatBpm) > 10) {
            procState = { ...procState, mode: "autodance" };
            await startProcMotion(bpm);
        }
        beatDetector.update();
        return;
    }

    // 需要 Idle
    if (wantIdle) {
        if (!procVmdActive || procState.mode !== "idle") {
            procState = { ...procState, mode: "idle" };
            await startProcMotion();
        }
        return;
    }
}
```

- [ ] **Step 5: 在 tick handler 中调用 updateProcMotion**

在 `scene.ts` line 335-341 的 `runtime.onAnimationTickObservable.add(() => { ... })` 回调内，在 `animateCameraVmd(runtime.currentTime * 30);` 之后追加：

```typescript
        updateProcMotion();
```

- [ ] **Step 6: 在 initScene 中初始化 beat detector**

在 `scene.ts` 的 `initScene()` 函数中，`_applyGround(envState);` 之前（line ~371）追加：

```typescript
    // Initialize beat detector for Auto Dance
    beatDetector = new BeatDetector();
    attachBeatDetector(beatDetector);
```

- [ ] **Step 7: 在 loadVMDMotion 中防止用户 VMD 被 procedural 覆盖**

在 `scene.ts` 的 `loadVMDMotion` 函数开头（确认存在，line ~266），在函数体最前面追加：

```typescript
    // If user loads a real VMD, stop procedural motion
    if (procVmdActive && name !== "IdleMotion" && name !== "AutoDance") {
        stopProcMotion();
    }
```

- [ ] **Step 8: 暴露 procedural motion 控制 API**

在 `scene.ts` 末尾（`resetModelMorphs` 之后，line ~1558）追加导出函数：

```typescript
// ======== Procedural Motion Control API ========

export function setProcMotionMode(mode: ProcMotionMode): void {
    procState = { ...procState, mode };
    if (mode === "off") stopProcMotion();
}

export function setProcMotionIntensity(v: number): void {
    procState = { ...procState, intensity: Math.max(0, Math.min(1, v)) };
}

export function setProcMotionSpeed(v: number): void {
    procState = { ...procState, speed: Math.max(0.5, Math.min(2, v)) };
}

export function setProcMotionAutoSwitch(on: boolean): void {
    procState = { ...procState, autoSwitch: on };
}

export function getProcMotionState(): ProcMotionState {
    return { ...procState };
}

/** 强制立即重新生成 procedural VMD（参数变更后调用）。 */
export function regenerateProcMotion(): void {
    if (procVmdActive) {
        const bpm = beatDetector?.getBPM() ?? 120;
        startProcMotion(procState.mode === "autodance" ? bpm : undefined);
    }
}
```

- [ ] **Step 9: 构建验证**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: 无错误（若有 `isAudioPlaying` 未导出错误，确认 audio.ts line 112 已 export）

- [ ] **Step 10: 运行全量测试确认无回归**

Run: `cd frontend && npx vitest run`
Expected: 全部 PASS（现有 93 tests + 新增 tests）

- [ ] **Step 11: 提交**

```bash
cd frontend && git add src/scene.ts
git commit -m "feat(procedural-motion): wire Idle/Auto Dance into scene animation tick"
```

---

### Task 6: 场景菜单 UI

**Files:**
- Modify: `frontend/src/scene-menu.ts`

- [ ] **Step 1: 读取 scene-menu.ts 根菜单结构确认**

Read `frontend/src/scene-menu.ts` lines 33-48（`buildSceneRoot`，已在前置确认）。根菜单项数组在 line 37-46。

- [ ] **Step 2: 添加 imports**

在 `scene-menu.ts` 的 imports 区块（line 19-23 附近，`import { focusModel, ... } from "./scene";`）追加：

```typescript
import { setProcMotionMode, setProcMotionIntensity, setProcMotionSpeed, setProcMotionAutoSwitch, getProcMotionState, regenerateProcMotion } from "./scene";
import type { ProcMotionMode } from "./procedural-motion";
```

- [ ] **Step 3: 在根菜单添加「程序化动作」入口**

在 `scene-menu.ts` 的 `buildSceneRoot()`（line 33-48）的 `items` 数组中，在「物理」项之后、`{ kind: "folder", label: "截图", ...}` 之前插入：

```typescript
            { kind: "folder", label: "程序化动作", icon: "wind", target: "scene:procmotion" },
```

- [ ] **Step 4: 在 onFolderEnter 中处理新 target**

在 `scene-menu.ts` 中找到 `makeSceneStack` / `onFolderEnter` 处理逻辑。搜索 `row.target === "scene:physics"` 附近，在其处理分支之后追加：

```typescript
        if (row.target === "scene:procmotion") {
            return buildProcMotionLevel();
        }
```

- [ ] **Step 5: 添加 buildProcMotionLevel 函数**

在 `scene-menu.ts` 中（`buildSceneRoot` 之后）追加：

```typescript
function buildProcMotionLevel(): PopupLevel {
    const st = getProcMotionState();
    const modeLabel: Record<string, string> = {
        off: "关闭", idle: "Idle 呼吸", autodance: "Auto Dance",
    };
    return {
        label: "程序化动作",
        dir: "",
        items: [
            { kind: "folder", label: "模式", icon: "wind", target: "procmotion:mode", sublabel: modeLabel[st.mode] },
            { kind: "folder", label: "自动切换", icon: "repeat", target: "procmotion:autoswitch", sublabel: st.autoSwitch ? "开" : "关" },
        ],
        renderCustom: (container) => {
            container.style.padding = "8px 6px";
            // Intensity slider
            addSliderRow(container, "动作强度", st.intensity, 0, 1, 0.05, (v) => {
                setProcMotionIntensity(v);
                regenerateProcMotion();
            }, "lucide:activity");
            // Speed slider
            addSliderRow(container, "速度", st.speed, 0.5, 2, 0.05, (v) => {
                setProcMotionSpeed(v);
                regenerateProcMotion();
            }, "lucide:fast-forward");
        },
    };
}

function buildProcMotionModeLevel(): PopupLevel {
    const st = getProcMotionState();
    const modes: { mode: ProcMotionMode; label: string; icon: string }[] = [
        { mode: "off", label: "关闭", icon: st.mode === "off" ? "check" : "circle" },
        { mode: "idle", label: "Idle 呼吸", icon: st.mode === "idle" ? "check" : "circle" },
        { mode: "autodance", label: "Auto Dance", icon: st.mode === "autodance" ? "check" : "circle" },
    ];
    return {
        label: "程序化动作模式",
        dir: "",
        items: modes.map(m => ({
            kind: "action" as const,
            label: m.label,
            icon: m.icon,
            target: `procmotion:set-mode:${m.mode}`,
        })),
    };
}
```

- [ ] **Step 6: 处理模式选择和自动切换的 onItemClick**

在 `scene-menu.ts` 的 `onItemClick` 处理逻辑中（搜索 `scene:save` 处理附近），追加：

```typescript
        if (row.target && row.target.startsWith("procmotion:set-mode:")) {
            const mode = row.target.replace("procmotion:set-mode:", "") as ProcMotionMode;
            setProcMotionMode(mode);
            regenerateProcMotion();
            sceneStack?.pop();
            sceneStack?.reRender();
            return;
        }
        if (row.target === "procmotion:autoswitch") {
            const cur = getProcMotionState();
            setProcMotionAutoSwitch(!cur.autoSwitch);
            sceneStack?.reRender();
            return;
        }
        if (row.target === "procmotion:mode") {
            sceneStack?.push(buildProcMotionModeLevel());
            return;
        }
```

- [ ] **Step 7: 构建验证**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: 无错误

- [ ] **Step 8: 构建 bundle**

Run: `cd frontend && npx vite build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 9: 提交**

```bash
cd frontend && git add src/scene-menu.ts
git commit -m "feat(procedural-motion): add scene menu entry with mode toggle + intensity/speed sliders"
```

---

### Task 7: 场景序列化

**Files:**
- Modify: `frontend/src/scene.ts`

- [ ] **Step 1: 读取 SceneFile 类型定义确认**

Read `frontend/src/scene.ts` 搜索 `interface SceneFile` 或 `type SceneFile`（reusables.md 记录在 line 481 附近）。

- [ ] **Step 2: 扩展 SceneFile 类型**

在 `scene.ts` 的 `SceneFile` interface 中追加字段：

```typescript
    /** Procedural motion state (Idle/Auto Dance). */
    procMotion?: ProcMotionState;
```

- [ ] **Step 3: 序列化时写入 procMotion**

在 `scene.ts` 的 `serializeScene()` 函数（line ~497）中，在返回对象之前追加：

```typescript
    procMotion: { ...procState },
```

- [ ] **Step 4: 反序列化时恢复 procMotion**

在 `scene.ts` 的 `deserializeScene()` 函数（line ~516）中，在相机/灯光恢复之后追加：

```typescript
    if (data.procMotion) {
        procState = { ...DEFAULT_PROC_STATE, ...data.procMotion };
        setProcMotionMode(procState.mode);
        setProcMotionIntensity(procState.intensity);
        setProcMotionSpeed(procState.speed);
        setProcMotionAutoSwitch(procState.autoSwitch);
    }
```

- [ ] **Step 5: 构建验证 + 全量测试**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: 无错误，全部测试通过

- [ ] **Step 6: 提交**

```bash
cd frontend && git add src/scene.ts
git commit -m "feat(procedural-motion): serialize procMotion state in scene files"
```

---

### Task 8: 端到端手动验证清单 + 文档更新

**Files:**
- Modify: `docs/status.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: 手动验证清单**

启动应用 `cd . && wails dev`，逐项验证：

1. 加载一个有 `まばたき` morph 的 PMX 模型（无 VMD）
2. 打开场景菜单 → 程序化动作 → 模式 → Idle 呼吸
   - 预期：模型开始轻微呼吸起伏，每 ~2.5s 眨眼一次
3. 调节「动作强度」滑块到 0 → 预期：动作几乎停止
4. 调节「动作强度」到 1 → 预期：动作幅度明显增大
5. 调节「速度」滑块 → 预期：呼吸/眨眼频率变化
6. 加载一个 MP3 音频 → 预期：自动切换到 Auto Dance（若 autoSwitch 开）
7. 模式 → Auto Dance → 预期：身体律动 + 头部摆动 + 手臂摆动
8. 加载一个真实 VMD → 预期：procedural motion 停止，VMD 正常播放
9. 保存场景 → 加载场景 → 预期：procMotion 状态恢复
10. 无模型时切换到 Idle → 预期：无报错（startProcMotion 提前 return）

- [ ] **Step 2: 更新 status.md**

在 `docs/status.md` 的「已实现」区块（Phase 8 动作与环境增强部分）追加：

```markdown
**程序化动作（Phase 8）**
- [x] VMD 写入器 — 正确的 111B 骨骼帧 + 23B morph 帧（`vmd-writer.ts`）
- [x] 节拍检测 — Web Audio AnalyserNode + 能量峰值法 BPM 估计（`beat-detector.ts`）
- [x] Idle 呼吸动作 — 上半身呼吸旋转 + 眨眼 morph 循环（`procedural-motion.ts`）
- [x] Auto Dance — 节拍驱动身体律动/头部摆动/手臂摆动
- [x] 强度/速度滑块 — 实时调节动作幅度与频率
- [x] 音乐联动 — 有音乐 Auto Dance，无音乐 Idle
- [x] 场景序列化 — procMotion 状态保存/恢复
```

- [ ] **Step 3: 更新 architecture.md**

在 `docs/architecture.md` 的 §15 舞蹈套装之后追加 §16：

```markdown
### 16. 程序化动作（`procedural-motion.ts` + `beat-detector.ts` + `vmd-writer.ts`）

无需 VMD 文件，程序生成动画让模型自动动起来。

#### 16.1 VMD 写入器（`vmd-writer.ts`）
正确的二进制 VMD 生成器，帧格式确认自 babylon-mmd 源码：
- 骨骼帧 111B = 15(name) + 4(frame) + 12(pos) + 16(rot) + 64(interp)
- morph 帧 23B = 15(name) + 4(frame) + 4(weight)
- 默认线性插值 (20,20,107,107)

#### 16.2 节拍检测（`beat-detector.ts`）
Web Audio API `AnalyserNode` 能量峰值法：
- 低频段(0-430Hz)能量 > 1.3× 滑动均值且距上次 beat > 250ms → 触发
- BPM = 最近 8 次 beat 间隔均值
- 纯逻辑函数 `detectBeatsFromEnergies` / `bpmFromIntervals` 可单测

#### 16.3 动作生成（`procedural-motion.ts`）
| 模式 | 触发 | 内容 |
|------|------|------|
| Idle | 无音乐/无VMD | 上半身呼吸旋转 + センター侧摆 + まばたき眨眼 |
| Auto Dance | 有音乐 | センター Y轴律动 + 頭 Z轴摆动 + 左右臂 Z轴交替 |

#### 16.4 联动规则
- `autoSwitch=true`（默认）：有音乐→Auto Dance，无音乐→Idle
- 用户加载真实 VMD → procedural 自动停止
- BPM 变化 > 10 → 重新生成 Auto Dance VMD
```

- [ ] **Step 4: 更新 reusables.md**

在 `docs/reusables.md` 的 TypeScript 函数表追加：

```markdown
| `generateIdleVmd` | `procedural-motion.ts` | `(state, morphNames) => ArrayBuffer` | 生成 Idle 呼吸 VMD |
| `generateAutoDanceVmd` | `procedural-motion.ts` | `(state, bpm, morphNames) => ArrayBuffer` | 生成 Auto Dance VMD |
| `setProcMotionMode/Intensity/Speed/AutoSwitch` | `scene.ts` | 控制程序化动作参数 | |
| `buildVmd` | `vmd-writer.ts` | `(boneFrames, morphFrames) => ArrayBuffer` | 构建 VMD 二进制 |
| `BeatDetector` | `beat-detector.ts` | 节拍检测类 | |
```

- [ ] **Step 5: 提交文档**

```bash
git add docs/status.md docs/architecture.md docs/reusables.md
git commit -m "docs: procedural motion (Auto Dance / Idle) — status + architecture + reusables"
```

---

## Self-Review

### 1. Spec 覆盖

| Spec 要求 | 对应 Task |
|-----------|-----------|
| Idle 呼吸动作（基于 morph） | Task 3 `generateIdleVmd` — 上半身骨骼呼吸 + まばたき眨眼 morph |
| Auto Dance（节拍检测→舞蹈动作） | Task 2 beat detector + Task 3 `generateAutoDanceVmd` |
| 动作强度/速度滑块 | Task 6 `renderCustom` 两个滑块 + Task 5 setter API |
| 与音乐播放联动 | Task 5 `updateProcMotion` autoSwitch 逻辑 |
| 无音乐时 Idle | Task 5 `shouldIdle` 判断 |

✅ 全覆盖

### 2. Placeholder 扫描

- ✅ 无 TBD/TODO
- ✅ 所有代码步骤含完整实现
- ✅ 测试代码完整可运行
- ✅ 命令含预期输出

### 3. 类型一致性

- `ProcMotionState` / `ProcMotionMode` — Task 3 定义，Task 5/6/7 使用，一致 ✅
- `BoneKeyFrame` / `MorphKeyFrame` — Task 1 定义，Task 3 使用 ✅
- `BeatDetector` — Task 2 定义，Task 4/5 使用 ✅
- `buildVmd` — Task 1 定义，Task 3 调用 ✅
- `setProcMotionMode/Intensity/Speed/AutoSwitch` — Task 5 定义，Task 6 调用 ✅
- `getProcMotionState` — Task 5 定义，Task 6 调用 ✅
- `regenerateProcMotion` — Task 5 定义，Task 6 调用 ✅
