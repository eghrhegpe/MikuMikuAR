// [doc:adr-144] Overlay Manager — Per-model 叠加动作管理
// 职责: 管理每个模型的 overlay VMD 层（叠加在 primary 基础动作之上）
// 设计: overlay = vmdLayers 中一个带 'overlay_' 前缀的特殊条目，复用已有 VMD 图层混合管线

import type { VmdLayer, MotionSlotConfig } from '@/core/types';
import { modelRegistry, focusedModelId, triggerAutoSave } from '@/core/config';
import { getBaseName, clamp01 } from '@/core/utils';
import { logWarn } from '@/core/logger';
import { readFileBytes } from '@/core/wails-bindings';
import {
    addVmdLayer,
    removeVmdLayer,
    setVmdLayerWeight,
    getVmdLayers,
} from './vmd-layers';

/** overlay 层 id 前缀，用于在 vmdLayers 中标识 overlay 条目 */
const OVERLAY_PREFIX = 'ovl_';

// ── 工具函数 ──

/** 获取模型的 motionSlots（懒初始化） */
function _ensureMotionSlots(modelId: string) {
    const inst = modelRegistry.get(modelId);
    if (!inst) {
        return null;
    }
    if (!inst.motionSlots) {
        inst.motionSlots = {
            primary: { source: 'inherit', status: 'idle' },
            overlay: { source: 'inherit', status: 'idle' },
        };
    }
    return inst.motionSlots;
}

/** 在 vmdLayers 中查找 overlay 层（通过 id 前缀识别） */
function _findOverlayLayer(modelId: string): VmdLayer | undefined {
    return getVmdLayers(modelId).find(
        (l) => l.id.startsWith(OVERLAY_PREFIX) && l.kind === 'vmd'
    );
}

// ── 公开 API ──

/**
 * 确保 overlay 图层存在并注入到 vmdLayers。
 * 若已有 overlay，先清除再注入新的。
 */
export async function ensureOverlayLayer(
    modelId: string,
    vmdPath: string,
    name: string,
    weight = 1.0
): Promise<VmdLayer | null> {
    const targetId = modelId || focusedModelId;
    if (!targetId) {
        return null;
    }

    // 先清除旧 overlay
    await clearOverlayLayer(targetId);

    // 读取 VMD 文件
    try {
        const vmdData = await readFileBytes(vmdPath);
        if (!vmdData) {
            logWarn('overlay-manager', 'Failed to read overlay VMD:', vmdPath);
            return null;
        }
        const data = vmdData.buffer as ArrayBuffer;
        const layer = await addVmdLayer(data, name, targetId, weight, []);
        if (layer) {
            // 替换 id 为 overlay 前缀，便于后续识别
            layer.id = `${OVERLAY_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
            layer.path = vmdPath;

            // 更新 motionSlots.overlay 状态
            const slots = _ensureMotionSlots(targetId);
            if (slots) {
                slots.overlay = {
                    source: 'pinned',
                    status: 'idle',
                    overlayPath: vmdPath,
                    overlayName: name,
                    overlayWeight: weight,
                };
            }
            triggerAutoSave();
        }
        return layer;
    } catch (err) {
        logWarn('overlay-manager', 'Failed to load overlay VMD:', err);
        return null;
    }
}

/** 清除 overlay 图层（从 vmdLayers 中移除 overlay_ 前缀的条目） */
export async function clearOverlayLayer(modelId: string): Promise<void> {
    const targetId = modelId || focusedModelId;
    if (!targetId) {
        return;
    }

    const overlayLayer = _findOverlayLayer(targetId);
    if (overlayLayer) {
        await removeVmdLayer(overlayLayer.id, targetId);
        // 仅在 overlay 层实际存在时才重置 motionSlots
        const slots = _ensureMotionSlots(targetId);
        if (slots) {
            slots.overlay = { source: 'inherit', status: 'idle' };
        }
        triggerAutoSave();
    }
}

/** 设置 overlay 权重 */
export async function setOverlayWeight(
    modelId: string,
    weight: number
): Promise<void> {
    const targetId = modelId || focusedModelId;
    if (!targetId) {
        return;
    }

    const overlayLayer = _findOverlayLayer(targetId);
    if (overlayLayer) {
        await setVmdLayerWeight(overlayLayer.id, weight, targetId);

        // 同步更新 motionSlots.overlay.overlayWeight（仅 pinned 源）
        const slots = _ensureMotionSlots(targetId);
        if (slots && slots.overlay.source === 'pinned') {
            slots.overlay.overlayWeight = clamp01(weight);
        }
        triggerAutoSave();
    }
}

/** 获取当前 overlay 层信息 */
export function getOverlayLayer(modelId: string): VmdLayer | undefined {
    const targetId = modelId || focusedModelId;
    if (!targetId) {
        return undefined;
    }
    return _findOverlayLayer(targetId);
}

/** 获取 overlay 状态摘要（供 UI 使用，无副作用） */
export function getOverlayStatus(modelId: string): {
    hasOverlay: boolean;
    name: string;
    weight: number;
    source: MotionSlotConfig['source'];
} {
    const targetId = modelId || focusedModelId;
    if (!targetId) {
        return { hasOverlay: false, name: '', weight: 1, source: 'inherit' };
    }

    const layer = _findOverlayLayer(targetId);
    const inst = modelRegistry.get(targetId);
    const source = inst?.motionSlots?.overlay.source ?? 'inherit';

    return {
        hasOverlay: !!layer,
        name: layer?.name || '',
        weight: layer?.weight ?? 1,
        source,
    };
}
