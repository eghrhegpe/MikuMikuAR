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
    isLoadingVmd,
    setIsLoadingVmd,
    setPendingVmd,
    setIsPlaying,
    setStatus,
    triggerAutoSave,
    addRecentMotion,
} from '../../core/config';
import { resolveFileUrl, normPath } from '../../core/fileservice';
import { loadCameraVmd } from '../camera/camera';
import { loadAudioFile } from '../../outfit/audio';

// Dynamic re-import of scene.ts to access its module-level state
// (scene, focusedMmdModel, focusedModel, isProcVmdActive, stopProcMotion)
// without creating a static circular dependency.
function getScene() {
    return import('../scene') as Promise<typeof import('../scene')>;
}

// ======== VMD Loading ========
export async function loadVMDMotion(
    data: ArrayBuffer,
    name: string,
    targetModelId?: string
): Promise<void> {
    const { scene, focusedMmdModel: _focusedMmdModel, isProcVmdActive, stopProcMotion, focusedModel: _focusedModel } =
        await getScene();
    // If user loads a real VMD, stop procedural motion
    if (isProcVmdActive() && name !== 'IdleMotion' && name !== 'AutoDance') {
        stopProcMotion();
    }
    if (!mmdRuntime) {
        setPendingVmd({ data, name });
        setStatus('VMD 已缓存，等待模型加载', false);
        return;
    }
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        setStatus('✗ 没有目标模型', false);
        return;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst) {
        setStatus('✗ 目标模型不存在', false);
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
            setStatus('✗ 舞台模型不支持 VMD', false);
            return;
        }
        // 释放旧动画句柄，防止切换 VMD 时 WASM 内存泄漏
        inst.mmdModel.setRuntimeAnimation(null);
        const handle = inst.mmdModel.createRuntimeAnimation(runtimeAnimation);
        inst.mmdModel.setRuntimeAnimation(handle);

        inst.vmdData = data;
        inst.vmdName = name;
        // Convert from 30fps frames to seconds
        inst.animationDuration = mmdAnimation.endFrame / 30;

        if (!isPlaying && autoLoop) {
            await mmdRuntime.playAnimation();
            setIsPlaying(true);
        }
        setStatus(`✓ VMD: ${name}`, true);
        triggerAutoSave();
    } catch (err) {
        console.error('VMD load failed:', err);
        setStatus('✗ VMD 加载失败', false);
    }
}

export async function loadVMDFromPath(path: string, targetModelId?: string): Promise<void> {
    const { focusedMmdModel, focusedModel } = await getScene();
    if (isLoadingVmd) {
        return;
    }
    setIsLoadingVmd(true);
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
            setStatus('VMD 已缓存，加载模型后自动应用', false);
        }

        // 记录最近使用动作
        addRecentMotion(path, vmdDisplayName);

        // 尝试加载同目录下的同名音频文件
        await _tryLoadCompanionAudio(path, url);
    } catch (err) {
        console.error('loadVMDFromPath:', err);
        setStatus('✗ VMD 加载失败', false);
    } finally {
        setIsLoadingVmd(false);
    }
}

/** 尝试加载 VMD 同目录下的同名音频文件（.mp3/.wav/.ogg/.flac）。 */
async function _tryLoadCompanionAudio(vmdPath: string, vmdUrl: string): Promise<void> {
    const baseUrl = vmdUrl.substring(0, vmdUrl.lastIndexOf('/') + 1);
    const basePath = vmdPath.replace(/\.vmd$/i, '');
    const exts = ['.mp3', '.wav', '.ogg', '.flac', '.wma'];
    for (const ext of exts) {
        const audioPath = basePath + ext;
        const audioName = audioPath.split('/').pop() || '';
        try {
            const resp = await fetch(baseUrl + encodeURIComponent(audioName), { method: 'HEAD' });
            if (resp.ok) {
                await loadAudioFile(audioPath);
                setStatus(`✓ VMD + 音频: ${audioName}`, true);
                // 确保播放栏可见
                const { updatePlaybackUI } = await import('./playback');
                updatePlaybackUI();
                return;
            }
        } catch {
            // 文件不存在，尝试下一个扩展名
        }
    }
}

export async function loadCameraVmdFromPath(path: string): Promise<void> {
    const { scene } = await getScene();
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
        setStatus(`✓ 相机 VMD: ${vmdName}`, true);
        triggerAutoSave();
    } catch (err) {
        console.error('loadCameraVmdFromPath:', err);
        setStatus('✗ 相机 VMD 加载失败', false);
    }
}

export async function loadVPDPose(path: string, targetModelId?: string): Promise<void> {
    const { focusedModel, stopProcMotion, isProcVmdActive } = await getScene();
    if (isLoadingVmd) {
        return;
    }
    setIsLoadingVmd(true);
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
            setStatus('请先加载模型', true);
            return;
        }
        applyVPDPose(id, pose.bones, pose.morphs);

        const foc = targetModelId ? modelRegistry.get(targetModelId) : focusedModel();
        if (foc) {
            foc.vmdPath = path; // 记录姿势文件路径
        }
        setStatus(`✓ 姿势: ${poseName}`, true);
    } catch (err) {
        console.error('loadVPDPose:', err);
        setStatus('✗ 姿势加载失败', false);
    } finally {
        setIsLoadingVmd(false);
    }
}
