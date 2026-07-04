// [doc:architecture] Procedural Motion — 程序化动作系统
// 规范文档: docs/architecture.md §程序化动作
// 职责: Idle / Auto Dance 状态管理、VMD 生成调度、节拍联动、视线追踪实时叠加

import {
    ProcMotionState,
    ProcMotionMode,
    ProcMotionBoneCategory,
    DEFAULT_PROC_STATE,
    generateIdleVmd,
    generateAutoDanceVmd,
    shouldAutoDance,
    shouldIdle,
} from '../../motion/procedural-motion';
import { BeatDetector } from '../../motion/beat-detector';
import { mmdRuntime, triggerAutoSave, focusedModelId } from '../../core/config';
import { isAudioPlaying } from '../../outfit/audio';
import { modelManager, focusedMmdModel, focusedModel, loadVMDMotion, scene } from '../scene';
import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

let procState: ProcMotionState = { ...DEFAULT_PROC_STATE };
let procBeatDetector: BeatDetector | null = null;
let _procVmdActive = false;
let lastBeatBpm = 120;
let procStarting = false;
let procActiveKind: ProcMotionMode = 'idle';
let procModelId: string | null = null;

// ── 对象池（避免每帧 new Vector3/Matrix/Quaternion，消除 GC 压力） ──
const _v3Pool = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const _mPool = [new Matrix(), new Matrix(), new Matrix(), new Matrix(), new Matrix(), new Matrix(), new Matrix(), new Matrix()];
const _qPool = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
let _v3Idx = 0, _mIdx = 0, _qIdx = 0;
function _v3(): Vector3 { return _v3Pool[_v3Idx++ % _v3Pool.length]; }
function _m(): Matrix { return _mPool[_mIdx++ % _mPool.length]; }
function _q(): Quaternion { return _qPool[_qIdx++ % _qPool.length]; }

// ── 运行时类型检测 ──
// WASM 版 MmdWasmRuntimeBone 没有 updateWorldMatrix 方法，worldMatrix 是 frontBuffer 切片视图
// JS 版 MmdRuntimeBone 有 updateWorldMatrix 方法
// 用此检测决定 gaze observer 走哪条路径
function _isWasmRuntime(bone: IMmdRuntimeBone): boolean {
    return (bone as any).updateWorldMatrix === undefined;
}

// ── WASM 模式辅助：把 Matrix 写回 Float32Array(16) ──
function _writeMatToBuffer(buf: Float32Array, m: Matrix): void {
    const a = m.asArray();
    for (let i = 0; i < 16; ++i) buf[i] = a[i];
}

// ── WASM 模式辅助：递归传播子骨骼 worldMatrix ──
// Babylon.js 矩阵乘法语义：A.multiplyToRef(B, R) ⇒ R = A × B
// 行向量约定 v' = v × M，所以 "先 parent 再 child" 的合成 = childLocal × parentWorld
//
// 数学推导：
//   childWorld = childLocal × parentWorld
//   childLocal = childWorld × parentWorld⁻¹ = childOldMat × parentOldInv
//   childNewWorld = childLocal × parentNewMat = localMat × parentNewMat
function _propagateChildrenWasm(
    parent: IMmdRuntimeBone,
    parentOldMat: Matrix,
    parentNewMat: Matrix
): void {
    const parentOldInv = new Matrix().copyFrom(parentOldMat);
    parentOldInv.invert();
    for (const child of parent.childBones) {
        const childBuf = (child as any).worldMatrix as Float32Array;
        if (!childBuf) continue;
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
const EYE_SMOOTH = 0.35; // 指数平滑系数（0=完全平滑，1=无平滑）

// ── 眼部跟随（眼球追踪，每帧执行） ──
let _headTrackingObserver: any = null;

/** 注销视线追踪 observer。 */
function _teardownGazeTracking(): void {
    if (_headTrackingObserver) {
        scene.onBeforeRenderObservable.remove(_headTrackingObserver);
        _headTrackingObserver = null;
    }
    for (const k in _prevEyeState) delete _prevEyeState[k];
}

/** 注册眼部跟随 + 头部跟随（独立 observer，实时骨骼叠加）。 */
function _setupGazeTracking(): void {
    _teardownGazeTracking();
    const inst = procModelId ? modelManager.get(procModelId) : null;
    const mmdModel = inst?.mmdModel;
    if (!mmdModel) return;

    // 查找头骨和眼球骨骼（runtimeBone）
    const headRuntime = mmdModel.runtimeBones.find(
        b => b.name === '頭' || b.name === 'head' || b.name === 'Head'
    );
    const eyeRuntimes: IMmdRuntimeBone[] = mmdModel.runtimeBones.filter(
        b => ['右目','左目','Eye_R','Eye_L','eye_r','eye_l','RightEye','LeftEye'].includes(b.name)
    );
    console.log(`[gaze:collect] eyeRuntimes=${eyeRuntimes.length} names=[${eyeRuntimes.map(b => b.name).join(',')}]`);

    const needHead = procState.headTrackingEnabled && headRuntime;
    const needEye = procState.eyeTrackingEnabled && eyeRuntimes.length > 0;
    if (!needHead && !needEye) return;

    // ── gaze observer：分 WASM / JS 两路 ──
    // WASM 版：worldMatrix 是 frontBuffer 切片视图，直接覆写 + 递归传播子骨骼
    // JS 版：改 linkedBone.rotationQuaternion + 手动 updateWorldMatrix 重算骨骼链
    // observer 注册在 onBeforeRenderObservable，且在 mmdRuntime.afterPhysics 之后跑，
    // 因此读到的是本帧 WASM 已计算完成的 frontBuffer
    const isWasm = _isWasmRuntime(headRuntime ?? eyeRuntimes[0]);
    _headTrackingObserver = scene.onBeforeRenderObservable.add(() => {
        if (!_procVmdActive) return;
        // 防御：模型已被移除时 mmdModel.mesh/metadata 可能为 null
        if (!mmdModel?.mesh?.metadata) return;
        const cam = scene.activeCamera;
        if (!cam) return;

        if (isWasm) {
            // ═══ WASM 模式：直接覆写 frontBuffer worldMatrix ═══
            // 注意：所有读取必须先 copyFrom 快照，避免读到半写状态

            // 步骤1：头部跟随
            if (needHead && headRuntime) {
                const headBuf = (headRuntime as any).worldMatrix as Float32Array;
                const oldHeadMat = _m().copyFrom(Matrix.FromArray(headBuf));
                const headPos = oldHeadMat.getTranslation();
                const oldHeadRotQ = _q().copyFrom(Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix()));

                // lookDir = 头部→相机方向（模型面朝方向，与最初稳定版本一致）
                // FromLookDirectionRH 的 forward 语义是"相机朝向" = cam→head = -lookDir
                // 但之前用 lookDir = headPos - cam.pos 配合 FromLookDirectionRH 工作正常，
                // 说明 RH 内部处理了方向，保持与稳定版本一致即可
                const lookDir = headPos.subtractToRef(cam.position, _v3());
                const lookLen = Math.sqrt(lookDir.x * lookDir.x + lookDir.y * lookDir.y + lookDir.z * lookDir.z);
                if (lookLen > 0.0001) {
                    lookDir.scaleInPlace(1 / lookLen);
                    // 用 FromLookDirectionRH 算目标朝向（yaw/pitch 自动解耦的稳定实现）
                    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

                    const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, targetWorldQ, 0.5));

                    // 新 worldMatrix = Compose(scale=One, rotation=blended, translation=headPos)
                    const newHeadMat = _m().copyFrom(Matrix.Compose(Vector3.One(), blended, headPos));
                    _writeMatToBuffer(headBuf, newHeadMat);

                    // 递归传播子骨骼（眼骨/眉毛等跟随头部）
                    _propagateChildrenWasm(headRuntime, oldHeadMat, newHeadMat);
                }
            }

            // [对比诊断] 仅头部跟随时的眼骨状态（每 60 帧打印一次）
            if (needHead && !needEye && eyeRuntimes.length > 0) {
                if ((globalThis as any).__gazeCmpFrame === undefined) (globalThis as any).__gazeCmpFrame = 0;
                const cf = (globalThis as any).__gazeCmpFrame = ((globalThis as any).__gazeCmpFrame + 1) % 60;
                if (cf === 0) {
                    const headBuf = (headRuntime as any).worldMatrix as Float32Array;
                    const headYaw = Math.atan2(-headBuf[8], headBuf[0]) * 180 / Math.PI;
                    console.log(`[gaze:cmp-head-only] headYaw=${headYaw.toFixed(1)}°`);
                    for (const eyeRb of eyeRuntimes) {
                        const eb = (eyeRb as any).worldMatrix as Float32Array;
                        const eyeYaw = Math.atan2(-eb[8], eb[0]) * 180 / Math.PI;
                        const eyePitch = Math.asin(Math.max(-1, Math.min(1, eb[9]))) * 180 / Math.PI;
                        console.log(`[gaze:cmp-head-only] ${eyeRb.name} eyeYaw=${eyeYaw.toFixed(1)}° eyePitch=${eyePitch.toFixed(1)}° eyeT=[${eb[12].toFixed(2)},${eb[13].toFixed(2)},${eb[14].toFixed(2)}]`);
                    }
                }
            }

            // 步骤2：眼球跟随（Slerp 朝向目标：左右眼共用同一 targetWorldQ）
            // 用双眼中心点算 lookDir，左右眼共用同一目标朝向，各自从当前朝向 Slerp 过去。
            // 保证平行注视 + 视觉对称，避免会聚角过大。
            if (needEye) {
                // 双眼中心点（左/右目世界位置的中点）
                const eyeCenter = _v3();
                for (const eyeRb of eyeRuntimes) {
                    const eb = (eyeRb as any).worldMatrix as Float32Array;
                    eyeCenter.x += eb[12];
                    eyeCenter.y += eb[13];
                    eyeCenter.z += eb[14];
                }
                eyeCenter.scaleInPlace(1 / eyeRuntimes.length);

                // 统一目标朝向（从双眼中心朝向相机）
                const lookDir = eyeCenter.subtractToRef(cam.position, _v3());
                if (lookDir.lengthSquared() >= 0.0001) {
                    lookDir.normalize();
                    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

                    for (const eyeRb of eyeRuntimes) {
                        const eyeBuf = (eyeRb as any).worldMatrix as Float32Array;
                        const eyeMat = _m().copyFrom(Matrix.FromArray(eyeBuf));
                        const eyePos = eyeMat.getTranslation();
                        const curEyeQ = _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));

                        // Slerp 朝向目标（与头部跟随同款逻辑，平滑系数一致）
                        const newEyeQ = _q().copyFrom(Quaternion.Slerp(curEyeQ, targetWorldQ, EYE_SMOOTH));

                        const newEyeMat = _m().copyFrom(Matrix.Compose(Vector3.One(), newEyeQ, eyePos));
                        _writeMatToBuffer(eyeBuf, newEyeMat);

                        // 眼骨一般无子骨骼，但保持一致
                        _propagateChildrenWasm(eyeRb, eyeMat, newEyeMat);
                    }

                    // [诊断] 每 60 帧打印一次
                    if ((globalThis as any).__gazeEyeFrame === undefined) (globalThis as any).__gazeEyeFrame = 0;
                    const ef = (globalThis as any).__gazeEyeFrame = ((globalThis as any).__gazeEyeFrame + 1) % 60;
                    if (ef === 0) {
                        const tYaw = Math.atan2(-lookDir.x, -lookDir.z) * 180 / Math.PI;
                        for (const eyeRb of eyeRuntimes) {
                            const eb = (eyeRb as any).worldMatrix as Float32Array;
                            const fbYaw = Math.atan2(-eb[8], eb[0]) * 180 / Math.PI;
                            const fbPitch = Math.asin(Math.max(-1, Math.min(1, eb[9]))) * 180 / Math.PI;
                            console.log(`[gaze:cmp-eye-only] ${eyeRb.name} targetYaw=${tYaw.toFixed(1)}° fbYaw=${fbYaw.toFixed(1)}° fbPitch=${fbPitch.toFixed(1)}° eyeT=[${eb[12].toFixed(2)},${eb[13].toFixed(2)},${eb[14].toFixed(2)}]`);
                        }
                    }
                }
            }
        } else {
            // ═══ JS 模式：改 linkedBone.rotationQuaternion + updateWorldMatrix ═══
            //（原逻辑，调试用，WASM 双缓冲下无效）

            // 步骤1：头部跟随
            if (needHead && headRuntime) {
                const headPos = _v3();
                headRuntime.getWorldTranslationToRef(headPos);
                const oldHeadMat = _m().copyFrom(Matrix.FromArray(headRuntime.worldMatrix));
                const oldHeadRotQ = _q().copyFrom(Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix()));
                // lookDir = 头部→相机（与 WASM 模式一致）
                const lookDir = headPos.subtractToRef(cam.position, _v3()).normalize();
                const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));
                const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, targetWorldQ, 0.5));

                const parentBone = headRuntime.parentBone;
                let parentWorldInv = _m();
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
                    (rb as any).updateWorldMatrix?.(false, false);
                    for (const child of rb.childBones) {
                        updateBoneChain(child);
                    }
                };
                updateBoneChain(headRuntime);
            }

            // 步骤2：眼球跟随（Slerp 朝向目标：与 WASM 模式一致，双眼中心点算 lookDir）
            if (needEye) {
                const eyeCenter = _v3();
                for (const eyeRb of eyeRuntimes) {
                    const eb = (eyeRb as any).worldMatrix as Float32Array;
                    eyeCenter.x += eb[12];
                    eyeCenter.y += eb[13];
                    eyeCenter.z += eb[14];
                }
                eyeCenter.scaleInPlace(1 / eyeRuntimes.length);

                const lookDir = eyeCenter.subtractToRef(cam.position, _v3());
                if (lookDir.lengthSquared() >= 0.0001) {
                    lookDir.normalize();
                    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

                    for (const eyeRb of eyeRuntimes) {
                        const eyeMat = _m().copyFrom(Matrix.FromArray(eyeRb.worldMatrix));
                        const curWorldQ = _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));
                        const newWorldQ = _q().copyFrom(Quaternion.Slerp(curWorldQ, targetWorldQ, EYE_SMOOTH));

                        const parentBone = eyeRb.parentBone;
                        let parentWorldInv = _m();
                        if (parentBone) {
                            const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
                            parentMat.invertToRef(parentWorldInv);
                        } else {
                            Matrix.IdentityToRef(parentWorldInv);
                        }
                        const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
                        const localQ = _q();
                        parentInvQ.multiplyToRef(newWorldQ, localQ);
                        eyeRb.linkedBone.rotationQuaternion = localQ;

                        (eyeRb as any).updateWorldMatrix?.(false, false);
                    }
                }
            }
        }

        // 触发 skeleton 重算，把新 worldMatrix 刷到渲染矩阵
        const skeleton = (mmdModel.mesh.metadata as any).skeleton;
        skeleton?._markAsDirty?.();
    }, undefined, false);

    console.log(`[proc-motion] 视线追踪: 眼=${procState.eyeTrackingEnabled} 头=${procState.headTrackingEnabled}`);
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
    console.log(`[proc-motion] bones: [${boneNames.slice(0, 10).join(', ')}${boneNames.length > 10 ? '...' : ''}]`);
    console.log(`[proc-motion] morphs: [${morphNames.slice(0, 5).join(', ')}${morphNames.length > 5 ? '...' : ''}]`);
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
            targetMode === 'autodance' && bpmValid ? 'AutoDance' : 'IdleMotion'
        );

        // Issue #3: 验证焦点模型是否在异步期间被切换
        const currentId = focusedModelId ?? null;
        // Issue #4: 验证异步期间用户是否加载了真实 VMD（竞态时序保护）
        // 对比 vmdData 与当前生成的 buf：若不同且非空，说明用户加载了其他 VMD
        const curInst = modelManager.get(modelIdAtStart);
        const vmdDataAfter = curInst?.vmdData;
        const userVmdDuringAsync = vmdDataAfter !== buf && vmdDataAfter !== null && vmdDataAfter !== undefined;
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
    const bt = { ...procState.boneToggles };
    bt[cat] = v;
    procState = { ...procState, boneToggles: bt };
    triggerAutoSave();
}

/** 批量设置微动效果开关 */
export function setProcMotionBoneToggles(bt: Partial<Record<ProcMotionBoneCategory, boolean>>): void {
    procState = { ...procState, boneToggles: { ...procState.boneToggles, ...bt } };
    triggerAutoSave();
}

export function setProcMotionVpdApplyEnabled(v: boolean): void {
    procState = { ...procState, vpdApplyEnabled: v };
    triggerAutoSave();
}

export function setProcMotionInterpOverride(v: ProcMotionState['interpOverride']): void {
    procState = { ...procState, interpOverride: v };
    triggerAutoSave();
}

/** 设置 BPM 量化开关（通过 BeatDetector 实例） */
export function setBpmQuantizeEnabled(v: boolean): void {
    if (procBeatDetector) {
        procBeatDetector.setBpmQuantizeEnabled(v);
    }
}

export function getBpmQuantizeEnabled(): boolean {
    return procBeatDetector?.getBpmQuantizeEnabled() ?? true;
}

/** 设置眼部跟随开关（实时效果，不重新生成 VMD）。 */
export function setProcMotionEyeTrackingEnabled(v: boolean): void {
    procState = { ...procState, eyeTrackingEnabled: v };
    triggerAutoSave();
    // 重新启动视线追踪（会先 teardown）
    if (_procVmdActive) {
        _teardownGazeTracking();
        _setupGazeTracking();
    }
}

/** 设置头部跟随开关（实时效果，不重新生成 VMD）。 */
export function setProcMotionHeadTrackingEnabled(v: boolean): void {
    procState = { ...procState, headTrackingEnabled: v };
    triggerAutoSave();
    // 重新启动视线追踪（会先 teardown）
    if (_procVmdActive) {
        _teardownGazeTracking();
        _setupGazeTracking();
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
    const mode = procState.mode === 'autodance' ? ('autodance' as const) : ('idle' as const);
    // Issue #5: procBeatDetector 可能为 null
    const bpm = procBeatDetector?.getBPM() ?? 120;
    startProcMotion(mode, mode === 'autodance' ? bpm : undefined);
}
