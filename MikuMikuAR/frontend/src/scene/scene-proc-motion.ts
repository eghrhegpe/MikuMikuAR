// [doc:architecture] Procedural Motion — 程序化动作系统
// 规范文档: docs/architecture.md §程序化动作
// 职责: Idle / Auto Dance 状态管理、VMD 生成调度、节拍联动、视线追踪实时叠加

import {
    ProcMotionState,
    ProcMotionMode,
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

// ── 视线追踪（WorldMatrix 方案，VMD 播放期间有效） ──
let _gazeObserver: any = null;

/** 递归收集所有子骨。 */
function _collectDescendants(
    bone: import('babylon-mmd/esm/Runtime/IMmdRuntimeBone').IMmdRuntimeBone,
): import('babylon-mmd/esm/Runtime/IMmdRuntimeBone').IMmdRuntimeBone[] {
    const result: import('babylon-mmd/esm/Runtime/IMmdRuntimeBone').IMmdRuntimeBone[] = [];
    for (const child of bone.childBones) {
        result.push(child);
        result.push(..._collectDescendants(child));
    }
    return result;
}

/** 注册视线追踪。改写 WASM worldMatrix 确保 VMD 播放期间可见。 */
function _setupGazeTracking(): void {
    if (_gazeObserver) return;
    const inst = procModelId ? modelManager.get(procModelId) : null;
    const mmdModel = inst?.mmdModel;
    if (!mmdModel) return;

    const rootBone = mmdModel.runtimeBones.find(
        b => b.name === '首' || b.name === 'neck' || b.name === 'Neck'
    ) ?? mmdModel.runtimeBones.find(
        b => b.name === '頭' || b.name === 'head' || b.name === 'Head'
    );
    if (!rootBone) {
        console.warn('[proc-motion] 未找到首/头骨，视线追踪跳过');
        return;
    }

    const headBone = mmdModel.runtimeBones.find(
        b => b.name === '頭' || b.name === 'head' || b.name === 'Head'
    ) ?? rootBone;
    const descendants = _collectDescendants(rootBone);
    // 只取左右目，不取両目（避免双重驱动）
    let eyeBones = mmdModel.runtimeBones.filter(
        b => b.name === '右目' || b.name === '左目'
    );
    if (eyeBones.length === 0) {
        // 若没有左右目，则退回到両目
        eyeBones = mmdModel.runtimeBones.filter(b => b.name === '両目');
    }

    console.log(`[proc-motion] 视线追踪(worldMat): 根=${rootBone.name} descendants=${descendants.length} 眼=[${eyeBones.map(b=>b.name).join(',')}]`);

    _gazeObserver = scene.onBeforeRenderObservable.add(() => {
        if (!_procVmdActive) return;
        const cam = scene.activeCamera;
        if (!cam) return;
        const camPos = cam.position;

        // ---- 1. 根骨旋转 + descendants 传播 ----
        const oldRootWorld = Matrix.FromArray(rootBone.worldMatrix);
        const headPos = new Vector3();
        headBone.getWorldTranslationToRef(headPos);

        const lookDir = headPos.subtract(camPos).normalize();
        const targetWorldQuat = Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly);
        const currentRootQuat = Quaternion.FromRotationMatrix(oldRootWorld.getRotationMatrix());
        const blended = Quaternion.Slerp(currentRootQuat, targetWorldQuat, 0.5);

        const rootPos = new Vector3(oldRootWorld.m[12], oldRootWorld.m[13], oldRootWorld.m[14]);
        const newRootWorld = new Matrix();
        blended.toRotationMatrix(newRootWorld);
        newRootWorld.setTranslation(rootPos);
        newRootWorld.copyToArray(rootBone.worldMatrix, 0);

        // 传播到所有 descendant（含眉眼头发）
        const invOldRoot = oldRootWorld.clone().invert();
        for (const child of descendants) {
            const oldChildMat = Matrix.FromArray(child.worldMatrix);
            const childLocal = invOldRoot.multiply(oldChildMat);
            const newChildMat = newRootWorld.multiply(childLocal);
            newChildMat.copyToArray(child.worldMatrix, 0);
        }

        // ---- 2. 眼球水平旋转（增量旋转，绕世界 Y 轴） ----
        for (const eyeBone of eyeBones) {
            const eyePos = new Vector3();
            eyeBone.getWorldTranslationToRef(eyePos);
            const eyeMat = Matrix.FromArray(eyeBone.worldMatrix);
            const curWorldQuat = Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix());

            // 当前 forward（世界空间）
            const curForward = new Vector3(0, 0, 1);
            curForward.rotateByQuaternionToRef(curWorldQuat, curForward);

            // 目标方向（水平分量）
            const toCam = new Vector3(camPos.x - eyePos.x, 0, camPos.z - eyePos.z);
            if (toCam.lengthSquared() < 0.0001) continue;
            toCam.normalize();

            // 计算绕 Y 轴的角度差：方向反了把 deltaYaw 取负
            const dot = Vector3.Dot(curForward, toCam);
            const crossY = curForward.x * toCam.z - curForward.z * toCam.x;
            const deltaYaw = Math.atan2(crossY, dot);

            // 增量旋转 + 写回
            const deltaQuat = Quaternion.RotationAxis(Vector3.UpReadOnly, deltaYaw * 0.7);
            const newWorldQuat = deltaQuat.multiply(curWorldQuat);

            const eyePosVec = new Vector3(eyeMat.m[12], eyeMat.m[13], eyeMat.m[14]);
            const eyeNewMat = new Matrix();
            newWorldQuat.toRotationMatrix(eyeNewMat);
            eyeNewMat.setTranslation(eyePosVec);
            eyeNewMat.copyToArray(eyeBone.worldMatrix, 0);
        }
    });
}

function _teardownGazeTracking(): void {
    if (_gazeObserver) {
        scene.onBeforeRenderObservable.remove(_gazeObserver);
        _gazeObserver = null;
    }
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
