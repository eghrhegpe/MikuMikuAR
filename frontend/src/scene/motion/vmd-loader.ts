// [doc:architecture] SceneVMD — VMD/动作加载子模块
// 职责: 从 scene.ts 拆出的 VMD 加载/播放入口
// 依赖: config.ts + scene.ts (懒加载避免循环依赖)

import { VmdLoader } from 'babylon-mmd/esm/Loader/vmdLoader';
import { MmdWasmAnimation } from 'babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import {
    mmdRuntime,
    modelRegistry,
    focusedModelId,
    isPlaying,
    autoLoop,
    setPendingVmd,
    setIsPlaying,
    setStatus,
    triggerAutoSave,
    addRecentMotion,
} from '@/core/config';
import { getBaseName, withLoadingIndicator, logWarn } from '@/core/utils';
import { normPath, encodeFileRef, fetchArrayBuffer } from '@/core/fileservice';
import { t } from '@/core/i18n/t';
import { loadCameraVmd } from '../camera/camera';
import { loadAudioFile } from '@/outfit/audio';
import { PROC_VMD_NAME_IDLE, PROC_VMD_NAME_AUTODANCE } from '@/motion-algos/procedural-motion';
import { isAutoLoadCompanionAudioEnabled } from '@/menus/settings';

// Dynamic re-import of scene.ts to access its module-level state
// (scene, focusedMmdModel, focusedModel, isProcVmdActive, stopProcMotion)
// without creating a static circular dependency.
function getScene() {
    return import('../scene') as Promise<typeof import('../scene')>;
}

// 缓存已加载的同名伴音，避免重复加载
const _companionAudioCache = new Set<string>();

// Generation counter: 每次 loadVMDMotion 调用递增，await 后检查是否过期
let _vmdLoadGeneration = 0;

// VMD 签名：前 25 字节为 "Vocaloid Motion Data 0002"，共 30 字节（含 \0 填充）
const VMD_SIGNATURE = 'Vocaloid Motion Data 0002';
const VMD_HEADER_MIN = 50; // 30(签名+模型名) + 4(骨骼帧数) 的最小合法头部

/** 验证 ArrayBuffer 是否为合法 VMD 格式：检查签名前缀。
 *  程序化生成的 VMD 也使用此签名（vmd-writer.ts SIGNATURE 常量）。 */
function isValidVmd(data: ArrayBuffer): boolean {
    if (data.byteLength < VMD_HEADER_MIN) {
        return false;
    }
    const sig = new TextDecoder('ascii').decode(new Uint8Array(data, 0, 25));
    return sig === VMD_SIGNATURE;
}

// ======== VMD Loading ========
export async function loadVMDMotion(
    data: ArrayBuffer,
    name: string,
    targetModelId?: string,
    signal?: AbortSignal
): Promise<void> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
    if (!isValidVmd(data)) {
        setStatus(t('scene.vmd.loadFailed'), false);
        logWarn('vmd-loader', 'Invalid VMD signature, rejected:', name);
        return;
    }
    const {
        scene,
        focusedMmdModel: _focusedMmdModel,
        isProcVmdActive,
        stopProcMotion,
        focusedModel: _focusedModel,
    } = await getScene();
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
    // If user loads a real VMD, stop procedural motion
    if (isProcVmdActive() && name !== PROC_VMD_NAME_IDLE && name !== PROC_VMD_NAME_AUTODANCE) {
        stopProcMotion();
    }
    if (!mmdRuntime) {
        setPendingVmd({ data, name });
        setStatus(t('scene.vmd.cachedWaiting'), false);
        return;
    }
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        setStatus(t('scene.vmd.noTargetModel'), false);
        return;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst) {
        setStatus(t('scene.vmd.targetNotFound'), false);
        return;
    }
    const capturedGen = ++_vmdLoadGeneration;
    try {
        // Load VMD from buffer using VmdLoader
        const vmdLoader = new VmdLoader(scene);
        const mmdAnimation = await vmdLoader.loadFromBufferAsync(name, data);
        // VmdLoader 类型声明未包含 dispose 方法，但运行时实现了该 API
        // 用于释放解析器内部 ArrayBuffer 引用，避免大 VMD 文件内存驻留
        (vmdLoader as unknown as { dispose?: () => void }).dispose?.();

        // 检查是否在 await 期间有新的 loadVMDMotion 调用，过期则丢弃
        if (_vmdLoadGeneration !== capturedGen) {
            logWarn('vmd-loader', 'Stale loadVMDMotion result discarded:', name);
            setStatus(t('scene.vmd.loadFailed'), false);
            return;
        }

        // Create runtime animation from the loaded data
        // WASM 版需 MmdWasmAnimation 包装；JS 版直接用 mmdAnimation（实现 IMmdBindableModelAnimation）
        let runtimeAnimation: import('babylon-mmd/esm/Runtime/Animation/IMmdBindableAnimation').IMmdBindableModelAnimation;
        if (mmdRuntime instanceof MmdWasmRuntime) {
            runtimeAnimation = new MmdWasmAnimation(mmdAnimation, mmdRuntime.wasmInstance, scene);
        } else {
            runtimeAnimation = mmdAnimation;
        }

        // Extract camera track from VMD and apply to MmdCamera
        try {
            loadCameraVmd(mmdAnimation, '', name);
        } catch {
            // 程序化动作的 VMD 不含相机轨道，此处跳过是正常行为
        }

        // Bind to model
        if (!inst.mmdModel) {
            // 动画已创建但模型是 Stage，无法绑定 — 清理避免泄漏（仅 WASM 版有资源需释放）
            if (runtimeAnimation instanceof MmdWasmAnimation) {
                try {
                    runtimeAnimation.dispose?.();
                } catch {
                    // Intentionally empty — 舞台模型动画句柄清理失败不影响后续流程
                }
            }
            setStatus(t('scene.vmd.stageNoVmd'), false);
            return;
        }
        // 释放旧动画句柄，防止切换 VMD 时 WASM 内存泄漏
        // setRuntimeAnimation(null) 仅解绑、不释放 WASM buffer；必须显式 dispose 旧
        // runtime animation（其内部 onDispose 回调触发 _destroyRuntimeAnimation，从
        // _animationHandleMap 删除并回收 WASM AnimCurve 资源），否则每次换 VMD 都泄漏一份。
        // babylon-mmd 类型声明未暴露 currentAnimation 属性（内部实现），
        // 需要取出旧动画句柄显式 dispose 以释放 WASM AnimCurve 资源
        const prevAnim =
            (inst.mmdModel as { currentAnimation?: { dispose?: () => void } | null })
                .currentAnimation ?? null;
        inst.mmdModel.setRuntimeAnimation(null);
        if (prevAnim) {
            try {
                prevAnim.dispose?.();
            } catch {
                // 旧动画句柄清理失败不影响本次绑定
            }
        }
        const handle = inst.mmdModel.createRuntimeAnimation(runtimeAnimation);
        inst.mmdModel.setRuntimeAnimation(handle);

        inst.vmdData = data;
        _companionAudioCache.clear();
        inst.vmdName = name;
        // Convert from 30fps frames to seconds（异常 VMD 兜底，避免 NaN 时长）
        const endFrame = Number(mmdAnimation.endFrame);
        inst.animationDuration = Number.isFinite(endFrame) && endFrame > 0 ? endFrame / 30 : 0;

        if (!isPlaying && autoLoop) {
            await mmdRuntime.playAnimation();
            setIsPlaying(true);
        }
        setStatus(t('scene.vmd.loaded', { name }), true);
        triggerAutoSave();
    } catch (err) {
        console.error('VMD load failed:', err);
        setStatus(t('scene.vmd.loadFailed'), false);
    }
}

export async function loadVMDFromPath(
    path: string,
    targetModelId?: string,
    signal?: AbortSignal
): Promise<void> {
    const { focusedMmdModel, focusedModel } = await getScene();
    await withLoadingIndicator('scene.loader.vmdLoading', async () => {
        try {
            const { url, data: vmdData } = await fetchArrayBuffer(path, signal);
            const vmdName = getBaseName(path) || '';
            const vmdDisplayName = vmdName.replace(/\.vmd$/i, '');

            if (mmdRuntime && (targetModelId || focusedMmdModel())) {
                await loadVMDMotion(vmdData, vmdName.replace(/\.vmd$/i, ''), targetModelId, signal);
                const foc = targetModelId ? modelRegistry.get(targetModelId) : focusedModel();
                if (foc) {
                    foc.vmdPath = path;
                }
            } else {
                setPendingVmd({ data: vmdData, name: vmdName.replace(/\.vmd$/i, '') });
                setStatus(t('scene.vmd.cachedAutoApply'), false);
            }

            // 记录最近使用动作
            addRecentMotion(path, vmdDisplayName);

            // 尝试加载同目录下的同名音频文件
            await _tryLoadCompanionAudio(path, url);
        } catch (err) {
            // 中止（AbortError）不算失败：loadVMDMotion 在 signal 中止时抛此错，
            // 此时 vmdPath/addRecentMotion/音频等副作用已被 throw 跳过，无需报错 UI
            if ((err as DOMException)?.name === 'AbortError') {
                return;
            }
            console.error('loadVMDFromPath:', err);
            setStatus(t('scene.vmd.loadFailed'), false);
        }
    });
}

/** 尝试加载 VMD 同目录下的同名音频文件（.mp3/.wav/.ogg/.flac）。 */
async function _tryLoadCompanionAudio(vmdPath: string, vmdUrl: string): Promise<void> {
    if (!isAutoLoadCompanionAudioEnabled()) {
        return;
    }
    // [doc:adr-057] vmdUrl 形如 http://127.0.0.1:port/?f=<base64>
    // 提取 origin+port 作为音频探针的基地址，文件名通过 ?f= 查询参数传递
    const urlObj = new URL(vmdUrl);
    const baseOrigin = `${urlObj.protocol}//${urlObj.host}`;
    const basePath = vmdPath.replace(/\.vmd$/i, '');
    if (_companionAudioCache.has(basePath)) {
        return;
    }
    const exts = ['.mp3', '.wav', '.ogg', '.flac', '.wma'];

    // 并行 HEAD 探针，取首个成功的扩展名（Promise.any 只取最快的成功结果）
    const probes = exts.map(async (ext) => {
        const audioPath = basePath + ext;
        const audioName = getBaseName(audioPath) || '';
        const probeUrl = `${baseOrigin}/?f=${encodeFileRef(audioName)}`;
        const resp = await fetch(probeUrl, { method: 'HEAD' });
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }
        return { audioPath, audioName };
    });

    try {
        const { audioPath, audioName } = await Promise.any(probes);
        await loadAudioFile(audioPath);
        _companionAudioCache.add(basePath);
        setStatus(t('scene.vmd.loadedWithAudio', { name: audioName }), true);
        // 确保播放栏可见
        const { updatePlaybackUI } = await import('./playback');
        updatePlaybackUI();
    } catch {
        // 所有扩展名都未找到，静默跳过
    }
}

export async function loadCameraVmdFromPath(path: string, signal?: AbortSignal): Promise<void> {
    const { scene } = await getScene();
    await withLoadingIndicator('scene.loader.cameraVmdLoading', async () => {
        try {
            const { data: vmdData } = await fetchArrayBuffer(path, signal);
            const vmdName = getBaseName(path) || '';

            const vmdLoader = new VmdLoader(scene);
            const mmdAnimation = await vmdLoader.loadFromBufferAsync(vmdName, vmdData);
            (vmdLoader as unknown as { dispose?: () => void }).dispose?.();
            loadCameraVmd(mmdAnimation, path, vmdName.replace(/\.vmd$/i, ''));
            setStatus(t('scene.vmd.cameraLoaded', { name: vmdName }), true);
            triggerAutoSave();
        } catch (err) {
            console.error('loadCameraVmdFromPath:', err);
            setStatus(t('scene.vmd.cameraLoadFailed'), false);
        }
    });
}

export async function loadVPDPose(
    path: string,
    targetModelId?: string,
    signal?: AbortSignal
): Promise<void> {
    const { focusedModel, stopProcMotion, isProcVmdActive } = await getScene();
    await withLoadingIndicator('scene.loader.vpdLoading', async () => {
        try {
            const { data: rawData } = await fetchArrayBuffer(path, signal);
            const poseName = getBaseName(path) || '';

            // 停掉程序化动作（VPD 姿势不被动画干扰）
            if (isProcVmdActive()) {
                stopProcMotion();
            }

            // 解析 VPD 并作为静态姿势应用（不生成 VMD 动画）
            const { decodeVPDData, parseVPDText } = await import('../../motion-algos/vpd-parser');
            const { applyVPDPose } = await import('../manager/model-ops');
            const text = decodeVPDData(rawData);
            const pose = parseVPDText(text);
            const id = targetModelId || focusedModelId;
            if (!id) {
                setStatus(t('scene.vmd.loadModelFirst'), true);
                return;
            }
            applyVPDPose(id, pose.bones, pose.morphs);

            const foc = targetModelId ? modelRegistry.get(targetModelId) : focusedModel();
            if (foc) {
                foc.vmdPath = path; // 记录姿势文件路径
            }
            setStatus(t('scene.vmd.poseLoaded', { name: poseName }), true);
        } catch (err) {
            console.error('loadVPDPose:', err);
            setStatus(t('scene.vmd.poseFailed'), false);
        }
    });
}
