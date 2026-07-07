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
    dom,
} from '../../core/config';
import { resolveFileUrl, normPath, encodeFileRef } from '../../core/fileservice';
import { t } from '../../core/i18n/t';
import { loadCameraVmd } from '../camera/camera';
import { loadAudioFile } from '../../outfit/audio';
import { PROC_VMD_NAME_IDLE, PROC_VMD_NAME_AUTODANCE } from '../../motion-algos/procedural-motion';
import { isAutoLoadCompanionAudioEnabled } from '../../menus/settings';

// Dynamic re-import of scene.ts to access its module-level state
// (scene, focusedMmdModel, focusedModel, isProcVmdActive, stopProcMotion)
// without creating a static circular dependency.
function getScene() {
    return import('../scene') as Promise<typeof import('../scene')>;
}

// 缓存已加载的同名伴音，避免重复加载
const _companionAudioCache = new Set<string>();

// ======== VMD Loading ========
export async function loadVMDMotion(
    data: ArrayBuffer,
    name: string,
    targetModelId?: string
): Promise<void> {
    const {
        scene,
        focusedMmdModel: _focusedMmdModel,
        isProcVmdActive,
        stopProcMotion,
        focusedModel: _focusedModel,
    } = await getScene();
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
    try {
        // Load VMD from buffer using VmdLoader
        const vmdLoader = new VmdLoader(scene);
        const mmdAnimation = await vmdLoader.loadFromBufferAsync(name, data);
        (vmdLoader as unknown as { dispose?: () => void }).dispose?.(); // 释放解析器内部资源（API 可选）

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
        const prevAnim = (inst.mmdModel as { currentAnimation?: { dispose?: () => void } | null }).currentAnimation ?? null;
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

export async function loadVMDFromPath(path: string, targetModelId?: string): Promise<void> {
    const { focusedMmdModel, focusedModel } = await getScene();
    dom.loadingEl.style.display = 'block';
    dom.loadingText.textContent = t('scene.loader.vmdLoading');
    try {
        const { url } = await resolveFileUrl(path);
        const vmdName = normPath(path).split('/').pop() || '';
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }
        const vmdData = await resp.arrayBuffer();
        const vmdDisplayName = vmdName.replace(/\.vmd$/i, '');

        if (mmdRuntime && (targetModelId || focusedMmdModel())) {
            await loadVMDMotion(vmdData, vmdName.replace(/\.vmd$/i, ''), targetModelId);
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
        console.error('loadVMDFromPath:', err);
        setStatus(t('scene.vmd.loadFailed'), false);
    } finally {
        dom.loadingEl.style.display = 'none';
    }
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
        const audioName = audioPath.split('/').pop() || '';
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

export async function loadCameraVmdFromPath(path: string): Promise<void> {
    const { scene } = await getScene();
    dom.loadingEl.style.display = 'block';
    dom.loadingText.textContent = t('scene.loader.cameraVmdLoading');
    try {
        const { url } = await resolveFileUrl(path);
        const vmdName = normPath(path).split('/').pop() || '';
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }
        const vmdData = await resp.arrayBuffer();

        const vmdLoader = new VmdLoader(scene);
        const mmdAnimation = await vmdLoader.loadFromBufferAsync(vmdName, vmdData);
        (vmdLoader as unknown as { dispose?: () => void }).dispose?.();
        loadCameraVmd(mmdAnimation, path, vmdName.replace(/\.vmd$/i, ''));
        setStatus(t('scene.vmd.cameraLoaded', { name: vmdName }), true);
        triggerAutoSave();
    } catch (err) {
        console.error('loadCameraVmdFromPath:', err);
        setStatus(t('scene.vmd.cameraLoadFailed'), false);
    } finally {
        dom.loadingEl.style.display = 'none';
    }
}

export async function loadVPDPose(path: string, targetModelId?: string): Promise<void> {
    const { focusedModel, stopProcMotion, isProcVmdActive } = await getScene();
    dom.loadingEl.style.display = 'block';
    dom.loadingText.textContent = t('scene.loader.vpdLoading');
    try {
        const { url } = await resolveFileUrl(path);
        const poseName = normPath(path).split('/').pop() || '';
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }
        const rawData = await resp.arrayBuffer();

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
    } finally {
        dom.loadingEl.style.display = 'none';
    }
}
