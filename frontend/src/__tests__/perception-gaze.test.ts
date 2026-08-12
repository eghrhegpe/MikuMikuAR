// @vitest-environment node
// [doc:adr-071] 感知层 — 视线追踪双路径行为契约测试
// 锁定不变量：
//   1. _applyGaze 调度入口按 _isWasmRuntime 自动分支到 JS/WASM 路径
//   2. JS 路径写 linkedBone.rotationQuaternion，不主动直写 worldMatrix 缓冲区
//   3. WASM 路径写 worldMatrix 缓冲区（frontBuffer），不写 linkedBone
//   4. tier='low' / 全禁用 / 无匹配骨骼时安全跳过
//   5. cache.headWorldQ 被正确维护
//   6. lookDir 方向：bonePos - cameraPos（已踩坑 3 次，注释强制）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended } from '../core/types';

// vi.mock 必须在 import SUT 之前；hoisted
vi.mock('../ar/ar-camera', () => ({
    isARActive: () => false,
}));

type GazeSut = typeof import('../scene/motion/perception-gaze');
type JsSut = typeof import('../scene/motion/perception-gaze-js');
type WasmSut = typeof import('../scene/motion/perception-gaze-wasm');

let gaze: GazeSut;
let gazeJs: JsSut;
let gazeWasm: WasmSut;

beforeEach(async () => {
    vi.resetModules();
    gaze = await import('../scene/motion/perception-gaze');
    gazeJs = await import('../scene/motion/perception-gaze-js');
    gazeWasm = await import('../scene/motion/perception-gaze-wasm');
});

// ── Mock 骨骼构造工具 ──────────────────────────────────────────────────

interface MakeBoneOpts {
    name: string;
    /** 提供 updateWorldMatrix → JS 路径；缺省 → WASM 路径 */
    js?: boolean;
    parentBone?: any;
    worldMatrix?: Float32Array;
}

function makeBone(opts: MakeBoneOpts): IMmdRuntimeBone & Partial<MmdRuntimeBoneExtended> {
    const worldMatrix = opts.worldMatrix ?? identityWorldMatrix();
    const linkedBone: any = {
        name: opts.name,
        rotationQuaternion: new Quaternion(0, 0, 0, 1),
    };
    const bone: any = {
        name: opts.name,
        linkedBone,
        worldMatrix,
        parentBone: opts.parentBone ?? null,
        childBones: [],
        getWorldTranslationToRef: (out: Vector3) => {
            out.x = worldMatrix[12];
            out.y = worldMatrix[13];
            out.z = worldMatrix[14];
            return out;
        },
    };
    if (opts.js) {
        // JS 路径标志：提供 updateWorldMatrix（空实现，便于观察是否被调用）
        bone.updateWorldMatrix = () => {};
    }
    // 否则 WASM 路径：不提供 updateWorldMatrix（命中 _isWasmRuntime）
    return bone;
}

function identityWorldMatrix(): Float32Array {
    const m = new Float32Array(16);
    m[0] = 1;
    m[5] = 1;
    m[10] = 1;
    m[15] = 1;
    return m;
}

/** 构造一个头部骨骼：位置 (0,1.5,0)，正前方 +Z（MMD 默认朝向） */
function makeHeadBone(opts?: { js?: boolean; parentBone?: any }): IMmdRuntimeBone {
    const wm = identityWorldMatrix();
    wm[12] = 0;
    wm[13] = 1.5;
    wm[14] = 0;
    return makeBone({ name: '頭', js: opts?.js, parentBone: opts?.parentBone, worldMatrix: wm });
}

/** 构造相机 stub：仅需要 .position */
function makeCameraAt(camPos: [number, number, number]): any {
    return { position: new Vector3(camPos[0], camPos[1], camPos[2]) };
}

// ── 1. _applyGaze 调度入口 ────────────────────────────────────────────

describe('_applyGaze 调度入口', () => {
    it("tier='low' 时直接返回，不修改任何骨骼", () => {
        const head = makeHeadBone({ js: true });
        const beforeQ = (head.linkedBone as any).rotationQuaternion.clone();
        gaze._applyGaze(
            { runtimeBones: [head], mesh: {} } as any,
            makeCameraAt([5, 1.5, 0]),
            { headEnabled: true, eyeEnabled: true },
            0.016,
            undefined,
            undefined,
            'low',
            { headWorldQ: null, eyeLocalQ: new Map() }
        );
        expect((head.linkedBone as any).rotationQuaternion.equalsWithEpsilon(beforeQ)).toBe(true);
    });

    it('headEnabled=false && eyeEnabled=false 时直接返回', () => {
        const head = makeHeadBone({ js: true });
        const beforeQ = (head.linkedBone as any).rotationQuaternion.clone();
        gaze._applyGaze(
            { runtimeBones: [head], mesh: {} } as any,
            makeCameraAt([5, 1.5, 0]),
            { headEnabled: false, eyeEnabled: false },
            0.016,
            undefined,
            undefined,
            'high',
            { headWorldQ: null, eyeLocalQ: new Map() }
        );
        expect((head.linkedBone as any).rotationQuaternion.equalsWithEpsilon(beforeQ)).toBe(true);
    });

    it('无匹配头部/眼部骨骼时安全返回不抛异常', () => {
        const unrelated = makeBone({ name: '左足', js: true });
        expect(() =>
            gaze._applyGaze(
                { runtimeBones: [unrelated], mesh: {} } as any,
                makeCameraAt([5, 1.5, 0]),
                { headEnabled: true, eyeEnabled: true },
                0.016,
                undefined,
                undefined,
                'high',
                { headWorldQ: null, eyeLocalQ: new Map() }
            )
        ).not.toThrow();
    });
});

// ── 2. JS 路径写入策略 ────────────────────────────────────────────────

describe('_applyHeadGazeJS 写入策略', () => {
    it('写入 linkedBone.rotationQuaternion（绕 Y 轴旋转，y 分量主导）', () => {
        const head = makeHeadBone({ js: true });
        const beforeQ = (head.linkedBone as any).rotationQuaternion.clone();
        // camPos=(5,1.5,0)：lookDir = headPos - camPos = (-5,0,0)
        // → targetWorldQ 绕 Y 转 +90°（-Z 朝向 -X）→ clamp 到 +75° → Slerp 后 y 分量显著非零
        gazeJs._applyHeadGazeJS(head, new Vector3(5, 1.5, 0), 0.016, undefined);
        const afterQ = (head.linkedBone as any).rotationQuaternion;
        expect(afterQ.equalsWithEpsilon(beforeQ, 1e-6)).toBe(false);
        // Y 轴旋转：y 主导，x/z 应接近 0
        expect(Math.abs(afterQ.y)).toBeGreaterThan(0.05);
        expect(Math.abs(afterQ.x)).toBeLessThan(0.05);
        expect(Math.abs(afterQ.z)).toBeLessThan(0.05);
    });

    it('不主动直写 worldMatrix 缓冲区（JS 路径走 updateWorldMatrix，不写 frontBuffer）', () => {
        const head = makeHeadBone({ js: true });
        const beforeBuf = [...(head as any).worldMatrix];
        gazeJs._applyHeadGazeJS(head, new Vector3(5, 1.5, 0), 0.016, undefined);
        const afterBuf = [...((head as any).worldMatrix as Float32Array)];
        // mock updateWorldMatrix 为空函数 → worldMatrix 应保持原值
        expect(afterBuf).toEqual(beforeBuf);
    });

    it('cache.headWorldQ 被维护（首次调用创建）', () => {
        const head = makeHeadBone({ js: true });
        const cache = { headWorldQ: null, eyeLocalQ: new Map() };
        gazeJs._applyHeadGazeJS(head, new Vector3(5, 1.5, 0), 0.016, cache);
        expect(cache.headWorldQ).not.toBeNull();
        expect(cache.headWorldQ instanceof Quaternion).toBe(true);
    });

    it('cache.headWorldQ 被维护（二次调用复用并更新）', () => {
        const head = makeHeadBone({ js: true });
        const cache = { headWorldQ: null, eyeLocalQ: new Map() };
        gazeJs._applyHeadGazeJS(head, new Vector3(5, 1.5, 0), 0.016, cache);
        const firstQ = cache.headWorldQ!.clone();
        // 相机位置变到 -X 侧 → finalQ 应不同
        gazeJs._applyHeadGazeJS(head, new Vector3(-5, 1.5, 0), 0.016, cache);
        expect(cache.headWorldQ!.equalsWithEpsilon(firstQ, 1e-6)).toBe(false);
    });
});

// ── 3. WASM 路径写入策略 ──────────────────────────────────────────────

describe('_applyHeadGazeWasm 写入策略', () => {
    it('写入 worldMatrix 缓冲区（frontBuffer）', () => {
        const head = makeHeadBone({ js: false }); // 不提供 updateWorldMatrix → WASM
        const beforeBuf = [...(head as any).worldMatrix];
        gazeWasm._applyHeadGazeWasm(head, new Vector3(5, 1.5, 0), 0.016, undefined);
        const afterBuf = (head as any).worldMatrix;
        expect(afterBuf).not.toEqual(beforeBuf);
    });

    it('不修改 linkedBone.rotationQuaternion（与 JS 路径相反）', () => {
        const head = makeHeadBone({ js: false });
        const beforeQ = (head.linkedBone as any).rotationQuaternion.clone();
        gazeWasm._applyHeadGazeWasm(head, new Vector3(5, 1.5, 0), 0.016, undefined);
        const afterQ = (head.linkedBone as any).rotationQuaternion;
        expect(afterQ.equalsWithEpsilon(beforeQ, 1e-6)).toBe(true);
    });

    it('cache.headWorldQ 被维护（与 JS 路径对称）', () => {
        const head = makeHeadBone({ js: false });
        const cache = { headWorldQ: null, eyeLocalQ: new Map() };
        gazeWasm._applyHeadGazeWasm(head, new Vector3(5, 1.5, 0), 0.016, cache);
        expect(cache.headWorldQ).not.toBeNull();
        expect(cache.headWorldQ instanceof Quaternion).toBe(true);
    });

    it('worldMatrix 平移部分保持不变（仅旋转部分被改）', () => {
        const head = makeHeadBone({ js: false });
        const beforeTrans = [
            (head as any).worldMatrix[12],
            (head as any).worldMatrix[13],
            (head as any).worldMatrix[14],
        ];
        gazeWasm._applyHeadGazeWasm(head, new Vector3(5, 1.5, 0), 0.016, undefined);
        const afterTrans = [
            (head as any).worldMatrix[12],
            (head as any).worldMatrix[13],
            (head as any).worldMatrix[14],
        ];
        expect(afterTrans).toEqual(beforeTrans);
    });
});

// ── 4. 调度入口自动分支（_isWasmRuntime） ────────────────────────────

describe('_applyGaze 调度自动分支', () => {
    it('JS bone（提供 updateWorldMatrix）→ 走 JS 路径：改 linkedBone 不改 worldMatrix', () => {
        const head = makeHeadBone({ js: true });
        const beforeBuf = [...((head as any).worldMatrix as Float32Array)];
        const beforeQ = (head.linkedBone as any).rotationQuaternion.clone();
        gaze._applyGaze(
            { runtimeBones: [head], mesh: {} } as any,
            makeCameraAt([5, 1.5, 0]),
            { headEnabled: true, eyeEnabled: false },
            0.016,
            undefined,
            undefined,
            'high',
            { headWorldQ: null, eyeLocalQ: new Map() }
        );
        // JS 路径：linkedBone 被改
        expect((head.linkedBone as any).rotationQuaternion.equalsWithEpsilon(beforeQ, 1e-6)).toBe(
            false
        );
        // JS 路径：worldMatrix 缓冲区不变（mock updateWorldMatrix 为空）
        expect([...((head as any).worldMatrix as Float32Array)]).toEqual(beforeBuf);
    });

    it('WASM bone（无 updateWorldMatrix）→ 走 WASM 路径：改 worldMatrix 不改 linkedBone', () => {
        const head = makeHeadBone({ js: false });
        const beforeBuf = [...(head as any).worldMatrix];
        const beforeQ = (head.linkedBone as any).rotationQuaternion.clone();
        gaze._applyGaze(
            { runtimeBones: [head], mesh: {} } as any,
            makeCameraAt([5, 1.5, 0]),
            { headEnabled: true, eyeEnabled: false },
            0.016,
            undefined,
            undefined,
            'high',
            { headWorldQ: null, eyeLocalQ: new Map() }
        );
        // WASM 路径：worldMatrix 缓冲区被改
        expect((head as any).worldMatrix).not.toEqual(beforeBuf);
        // WASM 路径：linkedBone 不变
        expect((head.linkedBone as any).rotationQuaternion.equalsWithEpsilon(beforeQ, 1e-6)).toBe(
            true
        );
    });
});

// ── 5. lookDir 方向不变量（已踩坑 3 次） ─────────────────────────────

describe('lookDir 方向不变量', () => {
    it('lookDir = bonePos - camPos（不是 camPos - bonePos）：+Z 与 -Z 相机位置产生不同旋转', () => {
        // 头部位于 (0,1.5,0)，正前方 +Z。Babylon.js FromLookDirectionRH 让 +Z 对齐 lookDir：
        //   - camPos=(0,1.5,+5)：lookDir=(0,0,-5) → +Z 对齐 (0,0,-1) → Y+180° → clamp 后 Y+75°
        //   - camPos=(0,1.5,-5)：lookDir=(0,0,+5) → +Z 对齐 (0,0,+1) → Identity → finalQ≈Identity
        // 若 lookDir 反向（camPos - bonePos），两个相机位置的旋转结果会对调
        const headPos = makeHeadBone({ js: false });
        const cachePos = { headWorldQ: null, eyeLocalQ: new Map() };
        gazeWasm._applyHeadGazeWasm(headPos, new Vector3(0, 1.5, 5), 0.016, cachePos);
        const anglePos = 2 * Math.acos(Math.min(Math.abs(cachePos.headWorldQ!.w), 1));

        const headNeg = makeHeadBone({ js: false });
        const cacheNeg = { headWorldQ: null, eyeLocalQ: new Map() };
        gazeWasm._applyHeadGazeWasm(headNeg, new Vector3(0, 1.5, -5), 0.016, cacheNeg);
        const angleNeg = 2 * Math.acos(Math.min(Math.abs(cacheNeg.headWorldQ!.w), 1));

        // +Z 相机位置（远离 MMD 默认朝向）→ 应有显著旋转
        expect(anglePos).toBeGreaterThan(0.1);
        // -Z 相机位置（与 MMD 默认朝向同向）→ 应几乎不转
        expect(angleNeg).toBeLessThan(0.001);
    });

    it('对称相机位置（+X / -X）产生相反方向的 Y 旋转（验证 lookDir 符号正确）', () => {
        // camPos=(5,1.5,0)：lookDir=(-5,0,0) → 头部绕 Y 转 +75°（被 clamp）→ q.y > 0
        // camPos=(-5,1.5,0)：lookDir=(5,0,0) → 头部绕 Y 转 -75°（被 clamp）→ q.y < 0
        // 若 lookDir 反向，则两次旋转符号会反过来
        const head1 = makeHeadBone({ js: false });
        const cache1 = { headWorldQ: null, eyeLocalQ: new Map() };
        gazeWasm._applyHeadGazeWasm(head1, new Vector3(5, 1.5, 0), 0.016, cache1);

        const head2 = makeHeadBone({ js: false });
        const cache2 = { headWorldQ: null, eyeLocalQ: new Map() };
        gazeWasm._applyHeadGazeWasm(head2, new Vector3(-5, 1.5, 0), 0.016, cache2);

        const y1 = cache1.headWorldQ!.y;
        const y2 = cache2.headWorldQ!.y;
        // 两次旋转方向相反
        expect(y1 * y2).toBeLessThan(0);
    });

    it('相机与头部重合时（lookLen=0）安全返回不抛异常', () => {
        const head = makeHeadBone({ js: false });
        // 相机位置 = 头部位置 = (0,1.5,0)，lookDir 长度 = 0
        expect(() =>
            gazeWasm._applyHeadGazeWasm(head, new Vector3(0, 1.5, 0), 0.016, undefined)
        ).not.toThrow();
    });
});

// ── 6. Swing-Twist 回归（修复 swingAngle 从 desiredLocal.w 误算导致 swing 过度限位） ─

describe('_clampImpl Swing-Twist 回归', () => {
    it('纯 Y 旋转（无 pitch）不应被 swing 限位错误钳制', () => {
        // 构造纯 Y 旋转 90°：大幅偏航，零 pitch
        const yawAngle = (90 * Math.PI) / 180;
        const targetWorldQ = Quaternion.RotationAxis(Vector3.Up(), yawAngle);
        const oldWorldQ = Quaternion.Identity();
        const parentWorldQ = Quaternion.Identity();

        const result = gaze._clampHeadGazeTarget(oldWorldQ, targetWorldQ, parentWorldQ);

        // 结果应是 Y 旋转被 limited 到 ±75°（head max yaw），
        // 但 swing（x/z 分量）应 ≈ 0（无 pitch/roll 残留）
        expect(Math.abs(result.y)).toBeGreaterThan(0.05);
        expect(Math.abs(result.x)).toBeLessThan(1e-6);
        expect(Math.abs(result.z)).toBeLessThan(1e-6);
    });

    it('大 yaw + 小 pitch 混合时，swing 不应被 yaw 连累过度限位', () => {
        // 40° yaw + 15° pitch（15° < maxPitch=35°，不应被限位缩放）
        const yawAngle = (40 * Math.PI) / 180;
        const pitchAngle = (15 * Math.PI) / 180;
        const yawQ = Quaternion.RotationAxis(Vector3.Up(), yawAngle);
        const pitchQ = Quaternion.RotationAxis(Vector3.Right(), pitchAngle);
        // 组合：yawQ * pitchQ（先 pitch 后 yaw）
        const targetWorldQ = new Quaternion();
        yawQ.multiplyToRef(pitchQ, targetWorldQ);
        const oldWorldQ = Quaternion.Identity();
        const parentWorldQ = Quaternion.Identity();

        const result = gaze._clampHeadGazeTarget(oldWorldQ, targetWorldQ, parentWorldQ);

        // 修复前：swingAngle 从 desiredLocal.w（含 yaw 贡献 ≈40°）算得 > 35°，swing 被缩放到 ~11°
        // 修复后：swingAngle 从纯 swing.w 算得 ≈ 15° < 35°，swing 保留原值
        // 验证：pitch 分量（x）应显著非零（≈ 15° pitch → quat x 分量 ≈ sin(7.5°) ≈ 0.13）
        expect(Math.abs(result.x)).toBeGreaterThan(0.02);
    });
});

// ── 7. 眼部 Gaze 基本行为测试 ──────────────────────────────────────────

describe('_applyEyeGazeJS 策略', () => {
    it('非重合时写入 linkedBone.rotationQuaternion（有 gaze offset）', () => {
        const eye = makeBone({ name: '右目', js: true });
        const beforeQ = (eye.linkedBone as any).rotationQuaternion.clone();
        gazeJs._applyEyeGazeJS([eye], new Vector3(5, 1.5, 0), 0.016, undefined);
        const afterQ = (eye.linkedBone as any).rotationQuaternion;
        expect(afterQ.equalsWithEpsilon(beforeQ, 1e-6)).toBe(false);
    });

    it('非重合时不修改 worldMatrix', () => {
        const eye = makeBone({ name: '右目', js: true });
        const beforeBuf = [...(eye as any).worldMatrix];
        gazeJs._applyEyeGazeJS([eye], new Vector3(5, 1.5, 0), 0.016, undefined);
        expect([...((eye as any).worldMatrix as Float32Array)]).toEqual(beforeBuf);
    });
});

describe('_applyEyeGazeWasm 策略', () => {
    it('写入 worldMatrix 缓冲区', () => {
        const eye = makeBone({ name: '右目', js: false });
        const beforeBuf = [...(eye as any).worldMatrix];
        gazeWasm._applyEyeGazeWasm([eye], new Vector3(5, 1.5, 0), 0.016, undefined);
        expect((eye as any).worldMatrix).not.toEqual(beforeBuf);
    });

    it('不修改 linkedBone.rotationQuaternion', () => {
        const eye = makeBone({ name: '右目', js: false });
        const beforeQ = (eye.linkedBone as any).rotationQuaternion.clone();
        gazeWasm._applyEyeGazeWasm([eye], new Vector3(5, 1.5, 0), 0.016, undefined);
        const afterQ = (eye.linkedBone as any).rotationQuaternion;
        expect(afterQ.equalsWithEpsilon(beforeQ, 1e-6)).toBe(true);
    });

    it('worldMatrix 平移部分保持不变', () => {
        const eye = makeBone({ name: '右目', js: false });
        const beforeTrans = [
            (eye as any).worldMatrix[12],
            (eye as any).worldMatrix[13],
            (eye as any).worldMatrix[14],
        ];
        gazeWasm._applyEyeGazeWasm([eye], new Vector3(5, 1.5, 0), 0.016, undefined);
        const afterTrans = [
            (eye as any).worldMatrix[12],
            (eye as any).worldMatrix[13],
            (eye as any).worldMatrix[14],
        ];
        expect(afterTrans).toEqual(beforeTrans);
    });

    it('cache.eyeLocalQ 被维护（首次调用创建）', () => {
        const eye = makeBone({ name: '右目', js: false });
        const cache = { headWorldQ: null, eyeLocalQ: new Map() };
        gazeWasm._applyEyeGazeWasm([eye], new Vector3(5, 1.5, 0), 0.016, cache);
        const cached = cache.eyeLocalQ.get('右目');
        expect(cached).not.toBeUndefined();
        expect(cached instanceof Quaternion).toBe(true);
    });

    it('lookDir=0 时安全返回不抛异常', () => {
        const eye = makeBone({ name: '右目', js: false });
        // gazeTarget == eyePos (0,0,0) → lookDir 长度 = 0
        expect(() =>
            gazeWasm._applyEyeGazeWasm([eye], new Vector3(0, 0, 0), 0.016, undefined)
        ).not.toThrow();
    });
});
