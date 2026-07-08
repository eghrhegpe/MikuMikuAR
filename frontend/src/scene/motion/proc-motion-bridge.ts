// [doc:architecture] Procedural Motion — 程序化动作系统
// 规范文档: docs/architecture.md §程序化动作
// 职责: Idle / Auto Dance 状态管理、VMD 生成调度、节拍联动、视线追踪实时叠加

import {
    ProcMotionState,
    ProcMotionMode,
    ProcMotionBoneCategory,
    PROC_MOTION_BONE_CATEGORIES,
    DEFAULT_PROC_STATE,
    generateIdleVmd,
    generateAutoDanceVmd,
    generateLifelikeVmd,
    shouldAutoDance,
    shouldIdle,
    PROC_VMD_NAME_IDLE,
    PROC_VMD_NAME_AUTODANCE,
    PROC_VMD_NAME_LIFELIKE,
} from '@/motion-algos/procedural-motion';
import { BeatDetector } from '@/motion-algos/beat-detector';
import { mmdRuntime, triggerAutoSave, focusedModelId } from '@/core/config';
import { isAudioPlaying } from '@/outfit/audio';
import { modelManager, focusedMmdModel, focusedModel, loadVMDMotion, scene } from '../scene';
import { addVmdLayer, removeVmdLayer, getVmdLayers, clearVmdLayers } from './vmd-layers';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Matrix } from '@babylonjs/core/Maths/math';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { Camera } from '@babylonjs/core/Cameras/camera';

// ── WASM/JS 运行时差异的本地类型声明 ──
// babylon-mmd 的 IMmdRuntimeBone 接口未声明 worldMatrix 和 updateWorldMatrix，
// 但 WASM 与 JS 运行时在运行时均提供这些成员。
export interface MmdRuntimeBoneExtended extends IMmdRuntimeBone {
    worldMatrix: Float32Array;
    updateWorldMatrix(updateAbsoluteTransform: boolean, updateLocalTransform: boolean): void;
}

interface MeshMetadata {
    skeleton?: { _markAsDirty?(): void };
}
import { isARActive } from '../ar/ar-camera';

let procState: ProcMotionState = { ...DEFAULT_PROC_STATE };
let procBeatDetector: BeatDetector | null = null;
let _procVmdActive = false;
let lastBeatBpm = 120;
let procStarting = false;
let _regeneratePending = false;
let procActiveKind: ProcMotionMode = 'idle';
let procModelId: string | null = null;

// ── 对象池（避免每帧 new Vector3/Matrix/Quaternion，消除 GC 压力） ──
const _v3Pool = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
];
const _mPool = [
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
];
const _qPool = [
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
];
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

export function _isWasmRuntime(bone: IMmdRuntimeBone): boolean {
    return !('updateWorldMatrix' in bone);
}

// ── 眼球追踪平滑系数（0=完全平滑，1=无平滑） ──
const EYE_SMOOTH = 0.35;

export interface GazeConfig {
    headEnabled: boolean;
    eyeEnabled: boolean;
}

export function applyGazeWasm(
    bones: readonly IMmdRuntimeBone[],
    cam: Camera,
    config: GazeConfig
): void {
    if (!config.headEnabled && !config.eyeEnabled) return;

    const headRuntime = bones.find((b) => b.name === '頭' || b.name === '首');
    const eyeRuntimes = bones.filter((b) => b.name.includes('目'));
    const needHead = config.headEnabled && !!headRuntime;
    const needEye = config.eyeEnabled && eyeRuntimes.length > 0;

    if (!needHead && !needEye) return;

    const gazeTarget = _getGazeTarget(cam, _v3());

    if (needHead && headRuntime) {
        const headBuf = (headRuntime as MmdRuntimeBoneExtended).worldMatrix;
        const oldHeadMat = _m().copyFrom(Matrix.FromArray(headBuf));
        const headPos = oldHeadMat.getTranslation();
        const oldHeadRotQ = _q().copyFrom(
            Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix())
        );

        const lookDir = headPos.subtractToRef(gazeTarget, _v3());
        const lookLen = Math.sqrt(
            lookDir.x * lookDir.x + lookDir.y * lookDir.y + lookDir.z * lookDir.z
        );
        if (lookLen > 0.0001) {
            lookDir.scaleInPlace(1 / lookLen);
            const targetWorldQ = _q().copyFrom(
                Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly)
            );

            const blended = _q().copyFrom(
                Quaternion.Slerp(oldHeadRotQ, targetWorldQ, 0.5)
            );

            const newHeadMat = _m().copyFrom(
                Matrix.Compose(Vector3.One(), blended, headPos)
            );
            _writeMatToBuffer(headBuf, newHeadMat);

            _propagateChildrenWasm(headRuntime, oldHeadMat, newHeadMat);
        }
    }

    if (needEye) {
        const eyeCenter = _v3();
        for (const eyeRb of eyeRuntimes) {
            const eb = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
            eyeCenter.x += eb[12];
            eyeCenter.y += eb[13];
            eyeCenter.z += eb[14];
        }
        eyeCenter.scaleInPlace(1 / eyeRuntimes.length);

        const lookDir = eyeCenter.subtractToRef(gazeTarget, _v3());
        if (lookDir.lengthSquared() >= 0.0001) {
            lookDir.normalize();
            const targetWorldQ = _q().copyFrom(
                Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly)
            );

            for (const eyeRb of eyeRuntimes) {
                const eyeBuf = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
                const eyeMat = _m().copyFrom(Matrix.FromArray(eyeBuf));
                const eyePos = eyeMat.getTranslation();
                const curEyeQ = _q().copyFrom(
                    Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix())
                );

                const newEyeQ = _q().copyFrom(
                    Quaternion.Slerp(curEyeQ, targetWorldQ, EYE_SMOOTH)
                );

                const newEyeMat = _m().copyFrom(
                    Matrix.Compose(Vector3.One(), newEyeQ, eyePos)
                );
                _writeMatToBuffer(eyeBuf, newEyeMat);

                _propagateChildrenWasm(eyeRb, eyeMat, newEyeMat);
            }
        }
    }
}

// ── Gaze 目标点计算 ──
// AR 模式下：目标从相机位置重定向为「相机朝向 + 估算用户距离 1.5m」，增强眼神接触
// 非 AR 模式下：目标就是相机位置（原有行为）
const AR_GAZE_DISTANCE = 1.5; // 估算用户到屏幕的距离（米）

function _getGazeTarget(cam: Camera, out: Vector3): Vector3 {
    if (isARActive()) {
        // AR 模式：视线目标 = 相机位置 + 相机朝向 × 估算距离
        // 这样模型会看向"屏幕前方的用户"而非"相机位置"，增强眼神接触
        const forward = cam.getDirection(Vector3.Forward());
        out.copyFrom(cam.position);
        out.addInPlace(forward.scale(AR_GAZE_DISTANCE));
        return out;
    }
    out.copyFrom(cam.position);
    return out;
}

// ── WASM 模式辅助：把 Matrix 写回 Float32Array(16) ──
export function _writeMatToBuffer(buf: Float32Array, m: Matrix): void {
    const a = m.asArray();
    for (let i = 0; i < 16; ++i) {
        buf[i] = a[i];
    }
}

// ── WASM 模式辅助：递归传播子骨骼 worldMatrix ──
// Babylon.js 矩阵乘法语义：A.multiplyToRef(B, R) ⇒ R = A × B
// 行向量约定 v' = v × M，所以 "先 parent 再 child" 的合成 = childLocal × parentWorld
//
// 数学推导：
//   childWorld = childLocal × parentWorld
//   childLocal = childWorld × parentWorld⁻¹ = childOldMat × parentOldInv
//   childNewWorld = childLocal × parentNewMat = localMat × parentNewMat
export function _propagateChildrenWasm(
    parent: IMmdRuntimeBone,
    parentOldMat: Matrix,
    parentNewMat: Matrix
): void {
    const parentOldInv = new Matrix().copyFrom(parentOldMat);
    parentOldInv.invert();
    for (const child of parent.childBones) {
        const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
        if (!childBuf) {
            continue;
        }
        const childOldMat = Matrix.FromArray(childBuf);
        // localMat = childOldMat × parentOldInv （子→父空间）
        const localMat = new Matrix();
        childOldMat.multiplyToRef(parentOldInv, localMat);
        // childNewMat = localMat × parentNewMat （父空间→新世界）
        const childNewMat = new Matrix();
        localMat.multiplyToRef(parentNewMat, childNewMat);
        _writeMatToBuffer(childBuf, childNewMat);
        _propagateChildrenWasm(child, childOldMat, childNewMat);
    }
}

// ── 眼球追踪平滑状态（按眼骨名独立存储，避免左右眼互相污染） ──
const _prevEyeState: Record<string, { yaw: number; pitch: number }> = {};

// ── 眼部跟随（眼球追踪，每帧执行） ──
let _headTrackingObserver: any = null;

/** 注销视线追踪 observer。 */
function _teardownGazeTracking(): void {
    if (_headTrackingObserver) {
        scene.onBeforeRenderObservable.remove(_headTrackingObserver);
        _headTrackingObserver = null;
    }
    for (const k in _prevEyeState) {
        delete _prevEyeState[k];
    }
}

/** 注册眼部跟随 + 头部跟随（独立 observer，实时骨骼叠加）。 */
function _setupGazeTracking(): void {
    _teardownGazeTracking();
    const modelId = procModelId ?? focusedModelId;
    const inst = modelId ? modelManager.get(modelId) : null;
    const mmdModel = inst?.mmdModel;
    if (!mmdModel) {
        return;
    }

    // 查找头骨和眼球骨骼（runtimeBone）
    const headRuntime = mmdModel.runtimeBones.find(
        (b) => b.name === '頭' || b.name === 'head' || b.name === 'Head'
    );
    const eyeRuntimes: IMmdRuntimeBone[] = mmdModel.runtimeBones.filter((b) =>
        ['右目', '左目', 'Eye_R', 'Eye_L', 'eye_r', 'eye_l', 'RightEye', 'LeftEye'].includes(b.name)
    );
    console.log(
        `[gaze:collect] eyeRuntimes=${eyeRuntimes.length} names=[${eyeRuntimes.map((b) => b.name).join(',')}]`
    );

    const needHead = procState.headTrackingEnabled && headRuntime;
    const needEye = procState.eyeTrackingEnabled && eyeRuntimes.length > 0;
    if (!needHead && !needEye) {
        return;
    }

    const isWasm = _isWasmRuntime(headRuntime ?? eyeRuntimes[0]);

    if (isWasm) {
        // WASM 模式：同步配置到 blender（若有图层混合时由 blender 统一调度），
        // 同时注册独立 WASM gaze observer 确保无 blender 时仍生效。
        // 双重 gaze（observer + blender._applyGazeIfEnabled）无害——
        // 都调用 applyGazeWasm 向同一目标 Slerp，不会累积错误。
        const gazeConfig: GazeConfig = {
            headEnabled: procState.headTrackingEnabled,
            eyeEnabled: procState.eyeTrackingEnabled,
        };
        if (modelId) {
            import('./wasm-layers-blender')
                .then((m) => {
                    m.setWasmLayersGazeConfig(modelId!, gazeConfig);
                })
                .catch(() => {
                    // blender 未激活，忽略
                });
        }

        // 独立 WASM gaze observer：直写 frontBuffer，不依赖 _procVmdActive
        const capturedModelId = modelId;
        _headTrackingObserver = scene.onBeforeRenderObservable.add(() => {
            if (!capturedModelId) return;
            const inst = modelManager.get(capturedModelId);
            if (!inst?.mmdModel) return;
            const cam = scene.activeCamera;
            if (!cam) return;
            applyGazeWasm(inst.mmdModel.runtimeBones, cam, gazeConfig);
        });

        console.log(
            `[proc-motion] 视线追踪: WASM 模式独立 observer 眼=${procState.eyeTrackingEnabled} 头=${procState.headTrackingEnabled}`
        );
        return;
    }

    _headTrackingObserver = scene.onBeforeRenderObservable.add(
        () => {
            if (!mmdModel?.mesh?.metadata) {
                return;
            }
            const cam = scene.activeCamera;
            if (!cam) {
                return;
            }
            const gazeTarget = _getGazeTarget(cam, _v3());

            // ═══ JS 模式：改 linkedBone.rotationQuaternion + updateWorldMatrix ═══
            if (needHead && headRuntime) {
                const headPos = _v3();
                headRuntime.getWorldTranslationToRef(headPos);
                const oldHeadMat = _m().copyFrom(Matrix.FromArray(headRuntime.worldMatrix));
                const oldHeadRotQ = _q().copyFrom(
                    Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix())
                );
                const lookDir = headPos.subtractToRef(gazeTarget, _v3()).normalize();
                const targetWorldQ = _q().copyFrom(
                    Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly)
                );
                const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, targetWorldQ, 0.5));

                const parentBone = headRuntime.parentBone;
                const parentWorldInv = _m();
                if (parentBone) {
                    const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
                    parentMat.invertToRef(parentWorldInv);
                } else {
                    Matrix.IdentityToRef(parentWorldInv);
                }
                const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
                const localQ = _q();
                parentInvQ.multiplyToRef(blended, localQ);
                headRuntime.linkedBone.rotationQuaternion = localQ;

                const updateBoneChain = (rb: IMmdRuntimeBone) => {
                    (rb as MmdRuntimeBoneExtended).updateWorldMatrix?.(false, false);
                    for (const child of rb.childBones) {
                        updateBoneChain(child);
                    }
                };
                updateBoneChain(headRuntime);
            }

            if (needEye) {
                const eyeCenter = _v3();
                for (const eyeRb of eyeRuntimes) {
                    const eb = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
                    eyeCenter.x += eb[12];
                    eyeCenter.y += eb[13];
                    eyeCenter.z += eb[14];
                }
                eyeCenter.scaleInPlace(1 / eyeRuntimes.length);

                const lookDir = eyeCenter.subtractToRef(gazeTarget, _v3());
                if (lookDir.lengthSquared() >= 0.0001) {
                    lookDir.normalize();
                    const targetWorldQ = _q().copyFrom(
                        Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly)
                    );

                    for (const eyeRb of eyeRuntimes) {
                        const eyeMat = _m().copyFrom(Matrix.FromArray(eyeRb.worldMatrix));
                        const curWorldQ = _q().copyFrom(
                            Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix())
                        );
                        const newWorldQ = _q().copyFrom(
                            Quaternion.Slerp(curWorldQ, targetWorldQ, EYE_SMOOTH)
                        );

                        const parentBone = eyeRb.parentBone;
                        const parentWorldInv = _m();
                        if (parentBone) {
                            const parentMat = _m().copyFrom(
                                Matrix.FromArray(parentBone.worldMatrix)
                            );
                            parentMat.invertToRef(parentWorldInv);
                        } else {
                            Matrix.IdentityToRef(parentWorldInv);
                        }
                        const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
                        const localQ = _q();
                        parentInvQ.multiplyToRef(newWorldQ, localQ);
                        eyeRb.linkedBone.rotationQuaternion = localQ;

                        (eyeRb as MmdRuntimeBoneExtended).updateWorldMatrix?.(false, false);
                    }
                }
            }

            const skeleton = (mmdModel.mesh.metadata as MeshMetadata).skeleton;
            skeleton?._markAsDirty?.();
        },
        undefined,
        false
    );

    console.log(
        `[proc-motion] 视线追踪: JS 模式独立 observer 眼=${procState.eyeTrackingEnabled} 头=${procState.headTrackingEnabled}`
    );
}

/** 只读访问器，外部不可直接修改程序化动作激活状态。 */
export function isProcVmdActive(): boolean {
    return _procVmdActive;
}

export function getProcBeatDetector(): BeatDetector | null {
    return procBeatDetector;
}

export function createProcBeatDetector(): BeatDetector {
    procBeatDetector = new BeatDetector();
    return procBeatDetector;
}

/** 清除模型上的 vmdData/vmdName（两分支复用）。 */
function _clearVmdData(inst: import('../../core/config').ModelInstance | null | undefined): void {
    if (inst) {
        inst.vmdData = null;
        inst.vmdName = '';
    }
}

async function startProcMotion(targetMode: ProcMotionMode, bpm?: number): Promise<void> {
    if (procStarting) {
        return;
    }
    procStarting = true;

    // 保存加载前的模型 ID，防止 await 后焦点切换导致操作错配（Issue #3）
    const modelAtStart = focusedMmdModel();
    const modelIdAtStart = focusedModelId ?? null;
    if (!modelAtStart) {
        procStarting = false;
        return;
    }
    const morphNames = modelAtStart.morph.morphs.map((m) => m.name) ?? [];
    const boneNames = modelAtStart.runtimeBones.map((b) => b.name);
    console.log(
        `[proc-motion] bones: [${boneNames.slice(0, 10).join(', ')}${boneNames.length > 10 ? '...' : ''}]`
    );
    console.log(
        `[proc-motion] morphs: [${morphNames.slice(0, 5).join(', ')}${morphNames.length > 5 ? '...' : ''}]`
    );
    let buf: ArrayBuffer;

    // Issue #2: bpm 无效时降级为 idle，保持状态一致
    const bpmValid = bpm !== null && bpm !== undefined && bpm > 0 && Number.isFinite(bpm);
    if (targetMode === 'autodance' && bpmValid) {
        buf = generateAutoDanceVmd(procState, bpm!, morphNames, boneNames);
        lastBeatBpm = bpm!;
        procActiveKind = 'autodance';
    } else {
        buf = generateIdleVmd(procState, morphNames, boneNames);
        procActiveKind = targetMode === 'autodance' ? 'idle' : targetMode;
    }

    // 【已移除 debug 下载代码】

    _procVmdActive = true;
    procModelId = modelIdAtStart;
    try {
        await loadVMDMotion(
            buf,
            targetMode === 'autodance' && bpmValid ? PROC_VMD_NAME_AUTODANCE : PROC_VMD_NAME_IDLE
        );

        // Issue #3: 验证焦点模型是否在异步期间被切换
        const currentId = focusedModelId ?? null;
        // Issue #4: 验证异步期间用户是否加载了真实 VMD（竞态时序保护）
        // 对比 vmdData 与当前生成的 buf：若不同且非空，说明用户加载了其他 VMD
        const curInst = modelManager.get(modelIdAtStart);
        const vmdDataAfter = curInst?.vmdData;
        const userVmdDuringAsync =
            vmdDataAfter !== buf && vmdDataAfter !== null && vmdDataAfter !== undefined;
        if (currentId !== modelIdAtStart) {
            console.warn('[proc-motion] 异步期间模型焦点已切换，丢弃本次程序化动作结果');
            // 卸载刚加载的程序化动画
            const inst = modelManager.get(currentId);
            if (inst && inst.mmdModel && mmdRuntime) {
                inst.mmdModel.setRuntimeAnimation(null);
            }
            _procVmdActive = false;
            procModelId = null;
            procActiveKind = 'idle';
        } else if (userVmdDuringAsync) {
            // 异步期间用户加载了真实 VMD，不覆盖 vmdData
            console.log('[proc-motion] 异步期间用户加载了 VMD，跳过本次程序化动作');
            _procVmdActive = false;
            procModelId = null;
            procActiveKind = 'idle';
        } else {
            _clearVmdData(focusedModel());
            // 启动视线追踪（实时骨骼叠加，不依赖 VMD 帧）
            _setupGazeTracking();
        }
    } catch {
        _procVmdActive = false;
        _clearVmdData(focusedModel());
    } finally {
        procStarting = false;
        if (_regeneratePending) {
            _regeneratePending = false;
            // Re-trigger with current state
            const mode = procState.mode === 'autodance' ? 'autodance' : 'idle';
            const bpm = procBeatDetector?.getBPM() ?? 120;
            // Only regenerate if still relevant (mode is 'idle'|'autodance' here, never 'off')
            startProcMotion(mode, mode === 'autodance' ? bpm : undefined);
        }
    }
}

export function stopProcMotion(): void {
    _procVmdActive = false;
    _teardownGazeTracking();
    if (procModelId) {
        const inst = modelManager.get(procModelId);
        if (inst && inst.mmdModel && mmdRuntime) {
            inst.mmdModel.setRuntimeAnimation(null);
        }
        procModelId = null;
    }
}

export function onModelRemoved(id: string): void {
    if (procModelId === id) {
        _procVmdActive = false;
        _teardownGazeTracking();
        procModelId = null;
    }
}

export async function updateProcMotion(): Promise<void> {
    if (procState.mode === 'off' && !procState.autoSwitch) {
        if (_procVmdActive) {
            stopProcMotion();
        }
        return;
    }

    // Issue #1: focusedModel() 可能为 null/undefined
    const model = focusedModel();
    const audioOn = isAudioPlaying();
    const hasUserVmd = model?.vmdData !== null && model?.vmdData !== undefined;
    const mode = procState.mode;
    const autoOk = mode !== 'off' || procState.autoSwitch;
    const wantAutoDance = shouldAutoDance(audioOn, mode) && autoOk;
    const wantIdle = shouldIdle(audioOn, hasUserVmd, mode) && autoOk;

    if (hasUserVmd && _procVmdActive) {
        stopProcMotion();
        return;
    }

    if (wantAutoDance && !hasUserVmd && procBeatDetector) {
        const bpm = procBeatDetector.getBPM();
        if (!_procVmdActive || procActiveKind !== 'autodance' || Math.abs(bpm - lastBeatBpm) > 10) {
            await startProcMotion('autodance', bpm);
        }
        return;
    }

    if (wantIdle && !hasUserVmd) {
        if (!_procVmdActive || procActiveKind !== 'idle') {
            await startProcMotion('idle');
        }
        return;
    }
}

export function setProcMotionMode(mode: ProcMotionMode): void {
    procState = { ...procState, mode };
    if (mode === 'off') {
        stopProcMotion();
    }
    triggerAutoSave();
}

export function setProcMotionIntensity(v: number): void {
    procState = { ...procState, intensity: Math.max(0, Math.min(1, v)) };
    triggerAutoSave();
}

export function setProcMotionSpeed(v: number): void {
    procState = { ...procState, speed: Math.max(0.5, Math.min(2, v)) };
    triggerAutoSave();
}

export function setProcMotionAutoSwitch(on: boolean): void {
    procState = { ...procState, autoSwitch: on };
    triggerAutoSave();
}

export function getProcMotionState(): ProcMotionState {
    return { ...procState };
}

/** 设置程序化动作状态（从存储恢复时使用，不触发自动保存以免干扰反序列化）。
 *  外部直接调用此函数时，请确保调用者在合适时机手动触发保存。 */
export function setProcMotionState(s: ProcMotionState): void {
    procState = { ...s };
}

// ======== 新增开关 Getter/Setter（P0/P1） ========

/** 设置单个微动效果的开关 */
export function setProcMotionBoneToggle(cat: ProcMotionBoneCategory, v: boolean): void {
    if (!PROC_MOTION_BONE_CATEGORIES.includes(cat)) {
        console.warn(`[proc-motion] invalid bone category: ${cat}`);
        return;
    }
    if (typeof v !== 'boolean') {
        console.warn('[proc-motion] setProcMotionBoneToggle: invalid value type, expected boolean');
        return;
    }
    const bt = { ...procState.boneToggles };
    bt[cat] = v;
    procState = { ...procState, boneToggles: bt };
    triggerAutoSave();
}

/** 批量设置微动效果开关 */
export function setProcMotionBoneToggles(
    bt: Partial<Record<ProcMotionBoneCategory, boolean>>
): void {
    for (const [k, v] of Object.entries(bt)) {
        if (typeof v !== 'boolean') {
            console.warn(
                `[proc-motion] setProcMotionBoneToggles: invalid value type for key "${k}", expected boolean`
            );
            return;
        }
    }
    procState = { ...procState, boneToggles: { ...procState.boneToggles, ...bt } };
    triggerAutoSave();
}

export function setProcMotionVpdApplyEnabled(v: boolean): void {
    if (typeof v !== 'boolean') {
        console.warn(
            '[proc-motion] setProcMotionVpdApplyEnabled: invalid value type, expected boolean'
        );
        return;
    }
    procState = { ...procState, vpdApplyEnabled: v };
    triggerAutoSave();
}

export function setProcMotionInterpOverride(v: ProcMotionState['interpOverride']): void {
    const valid = ['auto', 'sharp', 'ease-in-out', 'ease-out'] as const;
    if (!valid.includes(v as (typeof valid)[number])) {
        console.warn(`[proc-motion] setProcMotionInterpOverride: invalid value "${v}"`);
        return;
    }
    procState = { ...procState, interpOverride: v };
    triggerAutoSave();
}

/** 设置 BPM 量化开关（通过 BeatDetector 实例） */
export function setBpmQuantizeEnabled(v: boolean): void {
    if (typeof v !== 'boolean') {
        console.warn('[proc-motion] setBpmQuantizeEnabled: invalid value type, expected boolean');
        return;
    }
    if (procBeatDetector) {
        procBeatDetector.setBpmQuantizeEnabled(v);
    }
}

export function getBpmQuantizeEnabled(): boolean {
    return procBeatDetector?.getBpmQuantizeEnabled() ?? true;
}

/** 通用视线/头部追踪设定（重建追踪以应用新值）。 */
function _setGazeTrackingSetting(
    field: 'eyeTrackingEnabled' | 'headTrackingEnabled',
    value: boolean
): void {
    procState = { ...procState, [field]: value };
    triggerAutoSave();
    // 始终重建 gaze，不依赖程序化动作生命周期 —— 允许在仅加载外部 VMD 时生效
    _teardownGazeTracking();
    _setupGazeTracking();
}

/** 设置眼部跟随开关（实时效果，不重新生成 VMD）。 */
export function setProcMotionEyeTrackingEnabled(v: boolean): void {
    _setGazeTrackingSetting('eyeTrackingEnabled', v);
}

/** 设置头部跟随开关（实时效果，不重新生成 VMD）。 */
export function setProcMotionHeadTrackingEnabled(v: boolean): void {
    _setGazeTrackingSetting('headTrackingEnabled', v);
}

let _gazeLayerActive = false;

/** 图层驱动的视线/头部控制。
 *  由 vmd-layers 在调整 gaze 图层时调用。
 *  - intensity > 0 且 active → 启用眼部追踪
 *  - intensity >= 0.5 且 active → 同时启用头部追踪
 *  - 否则禁用两者。
 *  不干涉 _setGazeTrackingSetting 内部重建逻辑。 */
export function setGazeLayerActive(active: boolean, intensity: number): void {
    _gazeLayerActive = active;
    const shouldEnable = active && intensity > 0;
    setProcMotionEyeTrackingEnabled(shouldEnable);
    setProcMotionHeadTrackingEnabled(shouldEnable && intensity >= 0.5);
}

// ======== Lifelike Motion Layer（微动叠加层） ========

let _lifelikeLayerId: string | null = null;

/** 生成 lifelike VMD 并作为图层添加到当前模型。 */
async function _applyLifelikeLayer(): Promise<void> {
    const modelId = focusedModelId;
    if (!modelId) {
        return;
    }
    const inst = modelManager.get(modelId);
    if (!inst?.mmdModel) {
        return;
    }

    // 先移除旧的 lifelike 图层
    if (_lifelikeLayerId) {
        await removeVmdLayer(_lifelikeLayerId, modelId);
        _lifelikeLayerId = null;
    }

    const morphNames = inst.mmdModel.morph.morphs.map((m) => m.name) ?? [];
    const boneNames = inst.mmdModel.runtimeBones.map((b) => b.name);
    const buf = generateLifelikeVmd(procState, morphNames, boneNames);

    const layer = await addVmdLayer(buf, 'Lifelike', modelId, procState.lifelikeIntensity);
    if (layer) {
        _lifelikeLayerId = layer.id;
    }
}

/** 移除 lifelike 图层。 */
async function _removeLifelikeLayer(): Promise<void> {
    if (_lifelikeLayerId) {
        const modelId = focusedModelId;
        if (modelId) {
            await removeVmdLayer(_lifelikeLayerId, modelId);
        }
        _lifelikeLayerId = null;
    }
}

/** 设置 lifelike 开关。 */
export async function setLifelikeEnabled(v: boolean): Promise<void> {
    procState = { ...procState, lifelikeEnabled: v };
    triggerAutoSave();
    if (v) {
        await _applyLifelikeLayer();
    } else {
        await _removeLifelikeLayer();
    }
}

/** 设置 lifelike 强度并重新应用。 */
export async function setLifelikeIntensity(v: number): Promise<void> {
    procState = { ...procState, lifelikeIntensity: Math.max(0, Math.min(1, v)) };
    triggerAutoSave();
    if (procState.lifelikeEnabled) {
        await _applyLifelikeLayer();
    }
}

export function regenerateProcMotion(): void {
    if (!_procVmdActive && procState.mode === 'off') {
        return;
    }
    // 无焦点模型时静默返回，添加警告辅助调试
    if (!focusedMmdModel()) {
        console.warn('[proc-motion] regenerateProcMotion: 无焦点 MMD 模型，跳过');
        return;
    }
    // Issue #4: 如果 regenerate 调用时正在生成，标记 deferred 重跑
    if (procStarting) {
        _regeneratePending = true;
        return;
    }
    const mode = procState.mode === 'autodance' ? ('autodance' as const) : ('idle' as const);
    // Issue #5: procBeatDetector 可能为 null
    const bpm = procBeatDetector?.getBPM() ?? 120;
    startProcMotion(mode, mode === 'autodance' ? bpm : undefined);
}
