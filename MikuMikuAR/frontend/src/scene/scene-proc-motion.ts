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
} from '../motion/procedural-motion';
import { BeatDetector } from '../motion/beat-detector';
import { mmdRuntime, triggerAutoSave, focusedModelId } from '../core/config';
import { isAudioPlaying } from '../outfit/audio';
import { modelManager, focusedMmdModel, focusedModel, loadVMDMotion, scene } from './scene';
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
const _mPool = [new Matrix(), new Matrix(), new Matrix(), new Matrix()];
const _qPool = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
let _v3Idx = 0, _mIdx = 0, _qIdx = 0;
function _v3(): Vector3 { return _v3Pool[_v3Idx++ % _v3Pool.length]; }
function _m(): Matrix { return _mPool[_mIdx++ % _mPool.length]; }
function _q(): Quaternion { return _qPool[_qIdx++ % _qPool.length]; }

// ── 眼球追踪平滑状态 ──
let _prevEyeYaw = 0;
let _prevEyePitch = 0;
const EYE_SMOOTH = 0.35; // 指数平滑系数（0=完全平滑，1=无平滑）

// ── 眼部跟随（眼球追踪，每帧执行） ──
let _headTrackingObserver: any = null;

/** 注销视线追踪 observer。 */
function _teardownGazeTracking(): void {
    if (_headTrackingObserver) {
        scene.onBeforeRenderObservable.remove(_headTrackingObserver);
        _headTrackingObserver = null;
    }
    _prevEyeYaw = 0;
    _prevEyePitch = 0;
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

    const needHead = procState.headTrackingEnabled && headRuntime;
    const needEye = procState.eyeTrackingEnabled && eyeRuntimes.length > 0;
    if (!needHead && !needEye) return;

    // ── 单个 gaze observer：改 linkedBone 局部旋转，触发骨骼链重算 ──
    // 关键：不能直接写 worldMatrix（会绕过父子层级，导致子骨骼位置不更新）
    // 正确做法：改 linkedBone.rotationQuaternion，然后手动调 updateWorldMatrix 重算整条骨骼链
    _headTrackingObserver = scene.onBeforeRenderObservable.add(() => {
        if (!_procVmdActive) return;
        const cam = scene.activeCamera;
        if (!cam) return;

        // 步骤1：头部跟随 — 改头骨 linkedBone 的局部旋转
        if (needHead) {
            const headPos = _v3();
            headRuntime!.getWorldTranslationToRef(headPos);
            const oldHeadMat = _m().copyFrom(Matrix.FromArray(headRuntime!.worldMatrix));
            const oldHeadRotQ = _q().copyFrom(Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix()));
            // lookDir = 头部位置 - 相机位置（FromLookDirectionRH 的 forward 是相机朝向，取反让头部朝向相机）
            const lookDir = headPos.subtractToRef(cam.position, _v3()).normalize();
            const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));
            const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, targetWorldQ, 0.3));

            // 计算头骨父骨骼的 worldMatrix 逆，用于把世界旋转转成局部旋转
            const parentBone = headRuntime!.parentBone;
            let parentWorldInv = _m();
            if (parentBone) {
                const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
                parentMat.invertToRef(parentWorldInv);
            } else {
                Matrix.IdentityToRef(parentWorldInv);
            }
            // 局部旋转 = parentWorldInv × worldRotation（注意四元数乘法顺序：左乘父逆）
            const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
            const localQ = _q();
            parentInvQ.multiplyToRef(blended, localQ);
            headRuntime!.linkedBone.rotationQuaternion = localQ;

            // 手动触发头骨及其子骨骼链的 worldMatrix 重算
            // updateWorldMatrix 会基于父骨骼 worldMatrix（已由 runtime 算好）+ 新的 linkedBone 旋转重算
            const updateBoneChain = (rb: IMmdRuntimeBone) => {
                (rb as any).updateWorldMatrix?.(false, false);
                for (const child of rb.childBones) {
                    updateBoneChain(child);
                }
            };
            updateBoneChain(headRuntime!);
        }

        // 步骤2：眼球跟随 — 改眼骨 linkedBone 的局部旋转
        if (needEye) {
            for (const eyeRb of eyeRuntimes) {
                const eyePos = _v3();
                eyeRb.getWorldTranslationToRef(eyePos);
                const toCam = cam.position.subtractToRef(eyePos, _v3());
                if (toCam.lengthSquared() < 0.0001) continue;
                toCam.normalize();

                const eyeMat = _m().copyFrom(Matrix.FromArray(eyeRb.worldMatrix));
                const curWorldQ = _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));
                const curForward = _v3().set(0, 0, 1).rotateByQuaternionToRef(curWorldQ, _v3());

                const dot = Vector3.Dot(curForward, toCam);
                const crossY = curForward.x * toCam.z - curForward.z * toCam.x;
                let deltaYaw = Math.atan2(crossY, dot);
                const horizDist = Math.sqrt(toCam.x * toCam.x + toCam.z * toCam.z);
                let deltaPitch = Math.atan2(toCam.y, horizDist);
                deltaPitch = Math.max(-25*Math.PI/180, Math.min(25*Math.PI/180, deltaPitch));

                _prevEyeYaw += (deltaYaw - _prevEyeYaw) * EYE_SMOOTH;
                _prevEyePitch += (deltaPitch - _prevEyePitch) * EYE_SMOOTH;
                deltaYaw = _prevEyeYaw;
                deltaPitch = _prevEyePitch;

                // 构造世界空间偏移
                const yawQ = Quaternion.RotationAxis(Vector3.UpReadOnly, deltaYaw * 0.7);
                const pitchQ = Quaternion.RotationAxis(Vector3.RightReadOnly, deltaPitch * 0.5);
                const offsetQ = _q();
                yawQ.multiplyToRef(pitchQ, offsetQ);
                const newWorldQ = _q();
                offsetQ.multiplyToRef(curWorldQ, newWorldQ);

                // 世界旋转转局部旋转：localQ = parentWorldInv × worldRot（左乘父逆）
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

                // 重算眼骨 worldMatrix
                (eyeRb as any).updateWorldMatrix?.(false, false);
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
function _clearVmdData(inst: import('../core/config').ModelInstance | null | undefined): void {
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
