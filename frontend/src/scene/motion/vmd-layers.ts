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
import { feedbackStatus } from '@/core/feedback';
import { switchAnimation } from '@/core/mmd-adapter';
import { showInfoToast } from '@/core/toast';
import { readFileBytes } from '@/core/wails-bindings';
import { getBaseName } from '@/core/path';
import { clamp01 } from '@/core/clamp';
import { logWarn } from '@/core/logger';
import { t } from '@/core/i18n/t';
import { translateGoError } from '@/core/i18n/goerr';
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
 *
 * @internal — exported for testing
 */
export function _filterVmdBones(data: ArrayBuffer, boneFilter: string[]): ArrayBuffer {
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
        feedbackStatus('scene.vmd.noTargetModel', undefined, false);
        return null;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst?.mmdModel) {
        feedbackStatus('scene.vmd.modelNoLayers', undefined, false);
        return null;
    }

    // 重复检测：同名且同数据字节数的 VMD 不重复添加
    // ArrayBuffer 版没有路径，用 name + byteLength 作为近似去重键
    const dup = inst.vmdLayers.find(
        (l) => l.kind === 'vmd' && l.name === name && l.data.byteLength === data.byteLength
    );
    if (dup) {
        feedbackStatus('scene.vmd.layerExists', undefined, false, { name });
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
    showInfoToast(t('scene.vmd.layerAdded', { name }));
    triggerAutoSave();
    return layer;
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
            const vmdData = await readFileBytes(layer.path);
            if (!vmdData) {
                logWarn('vmd-layers', 'Failed to read VMD file:', layer.path);
                continue;
            }
            const data = vmdData.buffer as ArrayBuffer;
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
    showInfoToast(t('scene.vmd.layersRestored', { count: addedCount }));
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
        feedbackStatus('scene.vmd.modelNotFound', undefined, false);
        return null;
    }

    if (inst.vmdLayers.some((l) => l.kind === 'gaze')) {
        feedbackStatus('scene.vmd.gazeExists', undefined, false);
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
    showInfoToast(t('scene.vmd.layerRemoved', { name: removed.name }));
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

    // 无图层 / 单图层回退路径（不需要 MmdCompositeAnimation 混合）
    if (vmdEnabledLayers.length === 0 || (vmdEnabledLayers.length === 1 && !hasBaseVmd)) {
        await _rebuildFallback(modelId, gen, inst, vmdEnabledLayers, hasBaseVmd);
        return;
    }

    // 多动画合成（基础 VMD + 图层）→ WASM blender 或 JS MmdCompositeAnimation
    await _rebuildComposite(modelId, gen, inst, vmdEnabledLayers, hasBaseVmd, scene);
}

/**
 * 回退路径：无 VMD 图层 → 加载基础 VMD；单图层且无基础 → 过滤后直接加载。
 * 不需要 MmdCompositeAnimation 混合的场景。共享状态显式传参（ADR-237 P2）。
 */
async function _rebuildFallback(
    modelId: string,
    gen: number,
    inst: import('../../core/config').ModelInstance,
    vmdEnabledLayers: VmdLayer[],
    hasBaseVmd: boolean
): Promise<void> {
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
    const layer = vmdEnabledLayers[0];
    const { loadVMDMotion } = await import('./vmd-loader');
    if (_rebuildGenMap.get(modelId) !== gen) {
        return;
    }
    const loadData = layer.boneFilter?.length
        ? _filterVmdBones(layer.data, layer.boneFilter)
        : layer.data;
    await loadVMDMotion(loadData, layer.name, modelId);
}

/**
 * 多动画合成：构建 MmdCompositeAnimation（基础 VMD + 各 VMD 图层），权重归一化后绑定。
 * WASM 运行时优先走 blender 方案（_tryWasmBlender），失败降级单层。
 * 共享状态显式传参（ADR-237 P2）；保持动态 import 不引入新循环依赖。
 */
async function _rebuildComposite(
    modelId: string,
    gen: number,
    inst: import('../../core/config').ModelInstance,
    vmdEnabledLayers: VmdLayer[],
    hasBaseVmd: boolean,
    scene: import('@babylonjs/core/scene').Scene
): Promise<void> {
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
                // [audit] 循环内多次 await：每次迭代后校验 gen，防止加载多个图层期间
                // 新 rebuild 已开始（旧结果应被丢弃，避免覆盖新图层状态）
                if (_rebuildGenMap.get(modelId) !== gen) {
                    return;
                }
                const loadData = src.boneFilter?.length
                    ? _filterVmdBones(src.data, src.boneFilter)
                    : src.data;
                const mmdAnimation = await vmdLoader.loadFromBufferAsync(src.name, loadData);
                // [fix P2] await 后重校验 gen：加载期间新 rebuild 到来时放弃本次，
                // 避免继续消费剩余 sources 构建被丢弃的 span（与 L534 循环顶部检查配对）
                if (_rebuildGenMap.get(modelId) !== gen) {
                    return;
                }
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
            // VmdLoader 无 dispose() API（fork 实现），loader 为局部引用，GC 自动回收
        }

        // [audit] 绑定前最终校验：sources 加载完成后、apply 前再确认 gen 未过期
        if (_rebuildGenMap.get(modelId) !== gen) {
            return;
        }

        // WASM 运行时：优先 JS 帧流合并的 blender 方案，失败降级单层
        if (mmdRuntime instanceof MmdWasmRuntime) {
            if (sources.length > 1 && import.meta.env.VITE_WASM_LAYERS_BLEND !== '0') {
                if (await _tryWasmBlender(modelId, inst, sources, maxEndFrame, scene)) {
                    return;
                }
            }
            const primarySrc = sources[0];
            const { loadVMDMotion } = await import('./vmd-loader');
            await loadVMDMotion(primarySrc.data, primarySrc.name, modelId);
            feedbackStatus('scene.vmd.wasmSingleLayer', undefined, false, {
                name: primarySrc.name,
            });
            return;
        }

        // MmdCompositeAnimation 经类型增强已实现 IMmdBindableModelAnimation（babylon-mmd 在
        // mmdCompositeRuntimeModelAnimation 中声明的 module augmentation），可直接传入，无需双重 cast

        // 绑定到模型（切换 VMD 图层）：释放旧句柄 + 绑定合成动画 + 归零时钟。
        // 封装于 mmd-adapter PlaybackContract.switchAnimation（见 ADR-192）；
        // 与 loadVMDMotion 的修复对齐（ADR-106 生命周期隔离：仅改时钟，不破坏主视图）。
        await switchAnimation(mmdRuntime, inst.mmdModel, composite);
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

        showInfoToast(t('scene.vmd.layersBlended', { names: compositeName }));
        triggerAutoSave();
    } catch (err) {
        console.error('Motion Layers rebuild failed:', err);
        feedbackStatus('scene.vmd.blendFailed', undefined, false);
    }
}

/**
 * WASM blender 专用路径：init 依赖注入 + setup 基础层 + addWasmLayer 各图层。
 * 成功返回 true；失败（含 blender 模块不可用）返回 false 并提示降级。
 * 共享状态显式传参；保持动态 import 避免与 wasm-layers-blender 静态循环（ADR-236）。
 */
async function _tryWasmBlender(
    modelId: string,
    inst: import('../../core/config').ModelInstance,
    sources: {
        data: ArrayBuffer;
        name: string;
        weight: number;
        boneFilter?: string[];
    }[],
    maxEndFrame: number,
    scene: import('@babylonjs/core/scene').Scene
): Promise<boolean> {
    try {
        const { initWasmLayersBlender, setupWasmLayersBlender, addWasmLayer } =
            await import('./wasm-layers-blender');
        const { modelManager } = await getScene();
        const { loadVMDMotion } = await import('./vmd-loader');

        initWasmLayersBlender({ scene, modelManager, loadVMDMotion });

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
        showInfoToast(t('scene.vmd.layersBlendedBlender', { names: compositeName }));
        triggerAutoSave();
        return true;
    } catch (err) {
        console.error('[MotionLayers] WASM blender failed, falling back to single layer', err);
        // P3-fix: 明确告知用户多图层混合失败已降级，而非静默回退
        setStatus(
            t('scene.vmd.layersBlendFailedFallback', {
                reason: err instanceof Error ? translateGoError(err) : String(err),
            }),
            false
        );
        return false;
    }
}

/** 获取模型的图层列表 */
export function getVmdLayers(modelId: string): VmdLayer[] {
    const inst = modelRegistry.get(modelId);
    return inst?.vmdLayers ?? [];
}

/** 触发复合动画重建（程序化/外部修改 vmdData/vmdLayers 后调用）。
 *  内部有 generation 去重，连续调用不会重复执行。 */
export function rebuildCompositeAnimation(modelId: string): void {
    void _rebuildCompositeAnimation(modelId);
}

/** [fix P2] 模型销毁时清理 vmd-layers 模块级 per-model 状态。
 *  由 model-manager.remove 调用；防止 _rebuildGenMap/_prevGazeActiveMap 条目积累，
 *  并避免同 ID 复用场景读到陈旧 gen/gaze 状态。 */
export function disposeVmdLayerState(modelId: string): void {
    _rebuildGenMap.delete(modelId);
    _prevGazeActiveMap.delete(modelId);
}
