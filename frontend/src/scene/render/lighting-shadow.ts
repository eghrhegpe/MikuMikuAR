// [doc:architecture] Lighting — 阴影生成器（主光 CascadedShadowGenerator + 舞台灯 ShadowGenerator）
// 状态集中于 lightingState，本文件不再持有任何模块级可变状态。

import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { lightingState } from './lighting-state';
import { modelRegistry, propRegistry } from '@/core/config';
import { rebuildStageLightShadows } from './lighting-stage';

/** 遍历所有模型/道具的 Mesh，加入阴影生成器。 */
export function _addAllMeshesToShadow(gen: ShadowGenerator | CascadedShadowGenerator): void {
    for (const [, inst] of modelRegistry) {
        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                gen.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }
    }
    for (const [, inst] of propRegistry) {
        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                gen.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }
    }
}

export function _ensureShadow(): void {
    if (!lightingState.scene || !lightingState.envSysShadow) {
        return;
    }

    if (lightingState.envSysShadow.generator) {
        lightingState.envSysShadow.generator.dispose();
        lightingState.envSysShadow.generator = null;
    }
    if (!lightingState.shadowEnabled) {
        return;
    }

    const gen = new CascadedShadowGenerator(lightingState.shadowResolution, lightingState.dirLight);
    gen.numCascades = lightingState.shadowCascades;
    // CSM 仅支持 FILTER_NONE / FILTER_PCF / FILTER_PCSS
    if (lightingState.shadowType === 'pcf') {
        gen.usePercentageCloserFiltering = true;
    } else if (lightingState.shadowType === 'soft') {
        gen.useContactHardeningShadow = true;
    }
    gen.bias = lightingState.shadowBias;

    _addAllMeshesToShadow(gen);

    lightingState.envSysShadow.generator = gen;
}

/** 当模型/道具注册表更新时，重新生成阴影投射者列表。 */
export function rebuildShadowCasters(): void {
    _ensureShadow();
    rebuildStageLightShadows();
}

export function _ensureStageShadow(id: string): void {
    if (!lightingState.scene) {
        return;
    }
    const entry = lightingState.stageLights.get(id);
    if (!entry) {
        return;
    }
    const { state, light } = entry;

    // dispose 旧的
    const old = lightingState.stageShadows.get(id);
    if (old) {
        old.dispose();
        lightingState.stageShadows.delete(id);
    }

    if (!state.enabled || !state.shadowEnabled) {
        return;
    }
    if (state.type === 'point') {
        return;
    } // PointLight 不支持 ShadowGenerator
    if (!(light instanceof SpotLight) && !(light instanceof DirectionalLight)) {
        return;
    }

    const gen = new ShadowGenerator(state.shadowResolution, light);
    gen.useBlurExponentialShadowMap = state.shadowType !== 'hard';
    gen.useKernelBlur = state.shadowType === 'pcf';
    gen.bias = state.shadowBias;

    _addAllMeshesToShadow(gen);
    lightingState.stageShadows.set(id, gen);
}

export function _disposeStageShadow(id: string): void {
    const gen = lightingState.stageShadows.get(id);
    if (gen) {
        gen.dispose();
        lightingState.stageShadows.delete(id);
    }
}
