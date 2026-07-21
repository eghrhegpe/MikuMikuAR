// [doc:adr-155] 感知层性能基准测试（headless）
//
// 目的：为 ADR-154「全员感知降级」提供阈值数据。
//
// 策略：
//   - 用合成骨骼图建立模型 stub（自包含，不依赖外部 PMX 资产）
//   - 复刻 6 项感知热路径（不导入 perception.ts，避免循环依赖）
//   - 软断言（console.warn）避免 CI 性能波动误报
//
// 运行：npx vitest run --config vitest.perf.config.ts src/__tests__/perception.perf.test.ts
// （已排除出默认 test 套件：vitest.config.ts exclude '**/*.perf.test.ts'）

import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { test, expect } from 'vitest';
import {
    matchBone,
    BONE_UPPER_CANDIDATES,
    BONE_CENTER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
    MORPH_BLINK_CANDIDATES,
} from '../motion-algos/proc-motion-shared';
import { findLipMorph, findAllLipMorphs, amplitudeToWeight } from '../motion-algos/lipsync';

// ── 类型 ──

type RuntimeBone = {
    name: string;
    parentBone: RuntimeBone | null;
    childBones: RuntimeBone[];
    worldMatrix: Float32Array;
    linkedBone: {
        rotationQuaternion: Quaternion | null;
        position: Vector3;
    };
};

type StubMorphTarget = { name: string; influence: number };

type StubMorphManager = {
    numTargets: number;
    getTarget(i: number): StubMorphTarget;
    getTargetByName(name: string): StubMorphTarget | null;
};

type ModelStub = {
    runtimeBones: RuntimeBone[];
    mesh: {
        morphTargetManager?: StubMorphManager;
    };
};

// ── 合成模型生成器 ──

/** 生成典型 MMD 骨骼层级（约 100 骨，覆盖感知层全部候选） */
function createSyntheticModelStub(): ModelStub {
    const bones: RuntimeBone[] = [];

    function addBone(name: string, parent: RuntimeBone | null): RuntimeBone {
        const bone: RuntimeBone = {
            name,
            parentBone: parent,
            childBones: [],
            worldMatrix: new Float32Array(Matrix.Identity().asArray()),
            linkedBone: {
                rotationQuaternion: Quaternion.Identity(),
                position: new Vector3(0, 0, 0),
            },
        };
        bones.push(bone);
        if (parent) {
            parent.childBones.push(bone);
        }
        return bone;
    }

    // 根层级
    const allParent = addBone('全ての親', null);
    const center = addBone('センター', allParent);
    const groove = addBone('グルーブ', center);

    // 下半身
    const lowerBody = addBone('下半身', groove);
    const legL = addBone('左足', lowerBody);
    const kneeL = addBone('左ひざ', legL);
    const ankleL = addBone('左足首', kneeL);
    const legR = addBone('右足', lowerBody);
    const kneeR = addBone('右ひざ', legR);
    const ankleR = addBone('右足首', kneeR);

    // 上半身链
    const waist = addBone('腰', groove);
    const upperBody = addBone('上半身', waist);
    const upperBody2 = addBone('上半身2', upperBody);
    const neck = addBone('首', upperBody2);
    const head = addBone('頭', neck);

    // 眼睛
    const eyeL = addBone('左目', head);
    const eyeR = addBone('右目', head);

    // 手臂
    const shoulderL = addBone('左肩', upperBody2);
    const armL = addBone('左腕', shoulderL);
    const elbowL = addBone('左ひじ', armL);
    const wristL = addBone('左手首', elbowL);
    const shoulderR = addBone('右肩', upperBody2);
    const armR = addBone('右腕', shoulderR);
    const elbowR = addBone('右ひじ', armR);
    const wristR = addBone('右手首', elbowR);

    // 手指（填充骨量到 ~100）
    const fingerNames = [
        '親指', '人差指', '中指', '薬指', '小指',
        '親指１', '親指２', '親指３',
        '人差指１', '人差指２', '人差指３',
        '中指１', '中指２', '中指３',
        '薬指１', '薬指２', '薬指３',
        '小指１', '小指２', '小指３',
    ];
    for (const side of ['左', '右']) {
        const parentWrist = side === '左' ? wristL : wristR;
        for (const finger of fingerNames) {
            addBone(`${side}${finger}`, parentWrist);
        }
    }

    // 足 IK
    addBone('左足ＩＫ', allParent);
    addBone('右足ＩＫ', allParent);
    addBone('左足首ＩＫ', allParent);
    addBone('右足首ＩＫ', allParent);

    // 腕 IK
    addBone('左腕ＩＫ', allParent);
    addBone('右腕ＩＫ', allParent);

    // 追加填充骨（让总数接近典型 MMD 模型的 100+）
    for (let i = 1; i <= 12; i++) {
        addBone(`補助骨${i}`, upperBody2);
    }

    // Morph 目标（覆盖眨眼/表情/口型）
    const morphTargets: StubMorphTarget[] = [
        { name: 'まばたき', influence: 0 },
        { name: '笑み', influence: 0 },
        { name: 'にっこり', influence: 0 },
        { name: 'あ', influence: 0 },
        { name: 'い', influence: 0 },
        { name: 'う', influence: 0 },
        { name: 'え', influence: 0 },
        { name: 'お', influence: 0 },
        { name: '驚き', influence: 0 },
        { name: '怒り', influence: 0 },
        { name: '悲しみ', influence: 0 },
        { name: 'ウィンク', influence: 0 },
        { name: 'ｳｨﾝｸ', influence: 0 },
        { name: 'ｳｨﾝｸ右', influence: 0 },
        { name: 'ｳｨﾝｸ左', influence: 0 },
        { name: 'なごみ', influence: 0 },
        { name: 'びっくり', influence: 0 },
        { name: 'じと目', influence: 0 },
        { name: 'ｷﾘｯ', influence: 0 },
        { name: 'はぅ', influence: 0 },
    ];

    return {
        runtimeBones: bones,
        mesh: {
            morphTargetManager: {
                numTargets: morphTargets.length,
                getTarget: (i: number) => morphTargets[i],
                getTargetByName: (name: string) => morphTargets.find((t) => t.name === name) ?? null,
            },
        },
    };
}

function cloneModelStub(original: ModelStub): ModelStub {
    const origToClone = new Map<RuntimeBone, RuntimeBone>();
    const clones: RuntimeBone[] = original.runtimeBones.map((b) => {
        const clone: RuntimeBone = {
            name: b.name,
            parentBone: null,
            childBones: [],
            worldMatrix: new Float32Array(b.worldMatrix),
            linkedBone: {
                rotationQuaternion: b.linkedBone.rotationQuaternion?.clone() ?? null,
                position: b.linkedBone.position.clone(),
            },
        };
        origToClone.set(b, clone);
        return clone;
    });
    for (let i = 0; i < original.runtimeBones.length; i++) {
        const orig = original.runtimeBones[i];
        const clone = clones[i];
        clone.parentBone = orig.parentBone ? (origToClone.get(orig.parentBone) ?? null) : null;
        clone.childBones = orig.childBones.map((c) => origToClone.get(c)!);
    }

    // 独立克隆 morph manager
    const origMorphs = original.mesh.morphTargetManager;
    const clonedMorphs: StubMorphManager | undefined = origMorphs
        ? {
              numTargets: origMorphs.numTargets,
              getTarget: (i: number) => ({ ...origMorphs.getTarget(i), influence: 0 }),
              getTargetByName: (name: string) => {
                  const t = origMorphs.getTargetByName(name);
                  return t ? { ...t, influence: 0 } : null;
              },
          }
        : undefined;

    return {
        runtimeBones: clones,
        mesh: {
            morphTargetManager: clonedMorphs,
        },
    };
}

// ── 对象池（复刻 perception-shared 同款，避免 GC 噪音） ──

const _v3Pool = Array.from({ length: 16 }, () => new Vector3());
const _mPool = Array.from({ length: 16 }, () => new Matrix());
const _qPool = Array.from({ length: 32 }, () => new Quaternion());
let _v3Idx = 0,
    _mIdx = 0,
    _qIdx = 0;

function _v3(): Vector3 {
    return _v3Pool[_v3Idx++ % _v3Pool.length];
}
function _m(): Matrix {
    return _mPool[_mIdx++ % _mPool.length];
}
function _q(): Quaternion {
    return _qPool[_qIdx++ % _qPool.length];
}

// ── updateWorldMatrix 轻量 stub（捕获真实调用开销 + 矩阵回写） ──

function stubUpdateWorldMatrix(bone: RuntimeBone): void {
    const q = bone.linkedBone.rotationQuaternion;
    if (q) {
        const m = Matrix.Compose(Vector3.One(), q, bone.linkedBone.position);
        const arr = m.asArray();
        for (let i = 0; i < 16; i++) {
            bone.worldMatrix[i] = arr[i];
        }
    }
}

function stubUpdateBoneChain(bone: RuntimeBone): void {
    stubUpdateWorldMatrix(bone);
    for (const child of bone.childBones) {
        stubUpdateBoneChain(child);
    }
}

// ── 感知热路径复刻（不导入 perception.ts） ──

/** 呼吸热路径：matchBone + RotationAxis + multiply + updateWorldMatrix */
function benchApplyBreathing(stub: ModelStub, time: number): void {
    const freq = 0.3;
    const amp = 0.02;
    const phase = time * freq * 2 * Math.PI;
    const breathOffset = amp * Math.sin(phase);

    const boneNames = stub.runtimeBones.map((b) => b.name);
    const spineName = matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const spine = spineName
        ? stub.runtimeBones.find((b) => b.name === spineName)
        : null;
    if (!spine) {
        return;
    }

    const curQ = spine.linkedBone.rotationQuaternion;
    if (!curQ) {
        return;
    }

    const deltaOffset = breathOffset * 0.6;
    if (deltaOffset !== 0) {
        const deltaQ = _q().copyFrom(Quaternion.RotationAxis(Vector3.Right(), deltaOffset));
        const localQ = _q().copyFrom(curQ);
        deltaQ.multiplyToRef(localQ, localQ);
        curQ.copyFrom(localQ);
    }

    stubUpdateWorldMatrix(spine);
    for (const child of spine.childBones) {
        stubUpdateBoneChain(child);
    }
}

/** 眨眼热路径：morph 扫描 + getTargetByName + influence */
function benchApplyBlinking(stub: ModelStub, time: number): void {
    const freq = 0.25;
    const amp = 1.0;
    if (amp <= 0) {
        return;
    }
    const phase = time * freq * 2 * Math.PI;
    const blinkIntensity = Math.max(0, Math.sin(phase) - 0.8) * 5 * amp;

    const morphManager = stub.mesh.morphTargetManager;
    if (!morphManager) {
        return;
    }

    const morphNames: string[] = [];
    for (let i = 0; i < morphManager.numTargets; i++) {
        morphNames.push(morphManager.getTarget(i).name);
    }
    const blinkName = matchBone(morphNames, MORPH_BLINK_CANDIDATES);
    if (!blinkName) {
        return;
    }

    const eyeClose = morphManager.getTargetByName(blinkName);
    if (eyeClose) {
        eyeClose.influence = Math.max(eyeClose.influence, blinkIntensity);
    }
}

/** 微表情热路径：morph 扫描 + sin² 脉冲 + influence */
function benchApplyMicroExpression(stub: ModelStub, time: number): void {
    const morphManager = stub.mesh.morphTargetManager;
    if (!morphManager) {
        return;
    }

    const morphNames: string[] = [];
    for (let i = 0; i < morphManager.numTargets; i++) {
        morphNames.push(morphManager.getTarget(i).name);
    }

    // 模拟 happy 情绪候选匹配
    const happyCandidates = ['笑み', 'Smile', 'smile', 'にっこり', 'Happy'];
    const targetName = matchBone(morphNames, happyCandidates);
    if (!targetName) {
        return;
    }

    const targetMorph = morphManager.getTargetByName(targetName);
    if (!targetMorph) {
        return;
    }

    const period = 4.0;
    const peak = 0.12;
    const pulsePhase = (time % period) / period;
    const pulse = Math.sin(pulsePhase * Math.PI * 2) ** 2;
    targetMorph.influence = pulse * peak;
}

/** 重心微动热路径：6 骨骼增量叠加 */
function benchApplyBalanceSway(stub: ModelStub, time: number): void {
    const boneNames = stub.runtimeBones.map((b) => b.name);
    const centerName = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upper2Name = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistName = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentName = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);

    const period = 2.0;
    const phase = ((time % period) / period) * Math.PI * 2;
    const slowPhase = phase * 0.5;
    const factor = 0.6;

    if (centerName) {
        const bone = stub.runtimeBones.find((b) => b.name === centerName);
        if (bone?.linkedBone) {
            const bobY = Math.sin(phase) * 0.03;
            bone.linkedBone.position.y = bone.linkedBone.position.y + bobY;

            const rz = Math.sin(slowPhase) * 0.05;
            const rx = Math.sin(phase * 0.37 + 0.5) * 0.02;
            if (bone.linkedBone.rotationQuaternion) {
                const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(rx * factor, 0, rz * factor));
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                deltaQ.multiplyToRef(localQ, localQ);
                bone.linkedBone.rotationQuaternion.copyFrom(localQ);
            }
            stubUpdateWorldMatrix(bone);
        }
    }

    if (upper2Name) {
        const bone = stub.runtimeBones.find((b) => b.name === upper2Name);
        if (bone?.linkedBone?.rotationQuaternion) {
            const rx = Math.sin(phase * 0.7 + 0.3) * 0.015;
            const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(rx * factor, 0, 0));
            const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
            deltaQ.multiplyToRef(localQ, localQ);
            bone.linkedBone.rotationQuaternion.copyFrom(localQ);
            stubUpdateWorldMatrix(bone);
        }
    }

    if (waistName) {
        const bone = stub.runtimeBones.find((b) => b.name === waistName);
        if (bone?.linkedBone?.rotationQuaternion) {
            const rz = Math.sin(phase + 0.5) * 0.015;
            const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(0, 0, rz * factor));
            const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
            deltaQ.multiplyToRef(localQ, localQ);
            bone.linkedBone.rotationQuaternion.copyFrom(localQ);
            stubUpdateWorldMatrix(bone);
        }
    }

    if (allParentName) {
        const bone = stub.runtimeBones.find((b) => b.name === allParentName);
        if (bone?.linkedBone?.rotationQuaternion) {
            const rx = Math.sin(phase * 0.2 + 1.1) * 0.005;
            const rz = Math.sin(phase * 0.3 + 2.3) * 0.005;
            const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(rx * factor, 0, rz * factor));
            const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
            deltaQ.multiplyToRef(localQ, localQ);
            bone.linkedBone.rotationQuaternion.copyFrom(localQ);
            stubUpdateWorldMatrix(bone);
        }
    }
}

/** 视线热路径：_clampHeadGazeTarget + Slerp + updateWorldMatrix */
function benchApplyGaze(stub: ModelStub, gazeTarget: Vector3): void {
    const headRuntime = stub.runtimeBones.find((b) =>
        ['頭', '首', 'head', 'Head'].includes(b.name)
    );
    if (!headRuntime) {
        return;
    }

    const headPos = _v3();
    headPos.x = headRuntime.worldMatrix[12];
    headPos.y = headRuntime.worldMatrix[13];
    headPos.z = headRuntime.worldMatrix[14];

    const oldHeadMat = _m().copyFrom(Matrix.FromArray(headRuntime.worldMatrix));
    const oldHeadRotQ = _q().copyFrom(Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix()));

    const lookDir = headPos.subtractToRef(gazeTarget, _v3()).normalize();
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

    const parentBone = headRuntime.parentBone;
    const parentWorldInv = _m();
    if (parentBone) {
        const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
        parentMat.invertToRef(parentWorldInv);
    } else {
        Matrix.IdentityToRef(parentWorldInv);
    }

    const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
    const parentWorldQ = _q().copyFrom(parentInvQ).invert();

    // 复刻 _clampHeadGazeTarget（_clampImpl 内联）
    const maxYawRad = (75 * Math.PI) / 180;
    const maxPitchRad = (35 * Math.PI) / 180;
    const invParent = _q().copyFrom(parentWorldQ).invert();
    const desiredLocal = _q().copyFrom(invParent).multiplyInPlace(targetWorldQ);
    const e = desiredLocal.toEulerAngles();
    const yaw = Math.max(-maxYawRad, Math.min(maxYawRad, e.y));
    const pitch = Math.max(-maxPitchRad, Math.min(maxPitchRad, e.x));
    const clampedLocal = Quaternion.FromEulerAngles(pitch, yaw, 0);
    const clampedTargetQ = _q().copyFrom(parentWorldQ).multiplyInPlace(clampedLocal);

    const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, clampedTargetQ, 0.5));
    const localQ = _q();
    parentInvQ.multiplyToRef(blended, localQ);

    const headQ = headRuntime.linkedBone.rotationQuaternion;
    if (headQ) {
        headQ.copyFrom(localQ);
    }

    stubUpdateBoneChain(headRuntime);
}

/** LipSync 热路径：amplitudeToWeight + getTargetByName + influence（多 morph） */
function benchApplyLipSync(stub: ModelStub): void {
    const morphManager = stub.mesh.morphTargetManager;
    if (!morphManager) {
        return;
    }

    const morphNames: string[] = [];
    for (let i = 0; i < morphManager.numTargets; i++) {
        morphNames.push(morphManager.getTarget(i).name);
    }

    const lipName = findLipMorph(morphNames);
    if (!lipName) {
        return;
    }

    // 模拟音频能量 → 权重（复刻 amplitudeToWeight 热路径）
    const amplitude = 0.6;
    const sensitivity = 0.2;
    const intensity = 0.8;
    const openWeight = amplitudeToWeight(amplitude, sensitivity, intensity);

    const openMorph = morphManager.getTargetByName(lipName);
    if (openMorph) {
        openMorph.influence = openWeight;
    }

    // 多口型扩展（复刻 multiMorph 热路径）
    const morphSet = findAllLipMorphs(morphNames);
    if (morphSet.close) {
        const closeWeight = amplitudeToWeight(1 - amplitude, sensitivity, intensity);
        const closeMorph = morphManager.getTargetByName(morphSet.close);
        if (closeMorph) {
            closeMorph.influence = closeWeight;
        }
    }
    if (morphSet.pucker) {
        const puckerWeight = amplitudeToWeight(amplitude * 0.8, sensitivity, intensity);
        const puckerMorph = morphManager.getTargetByName(morphSet.pucker);
        if (puckerMorph) {
            puckerMorph.influence = puckerWeight;
        }
    }
    if (morphSet.smile) {
        const smileWeight = Math.max(0, openWeight * 0.3 - 0.1);
        const smileMorph = morphManager.getTargetByName(morphSet.smile);
        if (smileMorph) {
            smileMorph.influence = smileWeight;
        }
    }
}

/** 完整感知管线（6 项顺序执行，与 perception.ts observer 一致） */
function runFullPerceptionPipeline(stub: ModelStub, time: number, gazeTarget: Vector3): void {
    benchApplyBreathing(stub, time);
    benchApplyBlinking(stub, time);
    benchApplyMicroExpression(stub, time);
    benchApplyBalanceSway(stub, time);
    benchApplyLipSync(stub);
    benchApplyGaze(stub, gazeTarget);
}

// ── 统计辅助 ──

function percentile(sorted: number[], p: number): number {
    const idx = Math.floor((sorted.length - 1) * (p / 100));
    return sorted[idx];
}

function formatMs(ms: number): string {
    return ms < 1 ? `${(ms * 1000).toFixed(2)}μs` : `${ms.toFixed(3)}ms`;
}

function softAssert(label: string, actualMs: number, budgetMs: number): void {
    if (actualMs > budgetMs) {
        console.warn(`[软断言] ${label}: ${formatMs(actualMs)} > 预算 ${formatMs(budgetMs)}`);
    }
}

// ══════════════════════════════════════════════════════════════
// 测试套件
// ══════════════════════════════════════════════════════════════

test('ADR-155 感知层性能基准', async () => {
    const baseStub = createSyntheticModelStub();
    const totalBones = baseStub.runtimeBones.length;
    expect(totalBones).toBeGreaterThan(0);

    const gazeTarget = new Vector3(0, 5, 10);

    // ── warm-up ──
    for (let f = 0; f < 50; f++) {
        runFullPerceptionPipeline(baseStub, f / 60, gazeTarget);
    }

    console.log('\n=== ADR-155 感知层性能基准 ===');
    console.log(`模型骨骼数: ${totalBones}`);
    console.log(`Morph 目标数: ${baseStub.mesh.morphTargetManager?.numTargets ?? 0}`);

    // ═══════════════════════════════════════════════════════
    // a) 单模型感知层单帧耗时（1000 帧）
    // ═══════════════════════════════════════════════════════
    const samplesA: number[] = [];
    const FRAMES_A = 1000;
    for (let f = 0; f < FRAMES_A; f++) {
        const t0 = performance.now();
        runFullPerceptionPipeline(baseStub, f / 60, gazeTarget);
        const t1 = performance.now();
        samplesA.push(t1 - t0);
    }
    samplesA.sort((a, b) => a - b);
    const p50A = percentile(samplesA, 50);
    const p95A = percentile(samplesA, 95);
    const p99A = percentile(samplesA, 99);

    console.log('\n[a] 单模型感知层单帧耗时（1000 帧）');
    console.log(`  P50: ${formatMs(p50A)}  P95: ${formatMs(p95A)}  P99: ${formatMs(p99A)}`);
    softAssert('单模型 P50', p50A, 0.5);
    softAssert('单模型 P95', p95A, 0.5);

    // ═══════════════════════════════════════════════════════
    // b) N 模型帧时间曲线（1/10/20/50/100 × 100 帧）
    // ═══════════════════════════════════════════════════════
    const modelCounts = [1, 10, 20, 50, 100];
    const FRAMES_B = 100;

    console.log('\n[b] N 模型帧时间曲线（100 帧/点）');
    console.log('  模型数 | P50      | P95      | P99      | 预算');
    console.log('  -------|----------|----------|----------|------');

    for (const n of modelCounts) {
        const stubs: ModelStub[] = [baseStub];
        for (let i = 1; i < n; i++) {
            stubs.push(cloneModelStub(baseStub));
        }

        const samples: number[] = [];
        for (let f = 0; f < FRAMES_B; f++) {
            const t0 = performance.now();
            for (const stub of stubs) {
                runFullPerceptionPipeline(stub, f / 60, gazeTarget);
            }
            const t1 = performance.now();
            samples.push(t1 - t0);
        }
        samples.sort((a, b) => a - b);
        const p50 = percentile(samples, 50);
        const p95 = percentile(samples, 95);
        const p99 = percentile(samples, 99);
        const budget = n * 0.5;
        const ok = p50 <= budget ? '✓' : '✗';

        console.log(
            `  ${String(n).padStart(6)} | ${formatMs(p50).padStart(8)} | ${formatMs(p95).padStart(8)} | ${formatMs(p99).padStart(8)} | ${formatMs(budget)} ${ok}`
        );
    }

    // ═══════════════════════════════════════════════════════
    // c) 各感知项耗时占比（6 项分别测量 × 10000 帧）
    // ═══════════════════════════════════════════════════════
    const ITEMS = [
        { name: 'breathing', fn: (s: ModelStub, t: number) => benchApplyBreathing(s, t) },
        { name: 'blinking', fn: (s: ModelStub, t: number) => benchApplyBlinking(s, t) },
        { name: 'microExpression', fn: (s: ModelStub, t: number) => benchApplyMicroExpression(s, t) },
        { name: 'balanceSway', fn: (s: ModelStub, t: number) => benchApplyBalanceSway(s, t) },
        { name: 'lipSync', fn: (s: ModelStub, _t: number) => benchApplyLipSync(s) },
        { name: 'gaze', fn: (s: ModelStub, _t: number) => benchApplyGaze(s, gazeTarget) },
    ] as const;

    const FRAMES_C = 10000;
    const itemTimes: Record<string, number> = {};
    let totalItemTime = 0;

    for (const item of ITEMS) {
        // 每项独立 warm-up
        for (let f = 0; f < 50; f++) {
            item.fn(baseStub, f / 60);
        }
        const t0 = performance.now();
        for (let f = 0; f < FRAMES_C; f++) {
            item.fn(baseStub, f / 60);
        }
        const t1 = performance.now();
        const total = t1 - t0;
        itemTimes[item.name] = total;
        totalItemTime += total;
    }

    console.log('\n[c] 各感知项耗时占比（10000 帧累计）');
    console.log('  感知项            | 累计(ms) | 占比(%)  | 每帧(μs)');
    console.log('  ------------------|----------|----------|----------');
    for (const item of ITEMS) {
        const total = itemTimes[item.name];
        const pct = (total / totalItemTime) * 100;
        const perFrame = (total / FRAMES_C) * 1000;
        console.log(
            `  ${item.name.padEnd(17)} | ${total.toFixed(2).padStart(8)} | ${pct.toFixed(1).padStart(8)} | ${perFrame.toFixed(2).padStart(8)}`
        );
    }
    console.log(`  ${'合计'.padEnd(17)} | ${totalItemTime.toFixed(2).padStart(8)} | ${'100.0'.padStart(8)} | ${((totalItemTime / FRAMES_C) * 1000).toFixed(2).padStart(8)}`);

    // ═══════════════════════════════════════════════════════
    // d) 100 模型感知层 < 16.67ms（60fps 预算，软断言 warn）
    // ═══════════════════════════════════════════════════════
    const N_D = 100;
    const FRAMES_D = 100;
    const stubsD: ModelStub[] = [baseStub];
    for (let i = 1; i < N_D; i++) {
        stubsD.push(cloneModelStub(baseStub));
    }

    const samplesD: number[] = [];
    for (let f = 0; f < FRAMES_D; f++) {
        const t0 = performance.now();
        for (const stub of stubsD) {
            runFullPerceptionPipeline(stub, f / 60, gazeTarget);
        }
        const t1 = performance.now();
        samplesD.push(t1 - t0);
    }
    samplesD.sort((a, b) => a - b);
    const p50D = percentile(samplesD, 50);
    const p95D = percentile(samplesD, 95);

    console.log('\n[d] 100 模型感知层帧时间（100 帧）');
    console.log(`  P50: ${formatMs(p50D)}  P95: ${formatMs(p95D)}  预算: 16.67ms (60fps)`);
    softAssert('100 模型 P50', p50D, 16.67);
    softAssert('100 模型 P95', p95D, 16.67);

    console.log('\n=== ADR-155 基准完成 ===\n');

    // 硬断言：至少模型加载成功且骨骼数 > 0
    expect(totalBones).toBeGreaterThan(0);
}, 180_000);
