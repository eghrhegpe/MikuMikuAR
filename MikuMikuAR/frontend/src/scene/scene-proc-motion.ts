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

// ── 视线追踪 ──
let _gazeObserver: any = null;

/** 注册视线追踪的每帧回调（在 VMD 更新后覆盖头骨旋转）。 */
function _setupGazeTracking(): void {
    if (_gazeObserver) return; // 已注册
    const inst = procModelId ? modelManager.get(procModelId) : null;
    const mmdModel = inst?.mmdModel;
    if (!mmdModel) return;

    // 找头骨
    const headBone = mmdModel.runtimeBones.find(
        b => b.name === '頭' || b.name === 'head' || b.name === 'Head'
    );
    if (!headBone) {
        console.warn('[proc-motion] 未找到头骨，视线追踪跳过');
        return;
    }
    // 找父骨（首/neck）用于局部空间转换
    const neckBone = mmdModel.runtimeBones.find(
        b => b.name === '首' || b.name === 'neck' || b.name === 'Neck'
    );
    const parentBone = neckBone ?? headBone;

    // 眼骨（MMD 标准命名：右目/左目/両目）
    const eyeBones = mmdModel.runtimeBones.filter(
        b => b.name === '右目' || b.name === '左目' || b.name === '両目'
    );
    // 目戻骨（右目戻/左目戻）— 它们的 parent 就是对应目骨，跳过

    console.log(`[proc-motion] 视线追踪: 头=${headBone.name} 父=${parentBone.name} 眼=[${eyeBones.map(b=>b.name).join(',')}]`);

    _gazeObserver = scene.onBeforeRenderObservable.add(() => {
        if (!_procVmdActive) return;

        const cam = scene.activeCamera;
        if (!cam) return;

        // --- 头部追踪：直接改写 WASM 内部 worldMatrix Float32Array ---
        // headBone.worldMatrix 是 WASM runtime 缓冲区的视图，写它就影响渲染
        const headPos = new Vector3();
        headBone.getWorldTranslationToRef(headPos);
        const camPos = cam.position;

        // 1. 读取当前 VMD 驱动的世界矩阵
        const currentWorldMat = Matrix.FromArray(headBone.worldMatrix);
        const pos = new Vector3(currentWorldMat.m[12], currentWorldMat.m[13], currentWorldMat.m[14]);

        // 2. 目标世界旋转：头→相机的朝向
        const lookDir = camPos.subtract(headPos).normalize();
        const targetWorldQuat = Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly);

        // 3. 当前世界旋转
        const currentWorldQuat = Quaternion.FromRotationMatrix(
            currentWorldMat.getRotationMatrix()
        );

        // 4. Slerp 混合（世界空间）
        const blendFactor = 0.5;
        const blended = Quaternion.Slerp(currentWorldQuat, targetWorldQuat, blendFactor);

        // 5. 写回 WASM 缓冲区：保持位置不变，只改旋转
        const rotMat = new Matrix();
        blended.toRotationMatrix(rotMat);
        rotMat.setTranslation(pos);
        rotMat.copyToArray(headBone.worldMatrix, 0);

        // --- 眼球追踪 ---
        if (eyeBones.length > 0) {
            for (const eyeBone of eyeBones) {
                const eyePos = new Vector3();
                eyeBone.getWorldTranslationToRef(eyePos);
                const eDx = camPos.x - eyePos.x;
                const eDz = camPos.z - eyePos.z;
                const eyeYaw = Math.atan2(eDx, eDz);

                // 读当前眼骨世界矩阵
                const eyeWorldMat = Matrix.FromArray(eyeBone.worldMatrix);
                const eyePosVec = new Vector3(eyeWorldMat.m[12], eyeWorldMat.m[13], eyeWorldMat.m[14]);
                const curEyeWorldQuat = Quaternion.FromRotationMatrix(
                    eyeWorldMat.getRotationMatrix()
                );

                // 目标：只看水平方向
                const eyeLookDir = new Vector3(eDx, 0, eDz).normalize();
                const eyeTargetQuat = Quaternion.FromLookDirectionRH(eyeLookDir, Vector3.UpReadOnly);

                const blendedEye = Quaternion.Slerp(curEyeWorldQuat, eyeTargetQuat, 0.6);

                const eyeRotMat = new Matrix();
                blendedEye.toRotationMatrix(eyeRotMat);
                eyeRotMat.setTranslation(eyePosVec);
                eyeRotMat.copyToArray(eyeBone.worldMatrix, 0);
            }
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
