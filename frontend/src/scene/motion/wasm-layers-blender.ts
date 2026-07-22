// [doc:adr-056] WASM 图层混合器 — JS 帧流合并让 WASM 拿到多图层能力
// 复用 perception.ts 的 _isWasmRuntime / _writeMatToBuffer / _propagateChildrenWasm
//
// 职责: 注册为 MotionPipeline vmd-layers 层，在 bone-override 之前执行图层混合。
// gaze 覆写已由 perception 层统一处理（参见 ADR-071），本模块不再涉及 gaze。
//
// 时序治理（ADR-147）：
// - wasm-layers-blender 原为独立 onBeforeRenderObservable 观察者，
//   注册时机晚于 Pipeline 驱动（setupWasmLayersBlender 在运行时被调用），
//   导致 vmd-layers 阶段（②）在 bone-override（⑤）和 perception（⑥）之后执行，
//   图层混合的世界矩阵写入覆盖了骨骼覆盖/感知层的输出。
// - 修复：注册为 Pipeline 的 vmd-layers 层，由 MotionPipeline 按 (stage, order) 统一调度。

import type { Scene } from '@babylonjs/core/scene';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Matrix } from '@babylonjs/core/Maths/math';
import { _isWasmRuntime, _writeMatToBuffer, _propagateChildrenWasm } from './perception';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import { createVmdEvaluator, type VmdEvaluator } from '@/motion-algos/vmd-evaluator';
import { DEFAULT_LAYER_BONE_FILTER } from './wasm-layers-config';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { clamp01 } from '@/core/utils';
import { getMotionPipeline } from './motion-pipeline';
import type { ModelManager } from '../manager/model-manager';

// ── 依赖注入：打破 wasm-layers-blender → scene.ts 的静态循环依赖 ──
// vmd-layers.ts 在调用 setupWasmLayersBlender 前必须调用 initWasmLayersBlender。
// 所有引用 scene.ts 的函数通过 _requireDeps() 获取，而非静态 import。

interface BlenderDeps {
    scene: Scene;
    modelManager: ModelManager;
    loadVMDMotion: (data: ArrayBuffer, name: string, modelId?: string) => Promise<void>;
}

let _deps: BlenderDeps | null = null;

function _requireDeps(): BlenderDeps {
    if (!_deps) {
        throw new Error(
            'WASM layers blender not initialized — call initWasmLayersBlender before setupWasmLayersBlender'
        );
    }
    return _deps;
}

/** 初始化 blender 的场景级依赖（必须在 setupWasmLayersBlender 之前调用）。
 *  此函数打破 wasm-layers-blender → scene.ts 的循环依赖链。 */
export function initWasmLayersBlender(deps: BlenderDeps): void {
    _deps = deps;
}

export { DEFAULT_LAYER_BONE_FILTER } from './wasm-layers-config';

export interface WasmLayerConfig {
    id: string;
    data: ArrayBuffer;
    weight: number;
    boneFilter?: string[];
    name?: string;
}

interface WasmLayerEntry {
    evaluator: VmdEvaluator;
    weight: number;
    boneFilter: string[];
    name: string;
}

interface BlenderState {
    modelId: string;
    layers: Map<string, WasmLayerEntry>;
    enabled: boolean;
    baseAnimationName: string;
    animationFrame: number;
}

const _blenderStates = new Map<string, BlenderState>();

const VMD_FPS = 30;

// ── Pipeline vmd-layers 层 ──────────────────────────────────────────────
// 注册一次，在 bone-override 之前执行所有活跃模型的 WASM 图层混合。
let _vmdLayersRegistered = false;

function _ensureVmdLayersLayer(): void {
    if (_vmdLayersRegistered) {
        return;
    }
    _vmdLayersRegistered = true;
    getMotionPipeline().register({
        id: 'wasm-vmd-layers',
        stage: 'vmd-layers',
        order: 0,
        run: () => {
            for (const [modelId, state] of _blenderStates) {
                if (!state.enabled) {
                    continue;
                }
                const dt = _requireDeps().scene.deltaTime || 16.67;
                state.animationFrame += (dt / 1000) * VMD_FPS;
                _applyLayersBlending(modelId);
            }
        },
    });
}

// ── 公开 API ────────────────────────────────────────────────────────────

export async function setupWasmLayersBlender(
    modelId: string,
    baseData: ArrayBuffer,
    baseName: string
): Promise<void> {
    teardownWasmLayersBlender(modelId);

    const inst = _requireDeps().modelManager.get(modelId);
    if (!inst?.mmdModel) {
        throw new Error(`Model ${modelId} not found`);
    }

    // 确保 vmd-layers 管线段已注册（幂等）
    _ensureVmdLayersLayer();

    _blenderStates.set(modelId, {
        modelId,
        layers: new Map(),
        enabled: true,
        baseAnimationName: baseName,
        animationFrame: 0,
    });

    await _requireDeps().loadVMDMotion(baseData, baseName, modelId);
}

export function teardownWasmLayersBlender(modelId: string): void {
    const state = _blenderStates.get(modelId);
    if (!state) {
        return;
    }

    // 无独立 observer 需 dispose — 由 Pipeline vmd-layers 层统一调度
    for (const [, layer] of state.layers) {
        layer.evaluator.dispose();
    }
    state.layers.clear();

    _blenderStates.delete(modelId);
}

export function isWasmLayersBlenderActive(modelId: string): boolean {
    return _blenderStates.has(modelId) && _blenderStates.get(modelId)!.enabled;
}

export async function addWasmLayer(modelId: string, config: WasmLayerConfig): Promise<void> {
    const state = _blenderStates.get(modelId);
    if (!state) {
        throw new Error(`Blender not setup for model ${modelId}`);
    }

    if (state.layers.has(config.id)) {
        removeWasmLayer(modelId, config.id);
    }

    const evaluator = await createVmdEvaluator(config.data);
    state.layers.set(config.id, {
        evaluator,
        weight: config.weight,
        boneFilter: config.boneFilter ?? DEFAULT_LAYER_BONE_FILTER,
        name: config.name ?? config.id,
    });
}

export function removeWasmLayer(modelId: string, layerId: string): void {
    const state = _blenderStates.get(modelId);
    if (!state) {
        return;
    }

    const layer = state.layers.get(layerId);
    if (layer) {
        layer.evaluator.dispose();
        state.layers.delete(layerId);
    }
}

export function updateWasmLayerWeight(modelId: string, layerId: string, weight: number): void {
    const state = _blenderStates.get(modelId);
    if (!state) {
        return;
    }

    const layer = state.layers.get(layerId);
    if (layer) {
        layer.weight = clamp01(weight);
    }
}

// ── 内部实现 ────────────────────────────────────────────────────────────

function _applyLayersBlending(modelId: string): void {
    const state = _blenderStates.get(modelId);
    if (!state || state.layers.size === 0) {
        return;
    }

    const inst = _requireDeps().modelManager.get(modelId);
    if (!inst?.mmdModel) {
        return;
    }

    const bones = inst.mmdModel.runtimeBones;
    if (!bones || bones.length === 0) {
        return;
    }

    const frame = state.animationFrame;

    const allFrames = new Map<string, Array<{ frame: any; weight: number }>>();

    for (const [, layer] of state.layers) {
        const frameMap = layer.evaluator.evalAllBones(frame);
        for (const [boneName, frameData] of frameMap) {
            if (!layer.boneFilter.includes('*') && !layer.boneFilter.includes(boneName)) {
                continue;
            }
            if (!allFrames.has(boneName)) {
                allFrames.set(boneName, []);
            }
            allFrames.get(boneName)!.push({ frame: frameData, weight: layer.weight });
        }
    }

    for (const [boneName, entries] of allFrames) {
        const bone = bones.find((b: IMmdRuntimeBone) => b.name === boneName);
        if (!bone || !_isWasmRuntime(bone)) {
            continue;
        }

        const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
        if (totalWeight <= 0) {
            continue;
        }

        let blendedRot: Quaternion | null = null;
        let blendedPos: Vector3 | null = null;

        // 权重混合：使用累积权重 Slerp，避免逐次 Slerp 偏向首层。
        // 第 i 层的 effectiveWeight = weight_i / totalWeight，
        // 累积权重 cumWeight 用于 Slerp 的插值因子 = effectiveWeight / (已累积权重)。
        let cumWeight = 0;
        for (const entry of entries) {
            const effectiveWeight = entry.weight / totalWeight;
            cumWeight += effectiveWeight;
            const { rotation, position } = entry.frame;

            if (blendedRot === null) {
                blendedRot = rotation.clone();
            } else {
                // 插值因子 = 本层权重 / 累积权重，保证加权平均语义
                const t = effectiveWeight / cumWeight;
                blendedRot = Quaternion.Slerp(blendedRot, rotation, t);
            }

            if (position !== null) {
                if (blendedPos === null) {
                    blendedPos = position.clone();
                } else {
                    const t = effectiveWeight / cumWeight;
                    blendedPos.x += (position.x - blendedPos.x) * t;
                    blendedPos.y += (position.y - blendedPos.y) * t;
                    blendedPos.z += (position.z - blendedPos.z) * t;
                }
            }
        }

        if (blendedRot !== null) {
            const oldMat = Matrix.FromArray(bone.worldMatrix as Float32Array);

            const newMat = new Matrix();
            if (blendedPos !== null) {
                newMat.copyFrom(Matrix.Compose(Vector3.One(), blendedRot, blendedPos));
            } else {
                const pos = oldMat.getTranslation();
                newMat.copyFrom(Matrix.Compose(Vector3.One(), blendedRot, pos));
            }

            // perception.ts 扩展了 MmdRuntimeBone 添加 worldMatrix 属性，
            // babylon-mmd 类型声明未包含此扩展，需类型断言
            const buf = (bone as MmdRuntimeBoneExtended).worldMatrix;
            _writeMatToBuffer(buf, newMat);

            _propagateChildrenWasm(bone, oldMat, newMat);
        }
    }
}
