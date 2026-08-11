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
    setIsPlaying,
    triggerAutoSave,
    addRecentMotion,
} from '@/core/config';
import { getBaseName } from '@/core/path';
import { withLoadingIndicator } from '@/core/config';
import { logWarn } from '@/core/logger';
import { encodeFileRef } from '@/core/fileservice';
import { readFileBytes } from '@/core/wails-bindings';
import { t } from '@/core/i18n/t';
import { feedbackInfo, feedbackStatus } from '@/core/feedback';
import { switchAnimation } from '@/core/mmd-adapter';
import { showInfoToast } from '@/core/toast';
import { replaceDefaultMotion, getActiveMotion } from './motion-intent';
// [doc:adr-238] 相机 VMD 经 scene-action-bridge
import { getSceneAction } from '@/core/scene-action-bridge';
// [doc:adr-238] 音频操作经 scene-action-bridge（core/audio 注册）
import { PROC_VMD_NAME_IDLE, PROC_VMD_NAME_AUTODANCE } from '@/motion-algos/procedural-motion';
import { isAutoLoadCompanionAudioEnabled } from '@/core/state';

function getScene() {
    return import('../scene') as Promise<typeof import('../scene')>;
}

// 缓存已加载的同名伴音，避免重复加载
const _companionAudioCache = new Set<string>();

// Generation counter: per-model，每次 loadVMDMotion 调用递增，await 后检查是否过期
// 全局单例会导致多模型同时加载时互相干扰（慢的被错误判定为过期）
const _vmdLoadGenMap = new Map<string, number>();

// VMD 签名：前 25 字节为 "Vocaloid Motion Data 0002"，共 30 字节（含 \0 填充）
const VMD_SIGNATURE = 'Vocaloid Motion Data 0002';
const VMD_HEADER_MIN = 50; // 30(签名+模型名) + 4(骨骼帧数) 的最小合法头部

/** 验证 ArrayBuffer 是否为合法 VMD 格式：检查签名前缀。
 *  程序化生成的 VMD 也使用此签名（vmd-writer.ts SIGNATURE 常量）。 */
export function isValidVmd(data: ArrayBuffer): boolean {
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
    signal?: AbortSignal,
    _vmdPath?: string
): Promise<void> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
    if (!isValidVmd(data)) {
        feedbackStatus('scene.vmd.loadFailed', undefined, false);
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
    if (!mmdRuntime) {
        // [doc:adr-169] 运行时未就绪，不污染场景库；仅提示用户等待
        feedbackStatus('scene.vmd.cachedWaiting', undefined, false);
        return;
    }
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        feedbackStatus('scene.vmd.noTargetModel', undefined, false);
        return;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst) {
        feedbackStatus('scene.vmd.targetNotFound', undefined, false);
        return;
    }
    const prevGen = _vmdLoadGenMap.get(targetId) ?? 0;
    const capturedGen = prevGen + 1;
    _vmdLoadGenMap.set(targetId, capturedGen);
    try {
        // Load VMD from buffer using VmdLoader
        const vmdLoader = new VmdLoader(scene);
        const mmdAnimation = await vmdLoader.loadFromBufferAsync(name, data);
        // babylon-mmd fork 的 VmdLoader 无实例状态需释放（解析结果已转移到 mmdAnimation），
        // 不存在 dispose() API；loader 为局部引用，GC 自动回收，无需手动释放。

        // Create runtime animation from the loaded data
        // WASM 版需 MmdWasmAnimation 包装；JS 版直接用 mmdAnimation（实现 IMmdBindableModelAnimation）
        let runtimeAnimation: import('babylon-mmd/esm/Runtime/Animation/IMmdBindableAnimation').IMmdBindableModelAnimation;
        if (mmdRuntime instanceof MmdWasmRuntime) {
            runtimeAnimation = new MmdWasmAnimation(mmdAnimation, mmdRuntime.wasmInstance, scene);
        } else {
            runtimeAnimation = mmdAnimation;
        }

        // 检查是否在 await 期间有新的 loadVMDMotion 调用（同模型），过期则丢弃
        // [fix] runtimeAnimation 已创建，stale 时须释放避免 WASM 内存泄漏
        if (_vmdLoadGenMap.get(targetId) !== capturedGen) {
            try { runtimeAnimation.dispose?.(); } catch { /* best-effort */ }
            logWarn('vmd-loader', 'Stale loadVMDMotion result discarded:', name);
            feedbackStatus('scene.vmd.loadFailed', undefined, false);
            return;
        }

        // Extract camera track from VMD and apply to MmdCamera
        try {
            getSceneAction('loadCameraVmd')?.(mmdAnimation, '', name);
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
            feedbackStatus('scene.vmd.stageNoVmd', undefined, false);
            return;
        }
        // 切换 VMD：释放旧句柄 + 绑定新动画 + 归零时钟（封装于 mmd-adapter PlaybackContract，见 ADR-192）。
        // 固化 setRuntimeAnimation 不重置时钟 + WASM 句柄需显式 dispose 的 babylon-mmd 行为缺陷。
        await switchAnimation(mmdRuntime, inst.mmdModel, runtimeAnimation);

        inst.vmdData = data;
        // 停止程序化动作（延迟到 vmdData 赋值后，确保 stopProcMotion 内 userVmdPresent=true，
        // 不会清空刚绑定的动画——否则缩略图截帧时动画已被清空，截到空姿态）
        // [fix:P2] 仅停止目标模型的程序化，不误杀其他活跃模型
        if (isProcVmdActive() && name !== PROC_VMD_NAME_IDLE && name !== PROC_VMD_NAME_AUTODANCE) {
            stopProcMotion(targetId);
        }
        _companionAudioCache.clear();
        inst.vmdName = name;
        // Convert from 30fps frames to seconds（异常 VMD 兜底，避免 NaN 时长）
        const endFrame = Number(mmdAnimation.endFrame);
        inst.animationDuration = Number.isFinite(endFrame) && endFrame > 0 ? endFrame / 30 : 0;

        if (!isPlaying && autoLoop) {
            await mmdRuntime.playAnimation();
            setIsPlaying(true);
        }
        // [doc:adr-feedback] VMD 加载是中间步骤，走状态栏；若为模型替换流程的伴音 VMD，
        // 后续 loadCompanionAudio 完成时仍由状态栏汇总反馈，避免与"模型已替换"toast 叠加。
        feedbackStatus('scene.vmd.loaded', undefined, undefined, { name });
        triggerAutoSave();
    } catch (err) {
        console.error('VMD load failed:', err);
        feedbackStatus('scene.vmd.loadFailed', undefined, false);
    }
}

export async function loadVMDFromPath(
    path: string,
    targetModelId?: string,
    signal?: AbortSignal,
    skipSceneIntent?: boolean
): Promise<void> {
    const { focusedMmdModel, focusedModel } = await getScene();
    await withLoadingIndicator('scene.loader.vmdLoading', async () => {
        try {
            const vmdBytes = await readFileBytes(path);
            if (!vmdBytes) {
                return;
            }
            const vmdData = vmdBytes.buffer as ArrayBuffer;
            const vmdName = getBaseName(path) || '';
            const vmdDisplayName = vmdName.replace(/\.vmd$/i, '');

            if (mmdRuntime && (targetModelId || focusedMmdModel())) {
                await loadVMDMotion(
                    vmdData,
                    vmdName.replace(/\.vmd$/i, ''),
                    targetModelId,
                    signal,
                    path
                );
                const foc = targetModelId ? modelRegistry.get(targetModelId) : focusedModel();
                if (foc) {
                    foc.vmdPath = path;
                }
                // 设置场景级默认动作（守卫：避免同路径重复触发广播）
                // [fix:adr-167] skipSceneIntent 时跳过：per-model 应用（applyIntentToModel /
                // 程序化切回）不应触碰场景库。
                // [adr-169] 用 replaceDefaultMotion 原位替换默认：旧默认被顶替移除，
                // 其余主动作保留（取代已废弃的 setActiveMotion 单例清库语义）。
                if (!skipSceneIntent) {
                    const cur = getActiveMotion();
                    if (!cur || cur.vmdPath !== path) {
                        replaceDefaultMotion({
                            vmdPath: path,
                            vmdName: vmdName.replace(/\.vmd$/i, ''),
                            vmdLayers: [],
                            source: 'vmd',
                        });
                    }
                }
            } else if (!skipSceneIntent) {
                replaceDefaultMotion({
                    vmdPath: path,
                    vmdName: vmdName.replace(/\.vmd$/i, ''),
                    vmdLayers: [],
                    source: 'vmd',
                });
                feedbackStatus('scene.vmd.cachedAutoApply', undefined, false);
            }

            // 记录最近使用动作
            addRecentMotion(path, vmdDisplayName);

            // 尝试加载同目录下的同名音频文件
            const audioTargetId = targetModelId || focusedModelId;
            await _tryLoadCompanionAudio(path, path, audioTargetId);
        } catch (err) {
            // 中止（AbortError）不算失败：loadVMDMotion 在 signal 中止时抛此错，
            // 此时 vmdPath/addRecentMotion/音频等副作用已被 throw 跳过，无需报错 UI
            if ((err as DOMException)?.name === 'AbortError') {
                return;
            }
            console.error('loadVMDFromPath:', err);
            feedbackStatus('scene.vmd.loadFailed', undefined, false);
        }
    });
}

/** 尝试加载 VMD 同目录下的同名音频文件（.mp3/.wav/.ogg/.flac）。 */
async function _tryLoadCompanionAudio(
    vmdPath: string,
    vmdUrl: string,
    targetModelId?: string
): Promise<void> {
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

    // 记录加载前的 generation 值，加载完成后校验是否过期
    // （用户在加载期间切换了 VMD 则丢弃本次伴音结果）
    const genBefore = _vmdLoadGenMap.get(targetModelId || '') ?? 0;

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

        // 竞态检查：加载期间模型 VMD 是否被切换
        const tid = targetModelId || '';
        if (tid && _vmdLoadGenMap.get(tid) !== genBefore) {
            return; // VMD 已被切换，丢弃本次伴音
        }

        await (getSceneAction('loadAudioFile') as ((p: string) => Promise<void>) | undefined)?.(audioPath);
        _companionAudioCache.add(basePath);
        // [doc:adr-feedback] 伴音加载是中间步骤，走状态栏；模型替换的最终态由"模型已替换"toast 承担。
        feedbackStatus('scene.vmd.loadedWithAudio', undefined, undefined, { name: audioName });
        // 确保播放栏可见
        const { updatePlaybackUI } = await import('./playback');
        updatePlaybackUI();
    } catch {
        // 所有扩展名都未找到，静默跳过
    }
}

export async function loadCameraVmdFromPath(path: string, _signal?: AbortSignal): Promise<void> {
    const { scene } = await getScene();
    await withLoadingIndicator('scene.loader.cameraVmdLoading', async () => {
        try {
            const vmdBytes = await readFileBytes(path);
            if (!vmdBytes) {
                return;
            }
            const vmdData = vmdBytes.buffer as ArrayBuffer;
            const vmdName = getBaseName(path) || '';

            const vmdLoader = new VmdLoader(scene);
            const mmdAnimation = await vmdLoader.loadFromBufferAsync(vmdName, vmdData);
            // VmdLoader 无实例状态需释放（解析结果已转移到 mmdAnimation），GC 自动回收
            getSceneAction('loadCameraVmd')?.(mmdAnimation, path, vmdName.replace(/\.vmd$/i, ''));
            showInfoToast(t('scene.vmd.cameraLoaded', { name: vmdName }));
            triggerAutoSave();
        } catch (err) {
            console.error('loadCameraVmdFromPath:', err);
            feedbackStatus('scene.vmd.cameraLoadFailed', undefined, false);
        }
    });
}

export async function loadVPDPose(
    path: string,
    targetModelId?: string,
    _signal?: AbortSignal
): Promise<void> {
    const { focusedModel, stopProcMotion, isProcVmdActive } = await getScene();
    await withLoadingIndicator('scene.loader.vpdLoading', async () => {
        try {
            const rawBytes = await readFileBytes(path);
            if (!rawBytes) {
                return;
            }
            const rawData = rawBytes.buffer as ArrayBuffer;
            const poseName = getBaseName(path) || '';

            // 停掉程序化动作（VPD 姿势不被动画干扰）；[fix:P2] 仅停止目标模型
            if (isProcVmdActive()) {
                stopProcMotion(targetModelId);
            }

            // 解析 VPD 并作为静态姿势应用（不生成 VMD 动画）
            const { decodeVPDData, parseVPDText } = await import('../../motion-algos/vpd-parser');
            const { applyVPDPose } = await import('../manager/model-ops');
            const text = decodeVPDData(rawData);
            const pose = parseVPDText(text);
            const id = targetModelId || focusedModelId;
            if (!id) {
                feedbackInfo('scene.vmd.loadModelFirst', undefined);
                return;
            }
            applyVPDPose(id, pose.bones, pose.morphs);

            const foc = targetModelId ? modelRegistry.get(targetModelId) : focusedModel();
            if (foc) {
                foc.vmdPath = path; // 记录姿势文件路径
            }
            showInfoToast(t('scene.vmd.poseLoaded', { name: poseName }));
        } catch (err) {
            console.error('loadVPDPose:', err);
            feedbackStatus('scene.vmd.poseFailed', undefined, false);
        }
    });
}

// [doc:adr-238] 注册 VPD 姿势加载供 core/action-defs 经 scene-action-bridge 调用
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('loadVPDPose', (path: string) => {
    void loadVPDPose(path);
});
