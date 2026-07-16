// [doc:architecture] Motion Layers — 多 VMD 叠加系统
// 职责: 管理模型的多层 VMD 动画，通过 MmdCompositeAnimation 混合
// 依赖: config.ts + scene.ts (懒加载避免循环依赖)

import { VmdLoader } from 'babylon-mmd/esm/Loader/vmdLoader';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import {
    MmdCompositeAnimation,
    MmdAnimationSpan,
} from 'babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation';
import type { VmdLayer } from '@/core/types';
import {
    mmdRuntime,
    modelRegistry,
    focusedModelId,
    setStatus,
    triggerAutoSave,
    isPlaying,
    autoLoop,
    setIsPlaying,
} from '@/core/config';
import { fetchArrayBuffer } from '@/core/fileservice';
import { getBaseName, clamp01, logWarn } from '@/core/utils';
import { t } from '@/core/i18n/t';
import Encoding from 'encoding-japanese';

function getScene() {
    return import('../scene') as Promise<typeof import('../scene')>;
}

/** 生成唯一图层 ID */
function _nextLayerId(): string {
    return `layer_${crypto.randomUUID().slice(0, 8)}`;
}

/** 解码 Shift-JIS 字节到 Unicode 字符串（VMD 骨骼名用，最大 len 字节） */
function _decodeSjis(bytes: Uint8Array): string {
    let end = 0;
    while (end < bytes.length && bytes[end] !== 0) {
        end++;
    }
    if (end === 0) {
        return '';
    }
    return Encoding.convert(bytes.slice(0, end), {
        to: 'UNICODE',
        from: 'SJIS',
        type: 'string',
    }) as string;
}

const VMD_BONE_FRAME_SIZE = 111; // 标准 VMD 骨骼帧大小（15 骨骼名 + 4 帧号 + 12 位置 + 16 旋转 + 64 插值）

/**
 * 过滤 VMD 二进制数据，只保留指定骨骼的关键帧。
 * 在 VMD 二进制层面操作，完整保留插值曲线、morph 帧、相机帧等所有其他数据。
 * @returns 新的 VMD ArrayBuffer，或 boneFilter 为空时返回原始引用
 */
function _filterVmdBones(data: ArrayBuffer, boneFilter: string[]): ArrayBuffer {
    if (boneFilter.length === 0) {
        return data;
    }
    const src = new Uint8Array(data);
    const view = new DataView(data);
    // VMD 头部: 30(signature) + 20(modelName) = 50, 之后 4 字节骨骼帧数
    const boneCount = view.getUint32(50, true);
    if (boneCount === 0) {
        return data;
    }
    const boneStartOffset = 54;
    const filterSet = new Set(boneFilter);
    const keptIndices: number[] = [];
    for (let i = 0; i < boneCount; i++) {
        const off = boneStartOffset + i * VMD_BONE_FRAME_SIZE;
        const boneName = _decodeSjis(src.slice(off, off + 15));
        if (filterSet.has(boneName)) {
            keptIndices.push(i);
        }
    }
    if (keptIndices.length === boneCount) {
        return data;
    } // 全保留 = 不变
    // 重建 VMD
    const newBoneCount = keptIndices.length;
    const newBoneSize = newBoneCount * VMD_BONE_FRAME_SIZE;
    const morphOffset = boneStartOffset + boneCount * VMD_BONE_FRAME_SIZE;
    const tailSize = data.byteLength - morphOffset;
    const out = new Uint8Array(54 + newBoneSize + tailSize);
    // 复制头部 (signature + modelName)
    out.set(src.slice(0, 50), 0);
    // 写入新的骨骼帧数
    const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
    outView.setUint32(50, newBoneCount, true);
    // 复制保留的骨骼帧
    let writeOff = 54;
    for (const idx of keptIndices) {
        const srcOff = boneStartOffset + idx * VMD_BONE_FRAME_SIZE;
        out.set(src.slice(srcOff, srcOff + VMD_BONE_FRAME_SIZE), writeOff);
        writeOff += VMD_BONE_FRAME_SIZE;
    }
    // 复制尾部（morph 帧数 + morph 帧 + camera/light/shadow/ik 计数）
    out.set(src.slice(morphOffset), writeOff);
    return out.buffer;
}

/**
 * 添加一个 VMD 图层到模型。
 * @param data VMD 二进制数据
 * @param name 图层显示名称
 * @param targetModelId 目标模型 ID
 * @param weight 混合权重 (0-1)
 * @param boneFilter 骨骼过滤（空=全部）
 */
export async function addVmdLayer(
    data: ArrayBuffer,
    name: string,
    targetModelId?: string,
    weight = 1.0,
    boneFilter: string[] = []
): Promise<VmdLayer | null> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        setStatus(t('scene.vmd.noTargetModel'), false);
        return null;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst?.mmdModel) {
        setStatus(t('scene.vmd.modelNoLayers'), false);
        return null;
    }

    // 重复检测：同名且同数据字节数的 VMD 不重复添加
    // ArrayBuffer 版没有路径，用 name + byteLength 作为近似去重键
    const dup = inst.vmdLayers.find(
        (l) => l.kind === 'vmd' && l.name === name && l.data.byteLength === data.byteLength
    );
    if (dup) {
        setStatus(t('scene.vmd.layerExists', { name }), false);
        return null;
    }

    const layer: VmdLayer = {
        id: _nextLayerId(),
        name,
        kind: 'vmd',
        data,
        path: null,
        weight,
        enabled: true,
        boneFilter,
    };

    inst.vmdLayers.push(layer);
    await _rebuildCompositeAnimation(inst.id);
    setStatus(t('scene.vmd.layerAdded', { name }), true);
    triggerAutoSave();
    return layer;
}

/** 从路径加载并添加 VMD 图层 */
export async function addVmdLayerFromPath(
    path: string,
    targetModelId?: string,
    weight = 1.0,
    boneFilter: string[] = []
): Promise<VmdLayer | null> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        setStatus(t('scene.vmd.noTargetModel'), false);
        return null;
    }
    const inst = modelRegistry.get(targetId);
    if (inst?.vmdLayers?.some((l) => l.path === path)) {
        setStatus(t('scene.vmd.layerExists', { name: getBaseName(path) }), false);
        return null;
    }
    try {
        const { data } = await fetchArrayBuffer(path);
        const vmdName = getBaseName(path) || '';
        const layer = await addVmdLayer(
            data,
            vmdName.replace(/\.vmd$/i, ''),
            targetId,
            weight,
            boneFilter
        );
        if (layer) {
            layer.path = path;
        }
        return layer;
    } catch (err) {
        console.error('addVmdLayerFromPath:', err);
        setStatus(t('scene.vmd.layerLoadFailed'), false);
        return null;
    }
}

/**
 * 批量添加 VMD 图层（场景恢复用）。
 * 所有图层只触发一次 composite rebuild，避免 N 次重复解析。
 */
export async function addVmdLayersFromPaths(
    layers: Array<{ path: string; weight: number; boneFilter: string[] }>,
    targetModelId?: string
): Promise<number> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        return 0;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst?.mmdModel) {
        return 0;
    }

    let addedCount = 0;
    const newLayers: Array<{
        data: ArrayBuffer;
        name: string;
        weight: number;
        path: string;
        boneFilter: string[];
    }> = [];

    for (const layer of layers) {
        if (inst.vmdLayers.some((l) => l.path === layer.path)) {
            continue;
        } // 跳过重复
        try {
            const { data } = await fetchArrayBuffer(layer.path);
            const vmdName = getBaseName(layer.path) || '';
            newLayers.push({
                data,
                name: vmdName.replace(/\.vmd$/i, ''),
                weight: layer.weight,
                path: layer.path,
                boneFilter: layer.boneFilter,
            });
            addedCount++;
        } catch (err) {
            logWarn('vmd-layers', `addVmdLayersFromPaths: skip ${layer.path}`, err);
        }
    }

    if (newLayers.length === 0) {
        return 0;
    }

    for (const nl of newLayers) {
        const vmLayer: VmdLayer = {
            id: _nextLayerId(),
            name: nl.name,
            kind: 'vmd',
            data: nl.data,
            path: nl.path,
            weight: nl.weight,
            enabled: true,
            boneFilter: nl.boneFilter,
        };
        inst.vmdLayers.push(vmLayer);
    }

    await _rebuildCompositeAnimation(targetId);
    setStatus(t('scene.vmd.layersRestored', { count: addedCount }), true);
    return addedCount;
}

/**
 * 添加一个视线追踪（gaze）图层。
 * gaze 图层不会参与 VMD composite 混合，而是通过 setGazeLayerActive 控制视线追踪状态。
 * 每个模型只允许一个 gaze 层，重复调用返回 null。
 */
export async function addGazeLayer(
    modelId: string,
    name?: string,
    weight = 1.0,
    enabled = true
): Promise<VmdLayer | null> {
    const inst = modelRegistry.get(modelId);
    if (!inst) {
        setStatus(t('scene.vmd.modelNotFound'), false);
        return null;
    }

    if (inst.vmdLayers.some((l) => l.kind === 'gaze')) {
        setStatus(t('scene.vmd.gazeExists'), false);
        return null;
    }

    const layer: VmdLayer = {
        id: _nextLayerId(),
        name: name ?? '视线追踪',
        kind: 'gaze',
        data: new ArrayBuffer(0),
        path: null,
        weight,
        enabled,
        boneFilter: [],
    };

    inst.vmdLayers.push(layer);
    if (enabled) {
        await _applyGazeLayers(modelId);
    }
    triggerAutoSave();
    return layer;
}

/** 移除一个 VMD 图层 */
export async function removeVmdLayer(layerId: string, targetModelId?: string): Promise<void> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        return;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst) {
        return;
    }

    const idx = inst.vmdLayers.findIndex((l) => l.id === layerId);
    if (idx === -1) {
        return;
    }

    const removed = inst.vmdLayers.splice(idx, 1)[0];
    if (removed.kind === 'gaze') {
        await _applyGazeLayers(inst.id);
    } else {
        await _rebuildCompositeAnimation(inst.id);
    }
    setStatus(t('scene.vmd.layerRemoved', { name: removed.name }), true);
    triggerAutoSave();
}

/** 切换图层启用/禁用 */
export async function toggleVmdLayer(layerId: string, targetModelId?: string): Promise<void> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        return;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst) {
        return;
    }

    const layer = inst.vmdLayers.find((l) => l.id === layerId);
    if (!layer) {
        return;
    }

    layer.enabled = !layer.enabled;
    if (layer.kind === 'gaze') {
        await _applyGazeLayers(inst.id);
    } else {
        await _rebuildCompositeAnimation(inst.id);
    }
    triggerAutoSave();
}

/** 设置图层权重 */
export async function setVmdLayerWeight(
    layerId: string,
    weight: number,
    targetModelId?: string
): Promise<void> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        return;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst) {
        return;
    }

    const layer = inst.vmdLayers.find((l) => l.id === layerId);
    if (!layer) {
        return;
    }

    layer.weight = clamp01(weight);
    if (layer.kind === 'gaze') {
        await _applyGazeLayers(inst.id);
    } else {
        await _rebuildCompositeAnimation(inst.id);
    }
    triggerAutoSave();
}

/** 清除所有图层 */
export async function clearVmdLayers(targetModelId?: string): Promise<void> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        return;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst) {
        return;
    }

    inst.vmdLayers = [];
    await _rebuildCompositeAnimation(inst.id);
    triggerAutoSave();
}

/**
 * 替换指定图层的 VMD（保留层 id / 权重 / 启用 / boneFilter，仅换动画数据）。
 * 对应「焦点动作替换」语义：只替换对应动作，不清旧 base / 其他图层。
 * @param layerId 目标图层 id
 * @param path 新 VMD 路径
 * @param targetModelId 目标模型 ID
 */
export async function replaceVmdLayerVmd(
    layerId: string,
    path: string,
    targetModelId?: string
): Promise<VmdLayer | null> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        setStatus(t('scene.vmd.noTargetModel'), false);
        return null;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst?.mmdModel) {
        setStatus(t('scene.vmd.modelNoLayers'), false);
        return null;
    }
    const layer = inst.vmdLayers.find((l) => l.id === layerId);
    if (!layer) {
        setStatus(t('scene.vmd.layerLoadFailed'), false);
        return null;
    }
    try {
        const { data } = await fetchArrayBuffer(path);
        const vmdName = getBaseName(path) || '';
        layer.data = data;
        layer.path = path;
        layer.name = vmdName.replace(/\.vmd$/i, '');
        if (layer.kind === 'gaze') {
            await _applyGazeLayers(inst.id);
        } else {
            await _rebuildCompositeAnimation(inst.id);
        }
        setStatus(t('scene.vmd.layerAdded', { name: layer.name }), true);
        triggerAutoSave();
        return layer;
    } catch (err) {
        console.error('replaceVmdLayerVmd:', err);
        setStatus(t('scene.vmd.layerLoadFailed'), false);
        return null;
    }
}

/** 各模型上一次 gaze 激活状态，用于避免重复调用 setGazeLayerActive */
const _prevGazeActiveMap = new Map<string, boolean>();

/**
 * 快速应用 gaze 层状态（不触发 VMD 重载）。
 * toggle/weight/remove 等仅涉及 gaze 层的操作走此路径。
 */
async function _applyGazeLayers(modelId: string): Promise<void> {
    const inst = modelRegistry.get(modelId);
    if (!inst) {
        return;
    }

    const enabledGaze = inst.vmdLayers.filter((l) => l.kind === 'gaze' && l.enabled);
    const hasActiveGaze = enabledGaze.length > 0;
    const prevActive = _prevGazeActiveMap.get(modelId) ?? false;
    // 无论状态是否变化，只要 gaze 启用就调用（权重可能变了）；
    // 关闭时才只需在状态切换时调用
    if (hasActiveGaze || hasActiveGaze !== prevActive) {
        _prevGazeActiveMap.set(modelId, hasActiveGaze);
        try {
            const { setGazeLayerActive } = await import('./proc-motion-bridge');
            if (typeof setGazeLayerActive === 'function') {
                setGazeLayerActive(hasActiveGaze, hasActiveGaze ? enabledGaze[0].weight : 0);
            }
        } catch {
            // proc-motion-bridge not available
        }
    }
}

/** rebuild 并发守护：每次调用递增，await 后校验是否过期 */
const _rebuildGenMap = new Map<string, number>();

/**
 * 根据当前图层列表重建 MmdCompositeAnimation 并应用到模型。
 * 核心逻辑：每个启用的 VMD 图层 = 一个 MmdAnimationSpan，权重由 layer.weight 控制。
 * gaze 图层不参与 composite 混合，而是通过 setGazeLayerActive 单独控制。
 */
async function _rebuildCompositeAnimation(modelId: string): Promise<void> {
    const gen = (_rebuildGenMap.get(modelId) ?? 0) + 1;
    _rebuildGenMap.set(modelId, gen);

    const { scene } = await getScene();

    // await 后校验：若有新调用则放弃本次（最后调用的会胜出）
    if (_rebuildGenMap.get(modelId) !== gen) {
        return;
    }

    const inst = modelRegistry.get(modelId);
    if (!inst?.mmdModel) {
        return;
    }

    // 捕获图层快照，避免 await 期间图层被外部修改导致不一致
    const layersSnapshot = [...inst.vmdLayers];

    // WASM blender 激活时先 teardown，防止 observer 泄漏
    // 多图层分支会重新 setupWasmLayersBlender
    try {
        const { isWasmLayersBlenderActive, teardownWasmLayersBlender } =
            await import('./wasm-layers-blender');
        if (isWasmLayersBlenderActive(modelId)) {
            teardownWasmLayersBlender(modelId);
        }
    } catch {
        // blender 模块不可用，忽略
    }

    const enabledLayers = layersSnapshot.filter((l) => l.enabled);
    const vmdEnabledLayers = enabledLayers.filter((l) => l.kind === 'vmd');

    // ── Gaze 层处理（快速路径，不参与 VMD composite） ──
    await _applyGazeLayers(modelId);

    // await 后再次校验 gen
    if (_rebuildGenMap.get(modelId) !== gen) {
        return;
    }

    const hasBaseVmd = !!inst.vmdData;

    // 没有 VMD 图层 → 回退到单 VMD 模式（如果有 vmdData）
    if (vmdEnabledLayers.length === 0) {
        if (hasBaseVmd) {
            const { loadVMDMotion } = await import('./vmd-loader');
            if (_rebuildGenMap.get(modelId) !== gen) {
                return;
            }
            await loadVMDMotion(inst.vmdData, inst.vmdName, modelId);
        }
        return;
    }

    // 单一 VMD 图层且无基础 VMD → 直接加载，不需要 composite
    if (vmdEnabledLayers.length === 1 && !hasBaseVmd) {
        const layer = vmdEnabledLayers[0];
        const { loadVMDMotion } = await import('./vmd-loader');
        if (_rebuildGenMap.get(modelId) !== gen) {
            return;
        }
        const loadData = layer.boneFilter?.length
            ? _filterVmdBones(layer.data, layer.boneFilter)
            : layer.data;
        await loadVMDMotion(loadData, layer.name, modelId);
        return;
    }

    // 多个动画（基础 VMD + VMD 图层）→ 创建 MmdCompositeAnimation 混合叠加
    try {
        const vmdLoader = new VmdLoader(scene);
        const composite = new MmdCompositeAnimation('motionLayers');
        const sources: {
            data: ArrayBuffer;
            name: string;
            weight: number;
            boneFilter?: string[];
        }[] = [];
        let maxEndFrame = 0;
        try {
            // 收集所有待混合的动画条目：基础 VMD（weight=1.0）+ 各启用的 VMD 图层
            if (hasBaseVmd) {
                sources.push({ data: inst.vmdData, name: inst.vmdName || 'base', weight: 1.0 });
            }
            for (const layer of vmdEnabledLayers) {
                sources.push({
                    data: layer.data,
                    name: layer.name,
                    weight: layer.weight,
                    boneFilter: layer.boneFilter,
                });
            }

            // weight 归一化：确保总权重 = 1.0，避免多层叠加时骨骼旋转溢出
            const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);

            for (const src of sources) {
                const loadData = src.boneFilter?.length
                    ? _filterVmdBones(src.data, src.boneFilter)
                    : src.data;
                const mmdAnimation = await vmdLoader.loadFromBufferAsync(src.name, loadData);
                const endFrame = mmdAnimation.endFrame;
                if (endFrame > maxEndFrame) {
                    maxEndFrame = endFrame;
                }

                const normalizedWeight = totalWeight > 0 ? src.weight / totalWeight : 0;
                const span = new MmdAnimationSpan(
                    mmdAnimation,
                    0, // startFrame
                    endFrame, // endFrame
                    0, // offset (所有动画从头开始)
                    normalizedWeight
                );
                composite.addSpan(span);
            }
        } finally {
            vmdLoader.dispose();
        }

        // WASM 运行时：使用 JS 帧流合并的 blender 方案
        if (mmdRuntime instanceof MmdWasmRuntime) {
            const totalSources = sources.length;
            if (totalSources > 1) {
                const blendEnabled = import.meta.env.VITE_WASM_LAYERS_BLEND !== '0';
                if (blendEnabled) {
                    try {
                        const { setupWasmLayersBlender, addWasmLayer } =
                            await import('./wasm-layers-blender');

                        const baseSrc = sources[0];
                        await setupWasmLayersBlender(modelId, baseSrc.data, baseSrc.name);

                        for (let i = 1; i < sources.length; i++) {
                            const src = sources[i];
                            await addWasmLayer(modelId, {
                                id: `layer_${i}`,
                                data: src.data,
                                weight: src.weight,
                                boneFilter: src.boneFilter,
                                name: src.name,
                            });
                        }

                        inst.animationDuration = maxEndFrame / 30;
                        const compositeName = sources.map((s) => s.name).join(' + ');
                        setStatus(
                            t('scene.vmd.layersBlendedBlender', { names: compositeName }),
                            true
                        );
                        triggerAutoSave();
                        return;
                    } catch (err) {
                        console.error(
                            '[MotionLayers] WASM blender failed, falling back to single layer',
                            err
                        );
                    }
                }
            }

            const primarySrc = sources[0];
            const { loadVMDMotion } = await import('./vmd-loader');
            await loadVMDMotion(primarySrc.data, primarySrc.name, modelId);
            setStatus(t('scene.vmd.wasmSingleLayer', { name: primarySrc.name }), false);
            return;
        }

        // MmdCompositeAnimation 经类型增强已实现 IMmdBindableModelAnimation（babylon-mmd 在
        // mmdCompositeRuntimeModelAnimation 中声明的 module augmentation），可直接传入，无需双重 cast

        // 绑定到模型
        inst.mmdModel.setRuntimeAnimation(null);
        const handle = inst.mmdModel.createRuntimeAnimation(composite);
        inst.mmdModel.setRuntimeAnimation(handle);

        // 切换动作归零运行时全局时钟到第 0 帧：setRuntimeAnimation 只换动画句柄，不重置
        // _currentFrameTime。若上一动作播到 50s、本合成动作仅 10s，陈旧时钟越过新时长 →
        // 下一帧 beforePhysics 立即 pause → 表现为「0.01s 后被重置为无动作」。
        // 与 loadVMDMotion 的修复对齐（ADR-106 生命周期隔离：仅改时钟，不破坏主视图）。
        try {
            await mmdRuntime.seekAnimation(0, true);
        } catch {
            // 归零失败不影响绑定，下一帧主循环纠正
        }
        // 绑定后确保播放：原本在播放则 seek 后从第 0 帧续播；暂停且开启循环则启动。
        // 与 loadVMDMotion 末尾逻辑对齐（autoLoop 关闭且本就暂停时保持静止，符合预期）。
        if (!isPlaying && autoLoop) {
            try {
                await mmdRuntime.playAnimation();
                setIsPlaying(true);
            } catch {
                // 启动播放失败不阻断绑定
            }
        }

        // 更新模型状态
        inst.animationDuration = maxEndFrame / 30;
        const compositeName = sources.map((s) => s.name).join(' + ');

        setStatus(t('scene.vmd.layersBlended', { names: compositeName }), true);
        triggerAutoSave();
    } catch (err) {
        console.error('Motion Layers rebuild failed:', err);
        setStatus(t('scene.vmd.blendFailed'), false);
    }
}

/** 获取模型的图层列表 */
export function getVmdLayers(modelId: string): VmdLayer[] {
    const inst = modelRegistry.get(modelId);
    return inst?.vmdLayers ?? [];
}
