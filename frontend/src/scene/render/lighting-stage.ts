// [doc:architecture] Lighting — 舞台灯（增删/状态/指示器/光锥）
// 状态集中于 lightingState，本文件不再持有任何模块级可变状态。
// 注意: _defaultStageLightState 由 ./lighting 导出（主光 init 与 stage 共用）。

import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import {
    createLightCone,
    updateLightConeTransform,
    updateLightConeUniforms,
    rebuildLightConeGeometry,
    setLightConeEnabled,
    disposeLightCone,
} from './light-cone';
import {
    lightingState,
    StageLightEntry,
    SHADOW_REBUILD_KEYS,
    CONE_UPDATE_KEYS,
} from './lighting-state';
import { _defaultStageLightState, type StageLightState, type StageLightType } from './lighting';
import { _ensureStageShadow, _disposeStageShadow } from './lighting-shadow';
import { col3FromTriple } from '@/core/color-helpers';
import { logWarn } from '@/core/logger';
import {
    registerTransformAdapter,
    attachGizmoForKind,
    isGizmoActive as _isGizmoActive,
    getGizmoTargetId as _getGizmoTargetId,
} from '../transform/transform-adapter';

// _createStageLight / _createIndicator / _createDirLine 均仅在 addStageLight
// 中调用，而 addStageLight 在 scene === null 时 early return，
// 故此处 scene! 断言安全。
export function _createStageLight(
    type: StageLightType,
    state: StageLightState
): SpotLight | PointLight | DirectionalLight {
    const pos = new Vector3(state.posX, state.posY, state.posZ);
    const target = new Vector3(state.targetX, state.targetY, state.targetZ);
    const diffuse = col3FromTriple(state.color);
    const intensity = state.enabled ? state.intensity : 0;

    if (type === 'spot') {
        const light = new SpotLight(
            state.id,
            pos,
            new Vector3(0, -1, 0),
            state.angle,
            state.exponent,
            lightingState.scene!
        );
        light.intensity = intensity;
        light.diffuse = diffuse;
        light.specular = new Color3(0.3, 0.3, 0.3);
        light.setDirectionToTarget(target);
        return light;
    }
    if (type === 'point') {
        const light = new PointLight(state.id, pos, lightingState.scene!);
        light.intensity = intensity;
        light.diffuse = diffuse;
        light.specular = new Color3(0.3, 0.3, 0.3);
        light.range = state.range;
        return light;
    }
    // directional
    const dir = target.subtract(pos);
    // 零向量守卫：target === pos 时 fallback 向下
    if (dir.lengthSquared() < 1e-6) {
        dir.set(0, -1, 0);
    } else {
        dir.normalize();
    }
    const light = new DirectionalLight(state.id, dir, lightingState.scene!);
    light.intensity = intensity;
    light.diffuse = diffuse;
    light.specular = new Color3(0.3, 0.3, 0.3);
    light.position = pos.clone();
    return light;
}

// ======== Stage Light Indicator ========

/** 模块级临时向量（避免 _updateIndicator 拖拽时 60fps 分配临时对象） */

function _createIndicator(): Mesh {
    const mesh = MeshBuilder.CreateSphere(
        'lightIndicator',
        { diameter: 0.5, segments: 8 },
        lightingState.scene!
    );
    const mat = new StandardMaterial('lightIndicatorMat', lightingState.scene!);
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
}

function _createDirLine(): LinesMesh {
    const mesh = MeshBuilder.CreateLines(
        'lightDirLine',
        {
            points: [Vector3.Zero(), new Vector3(0, -2, 0)],
            updatable: true, // 允许后续通过 instance 更新顶点
        },
        lightingState.scene!
    );
    mesh.color = new Color3(1, 1, 0.5);
    mesh.isPickable = false;
    return mesh;
}

export function _updateIndicator(entry: StageLightEntry): void {
    if (!lightingState.scene) {
        return;
    }
    const { state, light } = entry;

    // 更新球体指示器
    if (state.enabled) {
        if (!entry.indicator) {
            entry.indicator = _createIndicator();
        }
        entry.indicator.position.copyFrom(light.position);
        entry.indicator.scaling.setAll(state.indicatorScale);
        // 防御：material 可能被外部清理（scene 重置 / material cache 清除等），
        // 此时重建而非崩溃。
        if (!entry.indicator.material) {
            const mat = new StandardMaterial('lightIndicatorMat', lightingState.scene!);
            mat.emissiveColor = new Color3(1, 1, 1);
            mat.disableLighting = true;
            entry.indicator.material = mat;
        }
        const indMat = entry.indicator.material as StandardMaterial;
        indMat.alpha = state.indicatorOpacity;
        entry.indicator.setEnabled(true);

        // 聚光灯：显示方向线（通过 instance 更新顶点，避免每帧 dispose+rebuild）
        if (state.type === 'spot' && light instanceof SpotLight) {
            if (!entry.dirLine) {
                entry.dirLine = _createDirLine();
            }
            lightingState.tmpTarget.set(state.targetX, state.targetY, state.targetZ);
            lightingState.tmpTarget.subtractToRef(light.position, lightingState.tmpDir);
            lightingState.tmpDir.normalize().scaleInPlace(3);
            // 使用 instance 参数原地更新几何，不创建新 Mesh
            MeshBuilder.CreateLines(
                'lightDirLine',
                { points: [Vector3.Zero(), lightingState.tmpDir], instance: entry.dirLine },
                lightingState.scene!
            );
            entry.dirLine.position.copyFrom(light.position);
            entry.dirLine.setEnabled(true);
        } else {
            if (entry.dirLine) {
                entry.dirLine.dispose();
                entry.dirLine = null;
            }
        }
    } else {
        if (entry.indicator) {
            entry.indicator.setEnabled(false);
        }
        if (entry.dirLine) {
            entry.dirLine.setEnabled(false);
        }
    }
}

function _disposeIndicator(entry: StageLightEntry): void {
    if (entry.indicator) {
        entry.indicator.material?.dispose();
        entry.indicator.dispose();
        entry.indicator = null;
    }
    if (entry.dirLine) {
        entry.dirLine.dispose();
        entry.dirLine = null;
    }
}

export function getStageLights(): StageLightState[] {
    const result: StageLightState[] = [];
    for (const [, entry] of lightingState.stageLights) {
        result.push(_readStageLightState(entry));
    }
    return result;
}

export function getActiveStageLightId(): string | null {
    return lightingState.activeStageLightId;
}

export function setActiveStageLightId(id: string): void {
    if (lightingState.stageLights.has(id)) {
        lightingState.activeStageLightId = id;
    }
}

export function getStageLightState(id?: string): StageLightState {
    const entry = _getEntry(id);
    if (!entry) {
        return _defaultStageLightState('light-1', '主光');
    }
    return _readStageLightState(entry);
}

export function setStageLightState(s: Partial<StageLightState>, id?: string): void {
    const targetId = id ?? s.id ?? lightingState.activeStageLightId;
    if (!targetId) {
        return;
    }
    const entry = lightingState.stageLights.get(targetId);
    if (!entry || !lightingState.triggerAutoSave) {
        return;
    }

    // 类型切换：dispose 旧灯 + 旧阴影 + 旧光锥 + 创建新灯
    if (s.type !== undefined && s.type !== entry.state.type) {
        Object.assign(entry.state, s);
        entry.light.dispose();
        _disposeStageShadow(targetId);
        _disposeStageCone(targetId);
        entry.light = _createStageLight(s.type, entry.state);
        _ensureStageShadow(targetId);
        _ensureStageCone(targetId);
        _updateIndicator(entry);
        // 类型切换后 gizmo 仍指向旧灯（已 dispose），通过适配器重新附着到新灯
        if (_isGizmoActive() && _getGizmoTargetId() === targetId) {
            attachGizmoForKind('light', targetId);
        }
        lightingState.triggerAutoSave();
        return;
    }

    Object.assign(entry.state, s);
    _applyStageLightParams(entry, s);

    // 阴影重建条件
    let needShadowRebuild = false;
    for (const key of SHADOW_REBUILD_KEYS) {
        if ((s as Record<string, unknown>)[key] !== undefined) {
            needShadowRebuild = true;
            break;
        }
    }
    if (needShadowRebuild) {
        _ensureStageShadow(targetId);
    }

    // 光锥重建/更新条件
    let needConeUpdate = false;
    for (const key of CONE_UPDATE_KEYS) {
        if ((s as Record<string, unknown>)[key] !== undefined) {
            needConeUpdate = true;
            break;
        }
    }
    if (needConeUpdate) {
        _ensureStageCone(targetId);
    }

    // 更新指示器
    _updateIndicator(entry);

    if (!lightingState.skipLightAutoSave) {
        lightingState.triggerAutoSave();
    }
}

/** 释放单个舞台灯 entry 的全部资源（指示器 + 灯 + 阴影 + 光锥）。 */
export function _disposeStageLightEntry(id: string, entry: StageLightEntry): void {
    _disposeIndicator(entry);
    entry.light.dispose();
    _disposeStageShadow(id);
    _disposeStageCone(id);
}

/** 注册舞台灯 entry：写入映射 + 生成阴影/光锥 + 更新指示器。 */
function _registerStageLight(id: string, entry: StageLightEntry): void {
    lightingState.stageLights.set(id, entry);
    _ensureStageShadow(id);
    _ensureStageCone(id);
    _updateIndicator(entry);
}

export function addStageLight(
    type: StageLightType = 'spot',
    preset?: Partial<StageLightState>
): string {
    lightingState.stageLightCounter++;
    const id = `light-${lightingState.stageLightCounter}`;
    const defaultNames: Record<StageLightType, string> = {
        spot: '聚光灯',
        point: '点光源',
        directional: '平行光',
    };
    const name = `${defaultNames[type]} ${lightingState.stageLightCounter}`;
    const state = { ..._defaultStageLightState(id, name), type, ...preset, id, name };
    state.posX = lightingState.stageLightCounter * 2 - 2;
    state.orbitAzimuth = 180 + (lightingState.stageLightCounter - 1) * 30;
    const light = _createStageLight(type, state);
    const entry: StageLightEntry = { state, light, indicator: null, dirLine: null };
    _registerStageLight(id, entry);
    lightingState.activeStageLightId = id;
    if (lightingState.triggerAutoSave && !lightingState.skipLightAutoSave) {
        lightingState.triggerAutoSave();
    }
    return id;
}

export function removeStageLight(id: string): boolean {
    const entry = lightingState.stageLights.get(id);
    if (!entry) {
        return false;
    }
    if (lightingState.stageLights.size <= 1) {
        return false;
    }
    _disposeStageLightEntry(id, entry);
    lightingState.stageLights.delete(id);
    if (lightingState.activeStageLightId === id) {
        lightingState.activeStageLightId = lightingState.stageLights.keys().next().value ?? null;
    }
    if (lightingState.triggerAutoSave && !lightingState.skipLightAutoSave) {
        lightingState.triggerAutoSave();
    }
    return true;
}

/** 批量加载舞台灯（反序列化用），会清空现有灯 */
export function loadStageLights(states: StageLightState[]): void {
    // 清空旧灯（含各自的指示器/阴影/光锥）
    for (const [lid, entry] of lightingState.stageLights) {
        _disposeStageLightEntry(lid, entry);
    }
    lightingState.stageLights.clear();
    lightingState.stageShadows.clear();
    lightingState.stageCones.clear();

    if (states.length === 0) {
        const def = _defaultStageLightState('light-1', '主光');
        const light = _createStageLight(def.type, def);
        const entry: StageLightEntry = { state: def, light, indicator: null, dirLine: null };
        _registerStageLight(def.id, entry);
        lightingState.activeStageLightId = def.id;
        lightingState.stageLightCounter = 1;
        return;
    }

    let maxNum = 0;
    for (const s of states) {
        // 旧存档迁移：volumetric* → cone*（与 _readStageLightState 保持一致）
        const raw = s as unknown as Record<string, unknown>;
        const migrated: StageLightState = {
            ...s,
            coneEnabled: s.coneEnabled ?? (raw.volumetricEnabled as boolean | undefined) ?? false,
            coneIntensity:
                s.coneIntensity ??
                Math.min(2, ((raw.volumetricExposure as number | undefined) ?? 1) * 0.5),
            coneLength: s.coneLength ?? 20,
            coneSoftness:
                s.coneSoftness ?? 1 - ((raw.volumetricDensity as number | undefined) ?? 0.5),
            // [doc:adr-168] 旧存档无 followTarget 字段 → 默认 null（静态模式）
            followTarget: s.followTarget ?? null,
        };
        const light = _createStageLight(migrated.type, migrated);
        const entry: StageLightEntry = { state: migrated, light, indicator: null, dirLine: null };
        _registerStageLight(migrated.id, entry);
        const m = migrated.id.match(/light-(\d+)/);
        if (m) {
            maxNum = Math.max(maxNum, parseInt(m[1]));
        }
    }
    lightingState.stageLightCounter = maxNum;
    lightingState.activeStageLightId = states[0].id;
}

/** 重建所有舞台灯的阴影投射者列表（模型/道具变化时调用） */
export function rebuildStageLightShadows(): void {
    for (const [id] of lightingState.stageLights) {
        _ensureStageShadow(id);
    }
}

// —— 内部辅助 ——

function _getEntry(id?: string): StageLightEntry | null {
    const targetId = id ?? lightingState.activeStageLightId;
    if (!targetId) {
        return null;
    }
    return lightingState.stageLights.get(targetId) ?? null;
}

function _readStageLightState(entry: StageLightEntry): StageLightState {
    const { state, light } = entry;
    const base: StageLightState = {
        ...state,
        indicatorScale: state.indicatorScale ?? 1,
        indicatorOpacity: state.indicatorOpacity ?? 1,
        // 光锥字段（兼容旧存档 volumetric* → cone*）
        coneEnabled:
            state.coneEnabled ??
            ((state as unknown as Record<string, unknown>).volumetricEnabled as boolean) ??
            false,
        coneIntensity:
            state.coneIntensity ??
            Math.min(
                2,
                (((state as unknown as Record<string, unknown>).volumetricExposure as
                    number | undefined) ?? 1) * 0.5
            ),
        coneLength: state.coneLength ?? 20,
        coneSoftness:
            state.coneSoftness ??
            1 -
                (((state as unknown as Record<string, unknown>).volumetricDensity as
                    number | undefined) ?? 0.5),
        intensity: light.intensity,
        color: [light.diffuse.r, light.diffuse.g, light.diffuse.b],
        posX: light.position.x,
        posY: light.position.y,
        posZ: light.position.z,
        orbitAzimuth: (Math.atan2(light.position.x, light.position.z) * 180) / Math.PI,
        orbitElevation:
            (Math.asin(light.position.y / Math.max(0.1, light.position.length())) * 180) / Math.PI,
        orbitDistance: light.position.length(),
    };
    if (state.type === 'spot' && light instanceof SpotLight) {
        base.angle = light.angle;
        base.exponent = light.exponent;
    }
    if (state.type === 'point' && light instanceof PointLight) {
        base.range = light.range;
    }
    return base;
}

function _applyStageLightParams(entry: StageLightEntry, s: Partial<StageLightState>): void {
    const { state, light } = entry;
    const type = state.type;

    if (s.enabled !== undefined) {
        light.intensity = s.enabled ? state.intensity : 0;
    }
    if (s.intensity !== undefined && state.enabled) {
        light.intensity = s.intensity;
    }
    if (s.color !== undefined) {
        light.diffuse = col3FromTriple(s.color);
    }

    if (type === 'spot' && light instanceof SpotLight) {
        if (s.angle !== undefined) {
            light.angle = s.angle;
        }
        if (s.exponent !== undefined) {
            light.exponent = s.exponent;
        }
    }
    if (type === 'point' && light instanceof PointLight) {
        if (s.range !== undefined) {
            light.range = s.range;
        }
    }

    if (
        s.orbitAzimuth !== undefined ||
        s.orbitElevation !== undefined ||
        s.orbitDistance !== undefined
    ) {
        const az = ((s.orbitAzimuth ?? state.orbitAzimuth) * Math.PI) / 180;
        const el = ((s.orbitElevation ?? state.orbitElevation) * Math.PI) / 180;
        const dist = s.orbitDistance ?? state.orbitDistance;
        light.position = new Vector3(
            dist * Math.cos(el) * Math.sin(az),
            dist * Math.sin(el),
            dist * Math.cos(el) * Math.cos(az)
        );
        if (type === 'spot' && light instanceof SpotLight) {
            light.setDirectionToTarget(new Vector3(state.targetX, state.targetY, state.targetZ));
        }
        if (type === 'directional' && light instanceof DirectionalLight) {
            const dir = new Vector3(
                state.targetX - light.position.x,
                state.targetY - light.position.y,
                state.targetZ - light.position.z
            ).normalize();
            light.direction = dir;
        }
    }
    if (s.posX !== undefined || s.posY !== undefined || s.posZ !== undefined) {
        light.position = new Vector3(
            s.posX ?? light.position.x,
            s.posY ?? light.position.y,
            s.posZ ?? light.position.z
        );
    }
    if (s.targetX !== undefined || s.targetY !== undefined || s.targetZ !== undefined) {
        if (type === 'spot' && light instanceof SpotLight) {
            light.setDirectionToTarget(
                new Vector3(
                    s.targetX ?? state.targetX,
                    s.targetY ?? state.targetY,
                    s.targetZ ?? state.targetZ
                )
            );
        }
        if (type === 'directional' && light instanceof DirectionalLight) {
            const dir = new Vector3(
                (s.targetX ?? state.targetX) - light.position.x,
                (s.targetY ?? state.targetY) - light.position.y,
                (s.targetZ ?? state.targetZ) - light.position.z
            ).normalize();
            light.direction = dir;
        }
    }

    // 指示器缩放/透明度 — 在 _updateIndicator 中应用，这里只标记状态已更新
}

// ======== 真实光锥（替代 ADR-152 的屏幕后处理假体积光） =====

/**
 * 确保指定舞台灯的光锥与 state 同步（按需创建/销毁/更新）。
 * 仅 SpotLight 支持光锥；PointLight / DirectionalLight 自动跳过。
 */
function _ensureStageCone(id: string): void {
    if (!lightingState.scene) {
        return;
    }
    const entry = lightingState.stageLights.get(id);
    if (!entry) {
        _disposeStageCone(id);
        return;
    }
    const state = entry.state;

    // 关闭或非 SpotLight → 释放
    if (!state.enabled || !state.coneEnabled || state.type !== 'spot') {
        _disposeStageCone(id);
        return;
    }

    const light = entry.light;
    if (!(light instanceof SpotLight)) {
        _disposeStageCone(id);
        return;
    }

    const existing = lightingState.stageCones.get(id);
    const color = col3FromTriple(state.color);

    if (existing) {
        // 锥长/锥角变化 → 重建几何
        rebuildLightConeGeometry(existing, lightingState.scene, light, state.coneLength);
        // 更新 transform（位置/朝向）
        updateLightConeTransform(existing, light, state.coneLength);
        // 更新 uniforms
        updateLightConeUniforms(
            existing,
            color,
            state.coneIntensity,
            state.coneSoftness,
            state.coneLength
        );
        setLightConeEnabled(existing, true);
        return;
    }

    // 创建新光锥
    try {
        const cone = createLightCone(
            lightingState.scene,
            light,
            color,
            state.coneIntensity,
            state.coneLength,
            state.coneSoftness
        );
        lightingState.stageCones.set(id, cone);
    } catch (e) {
        logWarn('light-cone', `create light cone failed for ${id}: ${e}`);
    }
}

/** 释放指定舞台灯的光锥 */
function _disposeStageCone(id: string): void {
    const cone = lightingState.stageCones.get(id);
    if (cone) {
        disposeLightCone(cone);
        lightingState.stageCones.delete(id);
    }
}

// ======== Transform Adapter (ADR-126) ========

registerTransformAdapter({
    kinds: ['light'],
    getNode: (id) => lightingState.stageLights.get(id)?.light ?? null,
    gizmoTypes: (id) =>
        lightingState.stageLights.get(id)?.state.type !== 'point'
            ? ['position', 'rotation']
            : ['position'],
    onPositionDragEnd: (id, n) => {
        const v = (n as unknown as { position: Vector3 }).position;
        setStageLightState({ posX: v.x, posY: v.y, posZ: v.z }, id);
    },
    onRotationDragEnd: (id) => {
        const entry = lightingState.stageLights.get(id);
        if (!entry) {
            return;
        }
        const pos = entry.light.position;
        if (entry.state.type === 'spot' && entry.light instanceof SpotLight) {
            const curDir = entry.light.direction;
            const target = pos.add(curDir.scale(10));
            setStageLightState({ targetX: target.x, targetY: target.y, targetZ: target.z }, id);
        }
        if (entry.state.type === 'directional' && entry.light instanceof DirectionalLight) {
            const dir = entry.light.direction;
            const target = pos.add(dir.scale(10));
            setStageLightState({ targetX: target.x, targetY: target.y, targetZ: target.z }, id);
        }
    },
    capabilities: ['slider-scale', 'slider-opacity'],
    getScale: (id) => getStageLightState(id).indicatorScale,
    setScale: (id, v) => setStageLightState({ indicatorScale: v }, id),
    getOpacity: (id) => getStageLightState(id).indicatorOpacity,
    setOpacity: (id, v) => setStageLightState({ indicatorOpacity: v }, id),
});
