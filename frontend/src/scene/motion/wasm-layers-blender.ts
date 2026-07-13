// [doc:adr-056] WASM 图层混合器 — JS 帧流合并让 WASM 拿到多图层能力
// 复用 perception.ts 的 _isWasmRuntime / _writeMatToBuffer / _propagateChildrenWasm
// 职责: 单 observer 调度（图层混合 → gaze 覆写 → 子骨骼传播）

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Matrix } from '@babylonjs/core/Maths/math';
import {
    _isWasmRuntime,
    _writeMatToBuffer,
    _propagateChildrenWasm,
    applyGazeWasm,
    type GazeConfig,
} from './perception';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import { createVmdEvaluator, type VmdEvaluator } from '@/motion-algos/vmd-evaluator';
import { DEFAULT_LAYER_BONE_FILTER } from './wasm-layers-config';
import { scene, modelManager, loadVMDMotion } from '../scene';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import { clamp01 } from '@/core/utils';

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
    observer: Observer<Scene>;
    enabled: boolean;
    baseAnimationName: string;
    gazeConfig: { headEnabled: boolean; eyeEnabled: boolean };
    animationFrame: number;
}

const _blenderStates = new Map<string, BlenderState>();

const VMD_FPS = 30;

export async function setupWasmLayersBlender(
    modelId: string,
    baseData: ArrayBuffer,
    baseName: string
): Promise<void> {
    teardownWasmLayersBlender(modelId);

    const inst = modelManager.get(modelId);
    if (!inst?.mmdModel) {
        throw new Error(`Model ${modelId} not found`);
    }

    const observer = scene.onBeforeRenderObservable.add(() => {
        const state = _blenderStates.get(modelId);
        if (!state || !state.enabled) {
            return;
        }
        const dt = scene.deltaTime || 16.67;
        state.animationFrame += (dt / 1000) * VMD_FPS;
        _applyLayersBlending(modelId);
        _applyGazeIfEnabled(modelId);
    });

    _blenderStates.set(modelId, {
        modelId,
        layers: new Map(),
        observer,
        enabled: true,
        baseAnimationName: baseName,
        gazeConfig: { headEnabled: false, eyeEnabled: false },
        animationFrame: 0,
    });

    await loadVMDMotion(baseData, baseName, modelId);
}

export function teardownWasmLayersBlender(modelId: string): void {
    const state = _blenderStates.get(modelId);
    if (!state) {
        return;
    }

    scene.onBeforeRenderObservable.remove(state.observer);

    for (const [, layer] of state.layers) {
        layer.evaluator.dispose();
    }
    state.layers.clear();

    _blenderStates.delete(modelId);
}

export function isWasmLayersBlenderActive(modelId: string): boolean {
    // has() 守卫保证 get() 非空
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

export function setWasmLayersGazeConfig(modelId: string, config: GazeConfig): void {
    const state = _blenderStates.get(modelId);
    if (!state) {
        return;
    }
    state.gazeConfig = config;
}

function _applyGazeIfEnabled(modelId: string): void {
    const state = _blenderStates.get(modelId);
    if (!state) {
        return;
    }

    const inst = modelManager.get(modelId);
    if (!inst?.mmdModel) {
        return;
    }

    const cam = scene.activeCamera;
    if (!cam) {
        return;
    }

    applyGazeWasm(inst.mmdModel.runtimeBones, cam, state.gazeConfig);
}

function _applyLayersBlending(modelId: string): void {
    const state = _blenderStates.get(modelId);
    if (!state || state.layers.size === 0) {
        return;
    }

    const inst = modelManager.get(modelId);
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

        for (const entry of entries) {
            const normalizedWeight = entry.weight / totalWeight;
            const { rotation, position } = entry.frame;

            if (blendedRot === null) {
                blendedRot = rotation.clone();
            } else {
                blendedRot = Quaternion.Slerp(blendedRot, rotation, normalizedWeight);
            }

            if (position !== null) {
                if (blendedPos === null) {
                    blendedPos = position.clone();
                } else {
                    blendedPos.x += (position.x - blendedPos.x) * normalizedWeight;
                    blendedPos.y += (position.y - blendedPos.y) * normalizedWeight;
                    blendedPos.z += (position.z - blendedPos.z) * normalizedWeight;
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
