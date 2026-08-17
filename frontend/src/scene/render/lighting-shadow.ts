// [doc:architecture] Lighting — 阴影生成器（主光 CascadedShadowGenerator + 舞台灯 ShadowGenerator）
// 状态集中于 lightingState，本文件不再持有任何模块级可变状态。

import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { lightingState } from './lighting-state';
import { modelRegistry } from '@/core/config';

/** 遍历所有模型的 Mesh，加入阴影生成器。 */
export function _addAllMeshesToShadow(gen: ShadowGenerator | CascadedShadowGenerator): void {
    for (const [, inst] of modelRegistry) {
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

/**
 * 当模型/道具注册表更新时，重新生成阴影投射者列表。
 * [doc:adr-271] 只做本模块这半（重建 env 阴影生成器的投射者）；舞台灯光阴影那半
 * 由 ./lighting 的 rebuildShadowCasters() 组合调用。原先在此直接调 stage 的实现，
 * 构成 stage ⇄ shadow 的 size=2 强连通分量。
 */
export function _rebuildShadowCasters(): void {
    _ensureShadow();
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
    // P2-fix: 与主光 CSM 语义统一 — 'pcf' 走真 PCF，'soft' 走 ESM+KernelBlur，'hard' 关模糊
    if (state.shadowType === 'pcf') {
        gen.usePercentageCloserFiltering = true;
    } else {
        gen.useBlurExponentialShadowMap = state.shadowType === 'soft';
        gen.useKernelBlur = state.shadowType === 'soft';
    }
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
