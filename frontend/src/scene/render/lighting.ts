// [doc:architecture] Scene Lighting — 光照、阴影、太阳盘
// 职责: 方向光/半球光管理、阴影生成器、太阳圆盘可视化
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { PositionGizmo } from '@babylonjs/core/Gizmos/positionGizmo';
import { RotationGizmo } from '@babylonjs/core/Gizmos/rotationGizmo';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import type { ModelInstance, PropInstance } from '@/core/config';
import { scheduleRefresh } from '@/core/reactivity';
import { resetPerformanceSnapshot } from './performance';

function setKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
    obj[key] = value;
}

// ======== Light State ========

export interface LightState {
    hemiIntensity: number;
    dirIntensity: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    dirColor: [number, number, number];
    hemiColor: [number, number, number];
    groundColor: [number, number, number];
    shadowEnabled: boolean;
    shadowType: 'hard' | 'soft' | 'pcf';
    shadowCascades: number;
    shadowResolution: number; // 新增
    shadowBias: number; // 新增
}

export type StageLightType = 'spot' | 'point' | 'directional';

export interface StageLightState {
    id: string; // 唯一标识
    name: string; // 显示名
    enabled: boolean;
    type: StageLightType; // 灯光类型
    intensity: number;
    color: [number, number, number];
    // SpotLight 专属
    angle: number; // 锥角（弧度）
    exponent: number; // 衰减指数
    // PointLight 专属
    range: number; // 衰减距离
    // 阴影投射
    shadowEnabled: boolean;
    shadowType: 'hard' | 'soft' | 'pcf';
    shadowResolution: number;
    shadowBias: number;
    // 位置
    posX: number;
    posY: number;
    posZ: number;
    // 目标点（spot 用；directional 用其反推方向）
    targetX: number;
    targetY: number;
    targetZ: number;
    // 轨道控制参数（从 posX/Y/Z 实时推导，写回时反算）
    orbitAzimuth: number; // -180~180 度，水平绕 Y 轴
    orbitElevation: number; // -90~90 度，垂直仰角
    orbitDistance: number; // 距原点距离
}

function _defaultStageLightState(id: string, name: string): StageLightState {
    return {
        id,
        name,
        enabled: false,
        type: 'spot',
        intensity: 0.8,
        color: [1, 1, 1],
        angle: 0.8,
        exponent: 2,
        range: 50,
        shadowEnabled: false,
        shadowType: 'soft',
        shadowResolution: 1024,
        shadowBias: 0.0001,
        posX: 0,
        posY: 15,
        posZ: -10,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        orbitAzimuth: 180,
        orbitElevation: 56,
        orbitDistance: 18,
    };
}

// ======== Lights (module-level state) ========

let _scene: import('@babylonjs/core/scene').Scene | null = null;
let _modelRegistry: Map<string, ModelInstance> | null = null;
let _propRegistry: Map<string, PropInstance> | null = null;
let _envSysShadow: { generator: ShadowGenerator | null } | null = null;
let triggerAutoSave: (() => void) | null = null;

export let hemiLight: HemisphericLight;
export let dirLight: DirectionalLight;

interface StageLightEntry {
    state: StageLightState;
    light: SpotLight | PointLight | DirectionalLight;
    indicator: Mesh | null;
    dirLine: Mesh | null;
}
const _stageLights = new Map<string, StageLightEntry>();
let _activeStageLightId: string | null = null;
let _stageLightCounter = 0;

// ======== Gizmo State ========
let _gizmoLayer: UtilityLayerRenderer | null = null;
let _posGizmo: PositionGizmo | null = null;
let _rotGizmo: RotationGizmo | null = null;
let _gizmoTarget: string | null = null; // 当前 gizmo 绑定的灯光 ID

let _shadowEnabled = false;
let _shadowType: LightState['shadowType'] = 'soft';
let _shadowCascades = 2;
let _shadowResolution = 1024;
let _shadowBias = 0.0001;
let _sunDisc: Mesh | null = null;

/** 预设动画期间临时抑制 setLightState 内的自动保存，由 applyEnvPreset 控制 */
let _skipLightAutoSave = false;
export function setSkipLightAutoSave(skip: boolean): void {
    _skipLightAutoSave = skip;
}

const SUN_DISC_DISTANCE = 1000;

/** 太阳圆盘可见的最小方向光强度。低于此值时隐藏。 */
const SUN_DISC_MIN_INTENSITY = 0.01;

export function initLighting(
    scene: import('@babylonjs/core/scene').Scene,
    modelRegistry: Map<string, ModelInstance>,
    propRegistry: Map<string, PropInstance>,
    envSysShadow: { generator: ShadowGenerator | null },
    saveCb: () => void
): void {
    _scene = scene;
    _modelRegistry = modelRegistry;
    _propRegistry = propRegistry;
    _envSysShadow = envSysShadow;
    triggerAutoSave = saveCb;

    hemiLight = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.5), scene);
    hemiLight.intensity = 0.8;
    hemiLight.diffuse = new Color3(1, 1, 1);
    hemiLight.groundColor = new Color3(0.3, 0.3, 0.4);

    dirLight = new DirectionalLight('dir', new Vector3(0, -1, 0), scene);
    dirLight.intensity = 0.4;
    dirLight.position = new Vector3(0, 40, 0);

    const def = _defaultStageLightState('light-1', '主光');
    const light = _createStageLight(def.type, def);
    _stageLights.set(def.id, { state: def, light, indicator: null, dirLine: null });
    _activeStageLightId = def.id;
    _stageLightCounter = 1;
    _updateIndicator(_stageLights.get(def.id)!);
}

function _createStageLight(
    type: StageLightType,
    state: StageLightState
): SpotLight | PointLight | DirectionalLight {
    const pos = new Vector3(state.posX, state.posY, state.posZ);
    const target = new Vector3(state.targetX, state.targetY, state.targetZ);
    const diffuse = new Color3(state.color[0], state.color[1], state.color[2]);
    const intensity = state.enabled ? state.intensity : 0;

    if (type === 'spot') {
        const light = new SpotLight(
            state.id,
            pos,
            new Vector3(0, -1, 0),
            state.angle,
            state.exponent,
            _scene!
        );
        light.intensity = intensity;
        light.diffuse = diffuse;
        light.specular = new Color3(0.3, 0.3, 0.3);
        light.setDirectionToTarget(target);
        return light;
    }
    if (type === 'point') {
        const light = new PointLight(state.id, pos, _scene!);
        light.intensity = intensity;
        light.diffuse = diffuse;
        light.specular = new Color3(0.3, 0.3, 0.3);
        light.range = state.range;
        return light;
    }
    // directional
    const dir = target.subtract(pos).normalize();
    const light = new DirectionalLight(state.id, dir, _scene!);
    light.intensity = intensity;
    light.diffuse = diffuse;
    light.specular = new Color3(0.3, 0.3, 0.3);
    light.position = pos.clone();
    return light;
}

// ======== Stage Light Indicator ========

function _createIndicator(): Mesh {
    const mesh = MeshBuilder.CreateSphere(
        'lightIndicator',
        { diameter: 0.5, segments: 8 },
        _scene!
    );
    const mat = new StandardMaterial('lightIndicatorMat', _scene!);
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
}

function _createDirLine(): Mesh {
    const mesh = MeshBuilder.CreateLines(
        'lightDirLine',
        {
            points: [Vector3.Zero(), new Vector3(0, -2, 0)],
        },
        _scene!
    );
    mesh.color = new Color3(1, 1, 0.5);
    mesh.isPickable = false;
    return mesh;
}

function _updateIndicator(entry: StageLightEntry): void {
    if (!_scene) {
        return;
    }
    const { state, light } = entry;

    // 更新球体指示器
    if (state.enabled) {
        if (!entry.indicator) {
            entry.indicator = _createIndicator();
        }
        entry.indicator.position.copyFrom(light.position);
        const scale = state.enabled ? 1 : 0;
        entry.indicator.scaling.setAll(scale);
        entry.indicator.setEnabled(true);

        // 聚光灯：显示方向线
        if (state.type === 'spot' && light instanceof SpotLight) {
            if (!entry.dirLine) {
                entry.dirLine = _createDirLine();
            }
            const target = new Vector3(state.targetX, state.targetY, state.targetZ);
            const dir = target.subtract(light.position).normalize().scale(3);
            entry.dirLine.position.copyFrom(light.position);
            // 更新线段点
            entry.dirLine.dispose();
            entry.dirLine = MeshBuilder.CreateLines(
                'lightDirLine',
                {
                    points: [Vector3.Zero(), dir],
                },
                _scene!
            );
            (entry.dirLine as LinesMesh).color = new Color3(1, 1, 0.5);
            entry.dirLine.isPickable = false;
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
        entry.indicator.dispose();
        entry.indicator = null;
    }
    if (entry.dirLine) {
        entry.dirLine.dispose();
        entry.dirLine = null;
    }
}

function _defaultLightState(): LightState {
    return {
        hemiIntensity: 0.8,
        dirIntensity: 0.4,
        dirX: 0,
        dirY: 1,
        dirZ: 0,
        dirColor: [1, 1, 1],
        hemiColor: [1, 1, 1],
        groundColor: [0.3, 0.3, 0.4],
        shadowEnabled: false,
        shadowType: 'soft',
        shadowCascades: 2,
        shadowResolution: 1024, // 新增
        shadowBias: 0.0001, // 新增
    };
}

export function getLightState(): LightState {
    if (!hemiLight || !dirLight || !_envSysShadow) {
        const base = _defaultLightState();
        return {
            ...base,
            shadowEnabled: _shadowEnabled,
            shadowType: _shadowType,
            shadowCascades: _shadowCascades,
            shadowResolution: _shadowResolution,
            shadowBias: _shadowBias,
        };
    }
    return {
        hemiIntensity: hemiLight.intensity,
        dirIntensity: dirLight.intensity,
        dirX: -dirLight.direction.x,
        dirY: -dirLight.direction.y,
        dirZ: -dirLight.direction.z,
        dirColor: [dirLight.diffuse.r, dirLight.diffuse.g, dirLight.diffuse.b],
        hemiColor: [hemiLight.diffuse.r, hemiLight.diffuse.g, hemiLight.diffuse.b],
        groundColor: [hemiLight.groundColor.r, hemiLight.groundColor.g, hemiLight.groundColor.b],
        shadowEnabled: _envSysShadow.generator !== null,
        shadowType: _shadowType,
        shadowCascades: _shadowCascades,
        shadowResolution: _shadowResolution, // 新增
        shadowBias: _shadowBias, // 新增
    };
}

export function setLightState(s: Partial<LightState>): void {
    if (!hemiLight || !dirLight || !triggerAutoSave) {
        return;
    }

    if (s.hemiIntensity !== undefined) {
        hemiLight.intensity = s.hemiIntensity;
    }
    if (s.dirIntensity !== undefined) {
        dirLight.intensity = s.dirIntensity;
    }
    if (s.dirX !== undefined || s.dirY !== undefined || s.dirZ !== undefined) {
        const dir = new Vector3(
            -(s.dirX ?? -dirLight.direction.x),
            -(s.dirY ?? -dirLight.direction.y),
            -(s.dirZ ?? -dirLight.direction.z)
        );
        dir.normalize();
        dirLight.direction = dir;
    }
    if (s.dirColor !== undefined) {
        dirLight.diffuse = new Color3(s.dirColor[0], s.dirColor[1], s.dirColor[2]);
    }
    if (s.hemiColor !== undefined) {
        hemiLight.diffuse = new Color3(s.hemiColor[0], s.hemiColor[1], s.hemiColor[2]);
    }
    if (s.groundColor !== undefined) {
        hemiLight.groundColor = new Color3(s.groundColor[0], s.groundColor[1], s.groundColor[2]);
    }
    if (s.shadowEnabled !== undefined) {
        _shadowEnabled = s.shadowEnabled;
    }
    if (s.shadowType !== undefined) {
        _shadowType = s.shadowType;
    }
    let needRebuildShadow = false;
    if (s.shadowCascades !== undefined) {
        _shadowCascades = s.shadowCascades;
        needRebuildShadow = true;
    }
    if (s.shadowResolution !== undefined && s.shadowResolution !== _shadowResolution) {
        _shadowResolution = s.shadowResolution;
        needRebuildShadow = true;
    }
    if (s.shadowBias !== undefined) {
        _shadowBias = s.shadowBias;
        // 如果阴影生成器已存在，直接更新 bias（避免重建）
        if (_envSysShadow?.generator) {
            _envSysShadow.generator.bias = _shadowBias;
        } else {
            needRebuildShadow = true; // 还未创建，重建时会应用
        }
    }
    if (s.shadowEnabled !== undefined || s.shadowType !== undefined || needRebuildShadow) {
        _ensureShadow();
    }
    _updateSunDisc();
    if (!_skipLightAutoSave) {
        triggerAutoSave();
    }
    scheduleRefresh();
    resetPerformanceSnapshot(); // 用户手动修改灯光/阴影设置：清除自动降级快照，避免 auto 模式后续降级覆盖用户意图
}

/** 平滑过渡当前灯光到目标灯光参数，默认 2 秒 */
export function transitionLighting(
    target: Partial<LightState>,
    duration: number = 2000,
    onComplete?: () => void
): void {
    if (!hemiLight || !dirLight || !triggerAutoSave) {
        return;
    }
    const source = getLightState(); // 当前完整状态
    const startTime = performance.now();

    const animLoop = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1.0);
        const lerp = (a: number, b: number) => a + (b - a) * t;

        const interpState: Partial<LightState> = {};
        // 需要重建阴影生成器的参数 — 动画进行中跳过，仅结束时一次性应用
        const rebuildShadowKeys = new Set<string>([
            'shadowResolution',
            'shadowType',
            'shadowEnabled',
        ]);
        // 仅对 target 中存在的字段插值
        for (const key of Object.keys(target) as (keyof LightState)[]) {
            // 跳过会触发每帧重建阴影生成器的参数，在动画结束时统一处理
            if (rebuildShadowKeys.has(key) && t < 1) {
                continue;
            }
            const a = source[key];
            const b = target[key];
            if (typeof a === 'number' && typeof b === 'number') {
                setKey(interpState, key, lerp(a, b) as LightState[typeof key]);
            } else if (Array.isArray(a) && Array.isArray(b)) {
                setKey(interpState, key, a.map((v, i) => lerp(v, b[i])) as LightState[typeof key]);
            } else {
                // 布尔等类型，在动画结束时才切换
                setKey(interpState, key, (t >= 1 ? b : a) as LightState[typeof key]);
            }
        }
        // 动画结束时一次性应用被跳过的阴影重建参数
        if (t >= 1) {
            for (const key of Object.keys(target) as (keyof LightState)[]) {
                if (rebuildShadowKeys.has(key)) {
                    setKey(interpState, key, target[key] as LightState[typeof key]);
                }
            }
        }
        setLightState(interpState);
        if (t >= 1) {
            if (onComplete) {
                onComplete();
            }
        }
    };
}

// ======== Sun Disc ========

function _ensureSunDisc(): Mesh {
    if (!_scene || _sunDisc) {
        return _sunDisc!;
    }
    _sunDisc = MeshBuilder.CreateSphere('sunDisc', { diameter: 30, segments: 16 }, _scene);
    const mat = new StandardMaterial('sunDiscMat', _scene);
    mat.emissiveColor = new Color3(1, 0.9, 0.7);
    mat.disableLighting = true;
    _sunDisc.material = mat;
    _sunDisc.isPickable = false;
    return _sunDisc;
}

/** 更新方向光参考圆盘位置和颜色。圆盘始终在光线来源方向（视线反方向）。
 *  仅作为调光参照，不参与光照计算。 */
export function _updateSunDisc(): void {
    if (!dirLight) {
        return;
    }
    const disc = _ensureSunDisc();
    const d = dirLight.direction;
    const aboveHorizon = d.y < 0;
    const hasIntensity = dirLight.intensity > SUN_DISC_MIN_INTENSITY;
    disc.setEnabled(aboveHorizon && hasIntensity);
    if (aboveHorizon && hasIntensity) {
        disc.position.set(
            -d.x * SUN_DISC_DISTANCE,
            -d.y * SUN_DISC_DISTANCE,
            -d.z * SUN_DISC_DISTANCE
        );
        const b = Math.max(0.05, dirLight.intensity);
        const mat = disc.material as StandardMaterial;
        mat.emissiveColor.set(b, b * 0.9, b * 0.7);
    }
}

export function _disposeSunDisc(): void {
    if (_sunDisc) {
        _sunDisc.dispose();
        _sunDisc = null;
    }
}

// ======== Shadow Generator ========

function _ensureShadow(): void {
    if (!_scene || !_modelRegistry || !_propRegistry || !_envSysShadow) {
        return;
    }

    if (_envSysShadow.generator) {
        _envSysShadow.generator.dispose();
        _envSysShadow.generator = null;
    }
    if (!_shadowEnabled) {
        return;
    }

    const gen = new CascadedShadowGenerator(_shadowResolution, dirLight);
    gen.numCascades = _shadowCascades;
    // CSM 仅支持 FILTER_NONE / FILTER_PCF / FILTER_PCSS
    if (_shadowType === 'pcf') {
        gen.usePercentageCloserFiltering = true;
    } else if (_shadowType === 'soft') {
        gen.useContactHardeningShadow = true;
    }
    gen.bias = _shadowBias;

    for (const [, inst] of _modelRegistry) {
        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                gen.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }
    }
    for (const [, inst] of _propRegistry) {
        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                gen.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }
    }

    _envSysShadow.generator = gen;
}

/** 当模型/道具注册表更新时，重新生成阴影投射者列表。 */
export function rebuildShadowCasters(): void {
    _ensureShadow();
    rebuildStageLightShadows();
}

// ======== Stage Lights ========

const _stageShadows = new Map<string, ShadowGenerator>();

export function getStageLights(): StageLightState[] {
    const result: StageLightState[] = [];
    for (const [, entry] of _stageLights) {
        result.push(_readStageLightState(entry));
    }
    return result;
}

export function getActiveStageLightId(): string | null {
    return _activeStageLightId;
}

export function setActiveStageLightId(id: string): void {
    if (_stageLights.has(id)) {
        _activeStageLightId = id;
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
    const targetId = id ?? s.id ?? _activeStageLightId;
    if (!targetId) {
        return;
    }
    const entry = _stageLights.get(targetId);
    if (!entry || !triggerAutoSave) {
        return;
    }

    // 类型切换：dispose 旧灯 + 旧阴影 + 创建新灯
    if (s.type !== undefined && s.type !== entry.state.type) {
        Object.assign(entry.state, s);
        entry.light.dispose();
        _disposeStageShadow(targetId);
        entry.light = _createStageLight(s.type, entry.state);
        _ensureStageShadow(targetId);
        _updateIndicator(entry);
        triggerAutoSave();
        return;
    }

    Object.assign(entry.state, s);
    _applyStageLightParams(entry, s);

    // 阴影重建条件
    const shadowKeys = new Set([
        'enabled',
        'shadowEnabled',
        'shadowType',
        'shadowResolution',
        'shadowBias',
    ]);
    let needShadowRebuild = false;
    for (const key of shadowKeys) {
        if ((s as Record<string, unknown>)[key] !== undefined) {
            needShadowRebuild = true;
            break;
        }
    }
    if (needShadowRebuild) {
        _ensureStageShadow(targetId);
    }

    // 更新指示器
    _updateIndicator(entry);

    triggerAutoSave();
}

export function addStageLight(
    type: StageLightType = 'spot',
    preset?: Partial<StageLightState>
): string {
    _stageLightCounter++;
    const id = `light-${_stageLightCounter}`;
    const defaultNames: Record<StageLightType, string> = {
        spot: '聚光灯',
        point: '点光源',
        directional: '平行光',
    };
    const name = `${defaultNames[type]} ${_stageLightCounter}`;
    const state = { ..._defaultStageLightState(id, name), type, ...preset, id, name };
    state.posX = _stageLightCounter * 2 - 2;
    state.orbitAzimuth = 180 + (_stageLightCounter - 1) * 30;
    const light = _createStageLight(type, state);
    const entry: StageLightEntry = { state, light, indicator: null, dirLine: null };
    _stageLights.set(id, entry);
    _activeStageLightId = id;
    _ensureStageShadow(id);
    _updateIndicator(entry);
    if (triggerAutoSave) {
        triggerAutoSave();
    }
    return id;
}

export function removeStageLight(id: string): boolean {
    const entry = _stageLights.get(id);
    if (!entry) {
        return false;
    }
    if (_stageLights.size <= 1) {
        return false;
    }
    _disposeIndicator(entry);
    entry.light.dispose();
    _disposeStageShadow(id);
    _stageLights.delete(id);
    if (_activeStageLightId === id) {
        _activeStageLightId = _stageLights.keys().next().value ?? null;
    }
    if (triggerAutoSave) {
        triggerAutoSave();
    }
    return true;
}

/** 批量加载舞台灯（反序列化用），会清空现有灯 */
export function loadStageLights(states: StageLightState[]): void {
    // 清空旧灯
    for (const [lid, entry] of _stageLights) {
        _disposeIndicator(entry);
        entry.light.dispose();
    }
    _stageLights.clear();
    for (const [sid] of _stageShadows) {
        _disposeStageShadow(sid);
    }
    _stageShadows.clear();

    if (states.length === 0) {
        const def = _defaultStageLightState('light-1', '主光');
        const light = _createStageLight(def.type, def);
        const entry: StageLightEntry = { state: def, light, indicator: null, dirLine: null };
        _stageLights.set(def.id, entry);
        _activeStageLightId = def.id;
        _stageLightCounter = 1;
        _ensureStageShadow(def.id);
        _updateIndicator(entry);
        return;
    }

    let maxNum = 0;
    for (const s of states) {
        const light = _createStageLight(s.type, s);
        const entry: StageLightEntry = { state: { ...s }, light, indicator: null, dirLine: null };
        _stageLights.set(s.id, entry);
        _ensureStageShadow(s.id);
        _updateIndicator(entry);
        const m = s.id.match(/light-(\d+)/);
        if (m) {
            maxNum = Math.max(maxNum, parseInt(m[1]));
        }
    }
    _stageLightCounter = maxNum;
    _activeStageLightId = states[0].id;
}

/** 重建所有舞台灯的阴影投射者列表（模型/道具变化时调用） */
export function rebuildStageLightShadows(): void {
    for (const [id] of _stageLights) {
        _ensureStageShadow(id);
    }
}

// —— 内部辅助 ——

function _getEntry(id?: string): StageLightEntry | null {
    const targetId = id ?? _activeStageLightId;
    if (!targetId) {
        return null;
    }
    return _stageLights.get(targetId) ?? null;
}

function _readStageLightState(entry: StageLightEntry): StageLightState {
    const { state, light } = entry;
    const base: StageLightState = {
        ...state,
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
        light.diffuse = new Color3(s.color[0], s.color[1], s.color[2]);
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
}

function _ensureStageShadow(id: string): void {
    if (!_scene || !_modelRegistry || !_propRegistry) {
        return;
    }
    const entry = _stageLights.get(id);
    if (!entry) {
        return;
    }
    const { state, light } = entry;

    // dispose 旧的
    const old = _stageShadows.get(id);
    if (old) {
        old.dispose();
        _stageShadows.delete(id);
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

    for (const [, inst] of _modelRegistry) {
        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                gen.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }
    }
    for (const [, inst] of _propRegistry) {
        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                gen.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }
    }
    _stageShadows.set(id, gen);
}

function _disposeStageShadow(id: string): void {
    const gen = _stageShadows.get(id);
    if (gen) {
        gen.dispose();
        _stageShadows.delete(id);
    }
}

// ======== 3D Gizmo (Position + Rotation) ========

/** 获取或创建 gizmo 渲染层（独立于主场景渲染）。 */
function _getGizmoLayer(): UtilityLayerRenderer {
    if (!_gizmoLayer && _scene) {
        _gizmoLayer = new UtilityLayerRenderer(_scene);
        _gizmoLayer.shouldRender = false; // 默认不渲染
    }
    return _gizmoLayer!;
}

/**
 * 为指定灯光激活 3D 拖拽 Gizmo。
 * - PositionGizmo：拖拽坐标轴移动灯光位置
 * - RotationGizmo：拖拽圆环调整聚光灯方向（仅 spot/directional）
 */
export function attachLightGizmo(id: string): boolean {
    if (!_scene) {
        return false;
    }
    const entry = _stageLights.get(id);
    if (!entry) {
        return false;
    }

    // 先detach之前的
    detachLightGizmo();

    const layer = _getGizmoLayer();
    layer.shouldRender = true;

    // Position gizmo
    _posGizmo = new PositionGizmo(layer);
    _posGizmo.attachedNode = entry.light;
    // 拖拽中实时更新指示器
    _posGizmo.onDragObservable.add(() => {
        if (entry.indicator) {
            entry.indicator.position.copyFrom(entry.light.position);
        }
        if (entry.dirLine) {
            entry.dirLine.position.copyFrom(entry.light.position);
        }
    });
    _posGizmo.onDragEndObservable.add(() => {
        const pos = entry.light.position;
        setStageLightState(
            {
                posX: pos.x,
                posY: pos.y,
                posZ: pos.z,
            },
            id
        );
    });

    // Rotation gizmo（仅 spot/directional，point 无方向）
    if (entry.state.type !== 'point') {
        _rotGizmo = new RotationGizmo(layer);
        _rotGizmo.attachedNode = entry.light;
        _rotGizmo.onDragEndObservable.add(() => {
            // 从灯光当前 position + target 推导新目标
            // （direction 属性不可直接旋转，通过 position 位移同步）
            const pos = entry.light.position;
            if (entry.state.type === 'spot' && entry.light instanceof SpotLight) {
                const curDir = entry.light.direction;
                const target = pos.add(curDir.scale(10));
                setStageLightState(
                    {
                        targetX: target.x,
                        targetY: target.y,
                        targetZ: target.z,
                    },
                    id
                );
            }
            if (entry.state.type === 'directional' && entry.light instanceof DirectionalLight) {
                const dir = entry.light.direction;
                const target = pos.add(dir.scale(10));
                setStageLightState(
                    {
                        targetX: target.x,
                        targetY: target.y,
                        targetZ: target.z,
                    },
                    id
                );
            }
        });
    }

    _gizmoTarget = id;
    return true;
}

/** 移除当前灯光的 3D Gizmo。 */
export function detachLightGizmo(): void {
    if (_posGizmo) {
        _posGizmo.dispose();
        _posGizmo = null;
    }
    if (_rotGizmo) {
        _rotGizmo.dispose();
        _rotGizmo = null;
    }
    if (_gizmoLayer) {
        _gizmoLayer.shouldRender = false;
    }
    _gizmoTarget = null;
}

/** 当前是否有 gizmo 激活。 */
export function isGizmoActive(): boolean {
    return _gizmoTarget !== null;
}

/** 获取当前 gizmo 绑定的灯光 ID。 */
export function getGizmoTargetId(): string | null {
    return _gizmoTarget;
}

// ======== Lighting TWEEN (with cancel support) ========

interface LightingTween {
    id: number;
    cancel: () => void;
}
let _tweenIdCounter = 0;
const _activeTweens = new Map<number, LightingTween>();

function _cancelAllLightingTweens(): void {
    for (const [, tw] of _activeTweens) {
        tw.cancel();
    }
    _activeTweens.clear();
}

function _tweenValue(
    from: number,
    to: number,
    durationMs: number,
    onUpdate: (v: number) => void
): LightingTween {
    const id = ++_tweenIdCounter;
    let cancelled = false;
    const start = performance.now();

    const tick = () => {
        if (cancelled) {
            return;
        }
        const t = Math.min(1, (performance.now() - start) / durationMs);
        const eased = t * (2 - t); // ease-out quad
        onUpdate(from + (to - from) * eased);
        if (t >= 1) {
            _activeTweens.delete(id);
        }
    };

    const tw: LightingTween = {
        id,
        cancel: () => {
            cancelled = true;
            _activeTweens.delete(id);
        },
    };
    _activeTweens.set(id, tw);
    _scene.onBeforeRenderObservable.addOnce(tick);
    return tw;
}

function _tweenColor3(
    from: Color3,
    to: Color3,
    durationMs: number,
    onUpdate: (c: Color3) => void
): void {
    let curR = from.r,
        curG = from.g,
        curB = from.b;
    _tweenValue(0, 1, durationMs, (t) => {
        curR = from.r + (to.r - from.r) * t;
        curG = from.g + (to.g - from.g) * t;
        curB = from.b + (to.b - from.b) * t;
        onUpdate(new Color3(curR, curG, curB));
    });
}

// ======== Lighting Preset Application ========

import { LIGHTING_PRESETS, type LightingPresetLight } from './lighting-presets';

/**
 * 应用灯光预设——复用现有灯光，平滑过渡参数。
 * 由 EnvBridge 在 lightingPresetName 变化时调用。
 */
export function applyLightingPresetFromEnv(presetName: string | null): void {
    if (!presetName) {
        return;
    }
    const preset = LIGHTING_PRESETS[presetName];
    if (!preset) {
        return;
    }

    _cancelAllLightingTweens();

    const currentIds = Array.from(_stageLights.keys());
    const targetCount = preset.lights.length;

    // 1. 补齐灯光数量
    while (Array.from(_stageLights.keys()).length < targetCount) {
        const idx = Array.from(_stageLights.keys()).length;
        const pl = preset.lights[idx];
        addStageLight(pl.type, pl.state as Partial<import('./lighting').StageLightState>);
    }

    // 2. 删除多余灯光
    while (Array.from(_stageLights.keys()).length > targetCount) {
        const ids = Array.from(_stageLights.keys());
        removeStageLight(ids[ids.length - 1]);
    }

    // 3. 平滑过渡每盏灯的参数
    const ids = Array.from(_stageLights.keys());
    for (let i = 0; i < ids.length; i++) {
        const entry = _stageLights.get(ids[i]);
        if (!entry) {
            continue;
        }
        const pl = preset.lights[i];

        // 切换类型（需要重建，跳过 tween）
        if (pl.type !== entry.state.type) {
            setStageLightState(
                { type: pl.type, ...pl.state } as Partial<import('./lighting').StageLightState>,
                ids[i]
            );
            continue;
        }

        // 位置过渡（orbit 参数）
        if (
            pl.state.orbitAzimuth !== undefined ||
            pl.state.orbitElevation !== undefined ||
            pl.state.orbitDistance !== undefined
        ) {
            const fromAz = entry.state.orbitAzimuth;
            const fromEl = entry.state.orbitElevation;
            const fromDist = entry.state.orbitDistance;
            const toAz = (pl.state.orbitAzimuth as number) ?? fromAz;
            const toEl = (pl.state.orbitElevation as number) ?? fromEl;
            const toDist = (pl.state.orbitDistance as number) ?? fromDist;
            _tweenValue(0, 1, 500, (t) => {
                setStageLightState(
                    {
                        orbitAzimuth: fromAz + (toAz - fromAz) * t,
                        orbitElevation: fromEl + (toEl - fromEl) * t,
                        orbitDistance: fromDist + (toDist - fromDist) * t,
                    },
                    ids[i]
                );
            });
        }

        // 强度过渡
        if (pl.state.intensity !== undefined) {
            const from = entry.state.intensity;
            const to = pl.state.intensity as number;
            _tweenValue(from, to, 300, (v) => {
                setStageLightState({ intensity: v }, ids[i]);
            });
        }

        // 颜色过渡
        if (pl.state.color !== undefined) {
            const from = new Color3(
                entry.state.color[0],
                entry.state.color[1],
                entry.state.color[2]
            );
            const tc = pl.state.color as [number, number, number];
            const to = new Color3(tc[0], tc[1], tc[2]);
            _tweenColor3(from, to, 300, (c) => {
                setStageLightState({ color: [c.r, c.g, c.b] }, ids[i]);
            });
        }

        // 直接设置的参数（无 tween）
        const directKeys = [
            'angle',
            'exponent',
            'range',
            'shadowEnabled',
            'shadowType',
            'shadowResolution',
            'shadowBias',
            'enabled',
        ] as const;
        const directUpdates: Record<string, unknown> = {};
        let hasDirect = false;
        for (const key of directKeys) {
            if (pl.state[key] !== undefined) {
                directUpdates[key] = pl.state[key];
                hasDirect = true;
            }
        }
        if (hasDirect) {
            setStageLightState(
                directUpdates as Partial<import('./lighting').StageLightState>,
                ids[i]
            );
        }
    }
}
