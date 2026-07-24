// [doc:adr-168] Personal Lights — 角色专属跟随灯
// 职责: 每个 actor 模型自动获得一盏 SpotLight，跟随其根节点移动。
// 注册于 initLighting（onBeforeRenderObservable），disposeLighting 时释放。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { lightingState } from './lighting-state';
import { modelRegistry, type ModelInstance } from '@/core/config';
import { safeDispose } from '@/core/dispose-helpers';
import { getBoneWorldPosition } from '../../physics/physics-bridge';
import { setTransformMetadata } from '../transform/transform-pick';
import {
    registerTransformAdapter,
    isGizmoDragging,
    getGizmoTargetId,
} from '../transform/transform-adapter';
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
    offsetX: number;
    offsetZ: number;
    coneEnabled: boolean;
    coneIntensity: number;
    coneLength: number;
    coneSoftness: number;
    /** [doc:adr-168] 跟随骨骼名（null = 自动匹配腰骨候选） */
    boneName: string | null;
}

interface PersonalLightEntry {
    light: SpotLight;
    shadowGen: ShadowGenerator;
    settings: PersonalLightSettings;
    currentPos: Vector3;
    cone: LightConeEntry | null;
    indicator: Mesh | null;
    waistName: string | null;
}

const _entries = new Map<string, PersonalLightEntry>();

const _tmpTarget = Vector3.Zero();
const _tmpPos = Vector3.Zero();

/** 腰骨候选名（按优先级），用于个人灯跟随躯干而非脚底 */
const WAIST_CANDIDATES = ['Waist', 'センター', 'Center', '腰', '上半身'];

export const DEFAULT_PERSONAL_LIGHT: PersonalLightSettings = {
    enabled: true,
    intensity: 1.2,
    color: [1, 1, 1],
    angle: 0.7,
    height: 35,
    offsetX: 0,
    offsetZ: 0,
    coneEnabled: true,
    coneIntensity: 0.6,
    coneLength: 30,
    coneSoftness: 0.5,
    boneName: null,
};

/** 取个人灯跟随基准点：用户指定骨骼 → 腰骨候选 → 根节点（兜底） */
function _getLightBasePos(model: ModelInstance, waistName: string | null): Vector3 {
    if (waistName && model.mmdModel) {
        const p = getBoneWorldPosition(model.mmdModel, waistName);
        if (p) {
            return p;
        }
    }
    return model.rootMesh.getAbsolutePosition();
}

export function attachPersonalLight(
    modelId: string,
    overrides?: Partial<PersonalLightSettings>
): void {
    if (_entries.has(modelId)) {
        return;
    }
    const scene = lightingState.scene;
    if (!scene) {
        return;
    }

    const settings: PersonalLightSettings = { ...DEFAULT_PERSONAL_LIGHT, ...overrides };
    const model = modelRegistry.get(modelId);
    if (!model) {
        return;
    }

    const waistName = settings.boneName
        ? settings.boneName
        : model.mmdModel
          ? (WAIST_CANDIDATES.find((n) => model.mmdModel!.runtimeBones?.some((b) => b.name === n)) ??
            null)
          : null;
    const basePos = _getLightBasePos(model, waistName);
    const startPos = new Vector3(
        basePos.x + settings.offsetX,
        basePos.y + settings.height,
        basePos.z + settings.offsetZ
    );

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

    const indicator = _createPersonalLightIndicator(settings);
    setTransformMetadata(indicator, 'personalLight', modelId);
    indicator.position.copyFrom(startPos);

    _entries.set(modelId, {
        light,
        shadowGen,
        settings,
        currentPos: startPos.clone(),
        cone: null,
        indicator,
        waistName,
    });

    _ensurePersonalCone(modelId);
}

function _createPersonalLightIndicator(_settings: PersonalLightSettings): Mesh {
    const mesh = MeshBuilder.CreateSphere(
        'personalLightIndicator',
        { diameter: 0.4, segments: 8 },
        lightingState.scene!
    );
    const mat = new StandardMaterial('personalLightIndicatorMat', lightingState.scene!);
    mat.emissiveColor = new Color3(1, 0.85, 0.4);
    mat.disableLighting = true;
    mat.alpha = 0.8;
    mesh.material = mat;
    mesh.isPickable = true;
    return mesh;
}

function _updatePersonalLightIndicator(id: string): void {
    const entry = _entries.get(id);
    const model = modelRegistry.get(id);
    if (!entry || !model) {
        return;
    }
    const basePos = _getLightBasePos(model, entry.waistName);
    const target = new Vector3(
        basePos.x + entry.settings.offsetX,
        basePos.y + entry.settings.height,
        basePos.z + entry.settings.offsetZ
    );
    if (entry.indicator) {
        entry.indicator.position.copyFrom(target);
    }
}

export function detachPersonalLight(modelId: string): void {
    const entry = _entries.get(modelId);
    if (!entry) {
        return;
    }
    if (entry.cone) {
        disposeLightCone(entry.cone);
        entry.cone = null;
    }
    safeDispose(entry.indicator);
    safeDispose(entry.shadowGen);
    safeDispose(entry.light);
    _entries.delete(modelId);
}

export function setPersonalLightState(
    modelId: string,
    partial: Partial<PersonalLightSettings>
): void {
    const entry = _entries.get(modelId);
    if (!entry) {
        return;
    }
    const boneChanged = 'boneName' in partial && partial.boneName !== entry.settings.boneName;
    Object.assign(entry.settings, partial);
    if (boneChanged) {
        // 重新解析跟随骨骼
        const model = modelRegistry.get(modelId);
        if (model) {
            entry.waistName = entry.settings.boneName
                ? entry.settings.boneName
                : model.mmdModel
                  ? (WAIST_CANDIDATES.find((n) =>
                        model.mmdModel!.runtimeBones?.some((b) => b.name === n)
                    ) ?? null)
                  : null;
        }
    }
    const { settings, light } = entry;
    light.intensity = settings.enabled ? settings.intensity : 0;
    light.diffuse.set(settings.color[0], settings.color[1], settings.color[2]);
    light.angle = settings.angle;
    light.range = settings.height * 3;
    _updatePersonalLightIndicator(modelId);
    _ensurePersonalCone(modelId);
}

export function getPersonalLightState(modelId: string): PersonalLightSettings | null {
    return _entries.get(modelId)?.settings ?? null;
}

export function tickPersonalLights(): void {
    const smoothing = 0.15;

    for (const [modelId, entry] of _entries) {
        if (!entry.settings.enabled) {
            continue;
        }
        // 拖拽模式下正在被 gizmo 拖动的个人灯，跳过 tick 避免位置抢夺
        if (isGizmoDragging() && getGizmoTargetId() === modelId) {
            continue;
        }

        const model = modelRegistry.get(modelId);
        if (!model) {
            continue;
        }

        const basePos = _getLightBasePos(model, entry.waistName);
        _tmpTarget.set(
            basePos.x + entry.settings.offsetX,
            basePos.y + entry.settings.height,
            basePos.z + entry.settings.offsetZ
        );
        Vector3.LerpToRef(entry.currentPos, _tmpTarget, smoothing, entry.currentPos);
        entry.light.position.copyFrom(entry.currentPos);

        entry.light.setDirectionToTarget(basePos);

        if (entry.indicator) {
            entry.indicator.position.copyFrom(_tmpTarget);
        }

        if (entry.cone) {
            updateLightConeTransform(entry.cone, entry.light, entry.settings.coneLength);
        }
    }
}

function _ensurePersonalCone(modelId: string): void {
    const entry = _entries.get(modelId);
    if (!entry) {
        return;
    }
    const { settings, light } = entry;
    const scene = lightingState.scene;
    if (!scene) {
        return;
    }

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
        updateLightConeUniforms(
            entry.cone,
            color,
            settings.coneIntensity,
            settings.coneSoftness,
            settings.coneLength
        );
        setLightConeEnabled(entry.cone, true);
        return;
    }

    entry.cone = createLightCone(
        scene,
        light,
        color,
        settings.coneIntensity,
        settings.coneLength,
        settings.coneSoftness
    );
}

export function disposeAllPersonalLights(): void {
    for (const [id] of _entries) {
        detachPersonalLight(id);
    }
}

// ======== Serialization (ADR-168) ========

export interface SerializedPersonalLight {
    modelUuid: string;
    settings: PersonalLightSettings;
}

/** 导出所有个人灯状态（仅非默认值差异落盘由调用方决定） */
export function getAllPersonalLights(): Array<{ modelId: string; settings: PersonalLightSettings }> {
    const result: Array<{ modelId: string; settings: PersonalLightSettings }> = [];
    for (const [modelId, entry] of _entries) {
        result.push({ modelId, settings: { ...entry.settings } });
    }
    return result;
}

/** 场景反序列化后，按 modelId 恢复个人灯设置（attach 已由 onModelLoaded 触发，此处仅覆盖参数） */
export function restorePersonalLights(
    entries: Array<{ modelId: string; settings: Partial<PersonalLightSettings> }>
): void {
    for (const { modelId, settings } of entries) {
        if (_entries.has(modelId)) {
            setPersonalLightState(modelId, settings);
        }
    }
}

// ======== Transform Adapter (Gizmo 支持) ========

registerTransformAdapter({
    kinds: ['personalLight'],
    getNode: (id) => _entries.get(id)?.indicator ?? null,
    gizmoTypes: () => ['position'],
    onPositionDragEnd: (id, node) => {
        const entry = _entries.get(id);
        const model = modelRegistry.get(id);
        if (!entry || !model) {
            return;
        }
        const basePos = _getLightBasePos(model, entry.waistName);
        const pos = (node as unknown as { position: Vector3 }).position;
        entry.settings.offsetX = pos.x - basePos.x;
        entry.settings.offsetZ = pos.z - basePos.z;
        entry.settings.height = Math.max(5, pos.y - basePos.y);
        entry.currentPos.copyFrom(pos);
        entry.light.position.copyFrom(pos);
    },
    capabilities: [],
});

// ======== Stage Light Follow Tick (ADR-168) ========

const _stageTmpTarget = Vector3.Zero();
const _stageTmpCurrent = Vector3.Zero();

/** 舞台灯追光 tick：更新所有绑定了 followTarget 的舞台灯 */
export function tickStageLightFollow(): void {
    for (const [, entry] of lightingState.stageLights) {
        const ft = entry.state.followTarget;
        if (!ft) {
            continue;
        }

        const model = modelRegistry.get(ft.modelId);
        if (!model) {
            continue;
        }

        // 解析目标位置
        const boneName = ft.boneName ?? 
            (model.mmdModel
                ? (WAIST_CANDIDATES.find((n) =>
                      model.mmdModel!.runtimeBones?.some((b) => b.name === n)
                  ) ?? null)
                : null);
        
        const basePos = _getLightBasePos(model, boneName);
        _stageTmpTarget.set(
            basePos.x + ft.offset[0],
            basePos.y + ft.offset[1],
            basePos.z + ft.offset[2]
        );

        // 保存上一帧 smoothed target（moveWithTarget 位移计算需要帧间差值）
        const prevTargetX = entry.state.targetX;
        const prevTargetY = entry.state.targetY;
        const prevTargetZ = entry.state.targetZ;

        // 平滑插值
        _stageTmpCurrent.set(prevTargetX, prevTargetY, prevTargetZ);
        Vector3.LerpToRef(_stageTmpCurrent, _stageTmpTarget, ft.smoothing, _stageTmpCurrent);

        // 更新 target
        entry.state.targetX = _stageTmpCurrent.x;
        entry.state.targetY = _stageTmpCurrent.y;
        entry.state.targetZ = _stageTmpCurrent.z;

        // 应用方向更新（SpotLight / DirectionalLight 有 setDirectionToTarget；PointLight 无方向）
        if ('setDirectionToTarget' in entry.light) {
            (entry.light as SpotLight).setDirectionToTarget(_stageTmpCurrent);
        }

        // moveWithTarget: 灯位置跟随 target 的帧间位移（而非持续向 target 靠近导致飞走）
        // P2-fix: 原 delta = target - smoothed 会导致灯位置每帧累加 (1-smoothing) 比例的差值，
        // 持续向 target 方向移动并穿过，灯"飞走"。修正为 delta = 当前smoothed - 上一帧smoothed
        if (ft.moveWithTarget) {
            const currentPos = entry.light.position;
            currentPos.x += _stageTmpCurrent.x - prevTargetX;
            currentPos.y += _stageTmpCurrent.y - prevTargetY;
            currentPos.z += _stageTmpCurrent.z - prevTargetZ;

            entry.state.posX = currentPos.x;
            entry.state.posY = currentPos.y;
            entry.state.posZ = currentPos.z;
        }
    }
}

