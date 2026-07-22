// [doc:adr-168] Personal Lights — 角色专属跟随灯
// 职责: 每个 actor 模型自动获得一盏 SpotLight，跟随其根节点移动。
// 注册于 initLighting（onBeforeRenderObservable），disposeLighting 时释放。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { lightingState } from './lighting-state';
import { modelRegistry } from '@/core/config';
import { safeDispose } from '@/core/dispose-helpers';
import {
    createLightCone,
    updateLightConeTransform,
    updateLightConeUniforms,
    rebuildLightConeGeometry,
    setLightConeEnabled,
    disposeLightCone,
    type LightConeEntry,
} from './light-cone';

export interface PersonalLightSettings {
    enabled: boolean;
    intensity: number;
    color: [number, number, number];
    angle: number;
    height: number;
    coneEnabled: boolean;
    coneIntensity: number;
    coneLength: number;
    coneSoftness: number;
}

interface PersonalLightEntry {
    light: SpotLight;
    shadowGen: ShadowGenerator;
    settings: PersonalLightSettings;
    currentPos: Vector3;
    cone: LightConeEntry | null;
}

const _entries = new Map<string, PersonalLightEntry>();

const _tmpTarget = Vector3.Zero();
const _tmpPos = Vector3.Zero();

export const DEFAULT_PERSONAL_LIGHT: PersonalLightSettings = {
    enabled: true,
    intensity: 1.2,
    color: [1, 1, 1],
    angle: 0.7,
    height: 35,
    coneEnabled: true,
    coneIntensity: 0.6,
    coneLength: 30,
    coneSoftness: 0.5,
};

export function attachPersonalLight(modelId: string, overrides?: Partial<PersonalLightSettings>): void {
    if (_entries.has(modelId)) return;
    const scene = lightingState.scene;
    if (!scene) return;

    const settings: PersonalLightSettings = { ...DEFAULT_PERSONAL_LIGHT, ...overrides };
    const model = modelRegistry.get(modelId);
    if (!model) return;

    const rootPos = model.rootMesh.getAbsolutePosition();
    const startPos = new Vector3(rootPos.x, rootPos.y + settings.height, rootPos.z);

    const light = new SpotLight(
        `personalLight_${modelId}`,
        startPos,
        new Vector3(0, -1, 0),
        settings.angle,
        2,
        scene
    );
    light.intensity = settings.enabled ? settings.intensity : 0;
    light.diffuse = new Color3(settings.color[0], settings.color[1], settings.color[2]);
    light.specular = new Color3(0.3, 0.3, 0.3);
    light.range = settings.height * 3;

    const shadowGen = new ShadowGenerator(512, light);
    shadowGen.usePercentageCloserFiltering = true;
    shadowGen.bias = 0.001;
    for (const m of model.meshes) {
        if (m instanceof Mesh) {
            shadowGen.addShadowCaster(m);
            m.receiveShadows = true;
        }
    }

    _entries.set(modelId, {
        light,
        shadowGen,
        settings,
        currentPos: startPos.clone(),
        cone: null,
    });

    _ensurePersonalCone(modelId);
}

export function detachPersonalLight(modelId: string): void {
    const entry = _entries.get(modelId);
    if (!entry) return;
    if (entry.cone) {
        disposeLightCone(entry.cone);
        entry.cone = null;
    }
    safeDispose(entry.shadowGen);
    safeDispose(entry.light);
    _entries.delete(modelId);
}

export function setPersonalLightState(modelId: string, partial: Partial<PersonalLightSettings>): void {
    const entry = _entries.get(modelId);
    if (!entry) return;
    Object.assign(entry.settings, partial);
    const { settings, light } = entry;
    light.intensity = settings.enabled ? settings.intensity : 0;
    light.diffuse.set(settings.color[0], settings.color[1], settings.color[2]);
    light.angle = settings.angle;
    light.range = settings.height * 3;
    _ensurePersonalCone(modelId);
}

export function getPersonalLightState(modelId: string): PersonalLightSettings | null {
    return _entries.get(modelId)?.settings ?? null;
}

export function tickPersonalLights(): void {
    const smoothing = 0.15;

    for (const [modelId, entry] of _entries) {
        if (!entry.settings.enabled) continue;
        const model = modelRegistry.get(modelId);
        if (!model) continue;

        const rootPos = model.rootMesh.getAbsolutePosition();
        _tmpTarget.set(rootPos.x, rootPos.y + entry.settings.height, rootPos.z);
        Vector3.LerpToRef(entry.currentPos, _tmpTarget, smoothing, entry.currentPos);
        entry.light.position.copyFrom(entry.currentPos);

        _tmpPos.set(rootPos.x, rootPos.y, rootPos.z);
        entry.light.setDirectionToTarget(_tmpPos);

        if (entry.cone) {
            updateLightConeTransform(entry.cone, entry.light, entry.settings.coneLength);
        }
    }
}

function _ensurePersonalCone(modelId: string): void {
    const entry = _entries.get(modelId);
    if (!entry) return;
    const { settings, light } = entry;
    const scene = lightingState.scene;
    if (!scene) return;

    if (!settings.enabled || !settings.coneEnabled) {
        if (entry.cone) {
            disposeLightCone(entry.cone);
            entry.cone = null;
        }
        return;
    }

    const color = new Color3(settings.color[0], settings.color[1], settings.color[2]);

    if (entry.cone) {
        rebuildLightConeGeometry(entry.cone, scene, light, settings.coneLength);
        updateLightConeTransform(entry.cone, light, settings.coneLength);
        updateLightConeUniforms(entry.cone, color, settings.coneIntensity, settings.coneSoftness, settings.coneLength);
        setLightConeEnabled(entry.cone, true);
        return;
    }

    entry.cone = createLightCone(scene, light, color, settings.coneIntensity, settings.coneLength, settings.coneSoftness);
}

export function disposeAllPersonalLights(): void {
    for (const [id] of _entries) {
        detachPersonalLight(id);
    }
}
