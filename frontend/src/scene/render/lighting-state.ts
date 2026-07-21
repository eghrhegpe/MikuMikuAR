// [doc:architecture] Lighting — 单一模块状态对象（ADR-159 P3-B）
// 全部模块级可变状态集中于 `lightingState`，彻底消除「跨文件幽灵状态」。
// 属性可变、无绑定重赋值问题，子文件一律通过 `lightingState.xxx` 访问。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { LightConeEntry } from './light-cone';
import type { ObserverHandle } from '@/core/observer-handle';
import type { ModelInstance, PropInstance } from '@/core/config';
// 类型仅依赖（type-only，不会造成运行时环）
import type { StageLightState } from './lighting';

export interface StageLightEntry {
    state: StageLightState;
    light: SpotLight | PointLight | DirectionalLight;
    indicator: Mesh | null;
    dirLine: LinesMesh | null;
}

export interface LightingTween {
    id: number;
    cancel: () => void;
}

export interface LightingStateValues {
    scene: Scene | null;
    modelRegistry: Map<string, ModelInstance> | null;
    propRegistry: Map<string, PropInstance> | null;
    envSysShadow: { generator: ShadowGenerator | null } | null;
    triggerAutoSave: (() => void) | null;
    /** 预设动画期间临时抑制 setLightState 内的自动保存，由 applyEnvPreset 控制 */
    skipLightAutoSave: boolean;
    hemiLight: HemisphericLight | null;
    dirLight: DirectionalLight | null;
    stageLights: Map<string, StageLightEntry>;
    activeStageLightId: string | null;
    stageLightCounter: number;
    shadowEnabled: boolean;
    shadowType: 'hard' | 'soft' | 'pcf';
    shadowCascades: number;
    shadowResolution: number;
    shadowBias: number;
    sunDisc: Mesh | null;
    stageShadows: Map<string, ShadowGenerator>;
    stageCones: Map<string, LightConeEntry>;
    coneUpdateHandle: ObserverHandle | null;
    /** [doc:adr-168] 个人灯 tick observer 句柄；disposeLighting 时释放 */
    personalLightTickHandle: ObserverHandle | null;
    /** 主光过渡动画（transitionLighting）持有的渲染循环 observer 句柄；重入时取消旧动画、disposeLighting 时显式释放 */
    activeTransitionObs: ObserverHandle | null;
    tweenIdCounter: number;
    activeTweens: Map<number, LightingTween>;
    tmpTarget: Vector3;
    tmpDir: Vector3;
}

// 阴影/光锥重建条件键集（模块级常量，避免每次 setStageLightState 重建 Set）
export const SHADOW_REBUILD_KEYS = new Set([
    'enabled',
    'shadowEnabled',
    'shadowType',
    'shadowResolution',
    'shadowBias',
]);

export const CONE_UPDATE_KEYS = new Set([
    'enabled',
    'coneEnabled',
    'coneIntensity',
    'coneLength',
    'coneSoftness',
    'angle',
    'posX',
    'posY',
    'posZ',
    'targetX',
    'targetY',
    'targetZ',
    'orbitAzimuth',
    'orbitElevation',
    'orbitDistance',
    'color',
]);

export const SUN_DISC_DISTANCE = 1000;

/** 太阳圆盘可见的最小方向光强度。低于此值时隐藏。 */
export const SUN_DISC_MIN_INTENSITY = 0.01;

export const lightingState: LightingStateValues = {
    scene: null,
    modelRegistry: null,
    propRegistry: null,
    envSysShadow: null,
    triggerAutoSave: null,
    skipLightAutoSave: false,
    hemiLight: null,
    dirLight: null,
    stageLights: new Map<string, StageLightEntry>(),
    activeStageLightId: null,
    stageLightCounter: 0,
    shadowEnabled: false,
    shadowType: 'soft',
    shadowCascades: 2,
    shadowResolution: 1024,
    shadowBias: 0.0001,
    sunDisc: null,
    stageShadows: new Map<string, ShadowGenerator>(),
    stageCones: new Map<string, LightConeEntry>(),
    coneUpdateHandle: null,
    personalLightTickHandle: null,
    activeTransitionObs: null,
    tweenIdCounter: 0,
    activeTweens: new Map<number, LightingTween>(),
    tmpTarget: Vector3.Zero(),
    tmpDir: Vector3.Zero(),
};
