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
let _eyeTrackingObserver: any = null;
let _headTrackingObserver: any = null;

/** 注销眼部跟随 + 头部跟随。 */
function _teardownGazeTracking(): void {
    if (_eyeTrackingObserver) {
        scene.onBeforeRenderObservable.remove(_eyeTrackingObserver);
        _eyeTrackingObserver = null;
    }
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

    // 查找头骨和眼球骨骼
    const headBone = mmdModel.runtimeBones.find(
        b => b.name === '頭' || b.name === 'head' || b.name === 'Head'
    );
    const eyeBones = mmdModel.runtimeBones.filter(
        b => b.name === '右目' || b.name === '左目'
            || b.name === 'Eye_R' || b.name === 'Eye_L'
            || b.name === 'eye_r' || b.name === 'eye_l'
            || b.name === 'RightEye' || b.name === 'LeftEye'
    );
    if (eyeBones.length === 0) {
        eyeBones.push(...mmdModel.runtimeBones.filter(
            b => b.name === '両目' || b.name === 'BothEyes' || b.name === 'eyes'
        ));
    }

    // ── 眼部跟随 observer（insertFirst=false 确保在本帧 MMD update 之后执行）──
    if (procState.eyeTrackingEnabled && eyeBones.length > 0) {
        _eyeTrackingObserver = scene.onBeforeRenderObservable.add(() => {
            if (!_procVmdActive) return;
            const cam = scene.activeCamera;
            if (!cam) return;

            for (const eyeBone of eyeBones) {
                const eyePos = _v3().copyFrom(Vector3.ZeroReadOnly);
                eyeBone.getWorldTranslationToRef(eyePos);

                const eyeMat = _m().copyFrom(Matrix.FromArray(eyeBone.worldMatrix));
                const curWorldQuat = _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));
                const curForward = _v3().set(0, 0, 1).rotateByQuaternionToRef(curWorldQuat, _v3());

                const toCam = _v3().set(cam.position.x - eyePos.x, cam.position.y - eyePos.y, cam.position.z - eyePos.z);
                if (toCam.lengthSquared() < 0.0001) continue;
                toCam.normalize();

                const dot = Vector3.Dot(curForward, toCam);
                const crossY = curForward.x * toCam.z - curForward.z * toCam.x;
                let deltaYaw = Math.atan2(crossY, dot);
                const horizDist = Math.sqrt(toCam.x * toCam.x + toCam.z * toCam.z);
                let deltaPitch = Math.atan2(toCam.y, horizDist);
                const maxPitch = 25 * Math.PI / 180;
                deltaPitch = Math.max(-maxPitch, Math.min(maxPitch, deltaPitch));

                _prevEyeYaw += (deltaYaw - _prevEyeYaw) * EYE_SMOOTH;
                _prevEyePitch += (deltaPitch - _prevEyePitch) * EYE_SMOOTH;
                deltaYaw = _prevEyeYaw;
                deltaPitch = _prevEyePitch;

                const yawQuat = _q().copyFrom(Quaternion.RotationAxis(Vector3.UpReadOnly, deltaYaw * 0.7));
                const pitchQuat = _q().copyFrom(Quaternion.RotationAxis(Vector3.RightReadOnly, deltaPitch * 0.5));
                const eyeDelta = _q();
                yawQuat.multiplyToRef(pitchQuat, eyeDelta);
                const newWorldQuat = _q();
                eyeDelta.multiplyToRef(curWorldQuat, newWorldQuat);

                const eyeNewMat = _m();
                newWorldQuat.toRotationMatrix(eyeNewMat);
                eyeNewMat.setTranslation(eyePos);
                eyeNewMat.copyToArray(eyeBone.worldMatrix, 0);
            }
        }, undefined, false);
    }

    // ── 头部跟随 observer（insertFirst=false 确保在 MMD update 之后执行）──
    if (procState.headTrackingEnabled && headBone) {
        _headTrackingObserver = scene.onBeforeRenderObservable.add(() => {
            if (!_procVmdActive) return;
            const cam = scene.activeCamera;
            if (!cam) return;
            const camPos = cam.position;

            const headPos = _v3();
            headBone.getWorldTranslationToRef(headPos);

            // 保存头骨旧世界矩阵（用于计算增量，传播给子骨骼）
            const oldHeadMat = _m().copyFrom(Matrix.FromArray(headBone.worldMatrix));

            const lookDir = headPos.subtractToRef(camPos, _v3()).normalize();
            const targetWorldQuat = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

            const curWorldQuat = _q().copyFrom(Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix()));
            const blended = _q().copyFrom(Quaternion.Slerp(curWorldQuat, targetWorldQuat, 0.3));

            blended.toRotationMatrix(oldHeadMat);
            oldHeadMat.setTranslation(headPos);
            oldHeadMat.copyToArray(headBone.worldMatrix, 0);

            // 将头部变换增量传播给眼骨（眼部跟随关闭时，眼骨需随头骨转动）
            if (!procState.eyeTrackingEnabled || eyeBones.length === 0) {
                const newHeadMat = Matrix.FromArray(headBone.worldMatrix);
                const invOldHead = _m();
                oldHeadMat.invertToRef(invOldHead);
                // headDelta = newHeadMat × invOldHead
                const headDelta = newHeadMat.multiply(invOldHead);
                for (const eyeBone of eyeBones) {
                    const eyeMat = _m().copyFrom(Matrix.FromArray(eyeBone.worldMatrix));
                    const newEyeMat = headDelta.multiply(eyeMat);
                    newEyeMat.copyToArray(eyeBone.worldMatrix, 0);
                }
            }
        }, undefined, false);
    }

    console.log(`[proc-motion] 视线追踪: 眼=${procState.eyeTrackingEnabled} 头=${procState.headTrackingEnabled} 眼骨=[${eyeBones.map(b=>b.name).join(',')}]`);
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
