// [doc:architecture] Motion Layers — 多 VMD 叠加系统
// 职责: 管理模型的多层 VMD 动画，通过 MmdCompositeAnimation 混合
// 依赖: config.ts + scene.ts (懒加载避免循环依赖)

import { VmdLoader } from 'babylon-mmd/esm/Loader/vmdLoader';
import { MmdWasmAnimation } from 'babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { MmdCompositeAnimation, MmdAnimationSpan } from 'babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation';
import type { VmdLayer } from '../../core/types';
import {
    mmdRuntime,
    modelRegistry,
    focusedModelId,
    setStatus,
    triggerAutoSave,
} from '../../core/config';
import { resolveFileUrl, normPath } from '../../core/fileservice';

function getScene() {
    return import('../scene') as Promise<typeof import('../scene')>;
}

let _layerIdCounter = 0;

/** 生成唯一图层 ID */
function _nextLayerId(): string {
    return `layer_${++_layerIdCounter}`;
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
        setStatus('✗ 没有目标模型', false);
        return null;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst?.mmdModel) {
        setStatus('✗ 目标模型不支持图层', false);
        return null;
    }

    const layer: VmdLayer = {
        id: _nextLayerId(),
        name,
        data,
        path: null,
        weight,
        enabled: true,
        boneFilter,
    };

    inst.vmdLayers.push(layer);
    await _rebuildCompositeAnimation(inst.id);
    setStatus(`✓ 图层已添加: ${name}`, true);
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
    try {
        const { url } = await resolveFileUrl(path);
        const vmdName = normPath(path).split('/').pop() || '';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.arrayBuffer();
        const layer = await addVmdLayer(
            data,
            vmdName.replace(/\.vmd$/i, ''),
            targetModelId,
            weight,
            boneFilter
        );
        if (layer) {
            layer.path = path;
        }
        return layer;
    } catch (err) {
        console.error('addVmdLayerFromPath:', err);
        setStatus('✗ 图层加载失败', false);
        return null;
    }
}

/** 移除一个 VMD 图层 */
export async function removeVmdLayer(
    layerId: string,
    targetModelId?: string
): Promise<void> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) return;
    const inst = modelRegistry.get(targetId);
    if (!inst) return;

    const idx = inst.vmdLayers.findIndex(l => l.id === layerId);
    if (idx === -1) return;

    const removed = inst.vmdLayers.splice(idx, 1)[0];
    await _rebuildCompositeAnimation(inst.id);
    setStatus(`✓ 图层已移除: ${removed.name}`, true);
    triggerAutoSave();
}

/** 切换图层启用/禁用 */
export async function toggleVmdLayer(
    layerId: string,
    targetModelId?: string
): Promise<void> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) return;
    const inst = modelRegistry.get(targetId);
    if (!inst) return;

    const layer = inst.vmdLayers.find(l => l.id === layerId);
    if (!layer) return;

    layer.enabled = !layer.enabled;
    await _rebuildCompositeAnimation(inst.id);
    triggerAutoSave();
}

/** 设置图层权重 */
export async function setVmdLayerWeight(
    layerId: string,
    weight: number,
    targetModelId?: string
): Promise<void> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) return;
    const inst = modelRegistry.get(targetId);
    if (!inst) return;

    const layer = inst.vmdLayers.find(l => l.id === layerId);
    if (!layer) return;

    layer.weight = Math.max(0, Math.min(1, weight));
    await _rebuildCompositeAnimation(inst.id);
    triggerAutoSave();
}

/** 清除所有图层 */
export async function clearVmdLayers(targetModelId?: string): Promise<void> {
    const targetId = targetModelId || focusedModelId;
    if (!targetId) return;
    const inst = modelRegistry.get(targetId);
    if (!inst) return;

    inst.vmdLayers = [];
    await _rebuildCompositeAnimation(inst.id);
    triggerAutoSave();
}

/**
 * 根据当前图层列表重建 MmdCompositeAnimation 并应用到模型。
 * 核心逻辑：每个启用的图层 = 一个 MmdAnimationSpan，权重由 layer.weight 控制。
 */
async function _rebuildCompositeAnimation(modelId: string): Promise<void> {
    const { scene } = await getScene();
    const inst = modelRegistry.get(modelId);
    if (!inst?.mmdModel) return;

    const enabledLayers = inst.vmdLayers.filter(l => l.enabled);

    if (enabledLayers.length === 0) {
        // 没有图层 → 回退到单 VMD 模式（如果有 vmdData）
        if (inst.vmdData) {
            const { loadVMDMotion } = await import('./vmd-loader');
            await loadVMDMotion(inst.vmdData, inst.vmdName, modelId);
        }
        return;
    }

    if (enabledLayers.length === 1 && inst.vmdLayers.length === 1) {
        // 只有一个图层 → 直接加载，不需要 composite
        const layer = enabledLayers[0];
        const { loadVMDMotion } = await import('./vmd-loader');
        await loadVMDMotion(layer.data, layer.name, modelId);
        return;
    }

    // 多个图层 → 创建 MmdCompositeAnimation
    try {
        const vmdLoader = new VmdLoader(scene);
        const composite = new MmdCompositeAnimation('motionLayers');

        let maxEndFrame = 0;

        // weight 归一化：确保总权重 = 1.0，避免多层 weight=1.0 时骨骼旋转溢出
        const totalWeight = enabledLayers.reduce((sum, l) => sum + l.weight, 0);

        for (const layer of enabledLayers) {
            const mmdAnimation = await vmdLoader.loadFromBufferAsync(layer.name, layer.data);
            const endFrame = mmdAnimation.endFrame;
            if (endFrame > maxEndFrame) maxEndFrame = endFrame;

            const normalizedWeight = totalWeight > 0 ? layer.weight / totalWeight : 0;
            const span = new MmdAnimationSpan(
                mmdAnimation,
                0,          // startFrame
                endFrame,   // endFrame
                0,          // offset (所有图层从头开始)
                normalizedWeight
            );
            composite.addSpan(span);
        }

        (vmdLoader as unknown as { dispose?: () => void }).dispose?.();

        // WASM 运行时不支持 MmdCompositeAnimation（缺 createRuntimeModelAnimation），
        // 回退到主图层
        if (mmdRuntime instanceof MmdWasmRuntime) {
            if (enabledLayers.length > 1) {
                console.warn(`[MotionLayers] WASM runtime: ${enabledLayers.length} layers requested, only primary layer supported`);
            }
            const primaryLayer = enabledLayers[0];
            const { loadVMDMotion } = await import('./vmd-loader');
            await loadVMDMotion(primaryLayer.data, primaryLayer.name, modelId);
            setStatus(`⚠ WASM 仅支持单图层，已加载: ${primaryLayer.name}`, false);
            return;
        }

        // JS 运行时：MmdCompositeAnimation 可直接绑定
        const runtimeAnimation = composite as unknown as import('babylon-mmd/esm/Runtime/Animation/IMmdBindableAnimation').IMmdBindableModelAnimation;

        // 绑定到模型
        inst.mmdModel.setRuntimeAnimation(null);
        const handle = inst.mmdModel.createRuntimeAnimation(runtimeAnimation);
        inst.mmdModel.setRuntimeAnimation(handle);

        // 更新模型状态（保留 vmdData 用于序列化）
        inst.animationDuration = maxEndFrame / 30;
        inst.vmdName = enabledLayers.map(l => l.name).join(' + ');

        setStatus(`✓ 图层混合: ${inst.vmdName}`, true);
        triggerAutoSave();
    } catch (err) {
        console.error('Motion Layers rebuild failed:', err);
        setStatus('✗ 图层混合失败', false);
    }
}

/** 获取模型的图层列表 */
export function getVmdLayers(modelId: string): VmdLayer[] {
    const inst = modelRegistry.get(modelId);
    return inst?.vmdLayers ?? [];
}
