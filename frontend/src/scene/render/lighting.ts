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
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { ModelInstance, PropInstance } from '../../core/config';

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
    enabled: boolean;
    type: StageLightType;   // 灯光类型
    intensity: number;
    color: [number, number, number];
    // SpotLight 专属
    angle: number;          // 锥角（弧度）
    exponent: number;       // 衰减指数
    // PointLight 专属
    range: number;          // 衰减距离
    // 位置
    posX: number;
    posY: number;
    posZ: number;
    // 目标点（spot 用；directional 用其反推方向）
    targetX: number;
    targetY: number;
    targetZ: number;
    // 轨道控制参数（从 posX/Y/Z 实时推导，写回时反算）
    orbitAzimuth: number;   // -180~180 度，水平绕 Y 轴
    orbitElevation: number; // -90~90 度，垂直仰角
    orbitDistance: number;  // 距原点距离
}

function _defaultStageLightState(): StageLightState {
    return {
        enabled: false,
        type: 'spot',
        intensity: 0.8,
        color: [1, 1, 1],
        angle: 0.8,  // ≈46°，兼顾覆盖和聚光感
        exponent: 2,
        range: 50,
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
let _triggerAutoSave: (() => void) | null = null;

export let hemiLight: HemisphericLight;
export let dirLight: DirectionalLight;
export let stageLight: SpotLight | PointLight | DirectionalLight;

let _stageLightState: StageLightState = _defaultStageLightState();
let _stageLightType: StageLightType = 'spot';

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

const SUN_DISC_DISTANCE = 400;

/** 太阳圆盘可见的最小方向光强度。低于此值时隐藏。 */
const SUN_DISC_MIN_INTENSITY = 0.01;

export function initLighting(
    scene: import('@babylonjs/core/scene').Scene,
    modelRegistry: Map<string, ModelInstance>,
    propRegistry: Map<string, PropInstance>,
    envSysShadow: { generator: ShadowGenerator | null },
    triggerAutoSave: () => void
): void {
    _scene = scene;
    _modelRegistry = modelRegistry;
    _propRegistry = propRegistry;
    _envSysShadow = envSysShadow;
    _triggerAutoSave = triggerAutoSave;

    hemiLight = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.5), scene);
    hemiLight.intensity = 0.8;
    hemiLight.diffuse = new Color3(1, 1, 1);
    hemiLight.groundColor = new Color3(0.3, 0.3, 0.4);

    dirLight = new DirectionalLight('dir', new Vector3(0, -1, 0), scene);
    dirLight.intensity = 0.4;
    dirLight.position = new Vector3(0, 40, 0);

    const def = _defaultStageLightState();
    stageLight = new SpotLight(
        'stage',
        new Vector3(def.posX, def.posY, def.posZ),
        new Vector3(0, -1, 0).normalize(), // 临时方向，马上 setDirectionToTarget 修正
        def.angle,
        def.exponent,
        scene
    );
    stageLight.intensity = 0; // 默认关闭
    stageLight.diffuse = new Color3(def.color[0], def.color[1], def.color[2]);
    stageLight.specular = new Color3(0.3, 0.3, 0.3);
    // 对准角色中心
    stageLight.setDirectionToTarget(new Vector3(def.targetX, def.targetY, def.targetZ));
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
    if (!hemiLight || !dirLight || !_triggerAutoSave) {
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
    if (s.shadowCascades !== undefined) {
        _shadowCascades = s.shadowCascades;
    }

    let needRebuildShadow = false;
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
        _triggerAutoSave();
    }
}

/** 平滑过渡当前灯光到目标灯光参数，默认 2 秒 */
export function transitionLighting(
    target: Partial<LightState>,
    duration: number = 2000,
    onComplete?: () => void
): void {
    if (!hemiLight || !dirLight || !_triggerAutoSave) {
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
        } else {
            requestAnimationFrame(animLoop);
        }
    };
    requestAnimationFrame(animLoop);
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
    if (!dirLight) return;
    const disc = _ensureSunDisc();
    const d = dirLight.direction;
    const aboveHorizon = d.y < 0;
    const hasIntensity = dirLight.intensity > SUN_DISC_MIN_INTENSITY;
    disc.setEnabled(aboveHorizon && hasIntensity);
    if (aboveHorizon && hasIntensity) {
        disc.position = new Vector3(
            -d.x * SUN_DISC_DISTANCE,
            -d.y * SUN_DISC_DISTANCE,
            -d.z * SUN_DISC_DISTANCE
        );
        const b = Math.max(0.05, dirLight.intensity);
        const mat = disc.material as StandardMaterial;
        mat.emissiveColor = new Color3(b, b * 0.9, b * 0.7);
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

    const gen = new ShadowGenerator(_shadowResolution, dirLight);
    gen.useBlurExponentialShadowMap = _shadowType !== 'hard';
    gen.useKernelBlur = _shadowType === 'pcf';
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
}

// ======== Stage Light ========

export function getStageLightState(): StageLightState {
    if (!stageLight) return _defaultStageLightState();
    return {
        ..._stageLightState,
        intensity: stageLight.intensity,
        color: [stageLight.diffuse.r, stageLight.diffuse.g, stageLight.diffuse.b],
        angle: stageLight.angle,
        exponent: stageLight.exponent,
        posX: stageLight.position.x,
        posY: stageLight.position.y,
        posZ: stageLight.position.z,
        // 从位置推导轨道参数
        orbitAzimuth: Math.round(Math.atan2(stageLight.position.x, stageLight.position.z) * 180 / Math.PI),
        orbitElevation: Math.round(Math.asin(stageLight.position.y / Math.max(0.1, stageLight.position.length())) * 180 / Math.PI),
        orbitDistance: Math.round(stageLight.position.length()),
    };
}

export function setStageLightState(s: Partial<StageLightState>): void {
    if (!stageLight || !_triggerAutoSave) return;
    Object.assign(_stageLightState, s);

    if (s.enabled !== undefined) {
        stageLight.intensity = s.enabled ? _stageLightState.intensity : 0;
    }
    if (s.intensity !== undefined && _stageLightState.enabled) {
        stageLight.intensity = s.intensity;
    }
    if (s.color !== undefined) {
        stageLight.diffuse = new Color3(s.color[0], s.color[1], s.color[2]);
    }
    if (s.angle !== undefined) {
        stageLight.angle = s.angle;
    }
    if (s.exponent !== undefined) {
        stageLight.exponent = s.exponent;
    }
    if (s.orbitAzimuth !== undefined || s.orbitElevation !== undefined || s.orbitDistance !== undefined) {
        const az = (s.orbitAzimuth ?? _stageLightState.orbitAzimuth) * Math.PI / 180;
        const el = (s.orbitElevation ?? _stageLightState.orbitElevation) * Math.PI / 180;
        const dist = s.orbitDistance ?? _stageLightState.orbitDistance;
        stageLight.position = new Vector3(
            dist * Math.cos(el) * Math.sin(az),
            dist * Math.sin(el),
            dist * Math.cos(el) * Math.cos(az)
        );
        // 移动后重新对准目标
        stageLight.setDirectionToTarget(new Vector3(0, 0, 0));
    }
    if (s.posX !== undefined || s.posY !== undefined || s.posZ !== undefined) {
        stageLight.position = new Vector3(
            s.posX ?? stageLight.position.x,
            s.posY ?? stageLight.position.y,
            s.posZ ?? stageLight.position.z
        );
    }
    if (s.targetX !== undefined || s.targetY !== undefined || s.targetZ !== undefined) {
        stageLight.setDirectionToTarget(new Vector3(
            s.targetX ?? _stageLightState.targetX,
            s.targetY ?? _stageLightState.targetY,
            s.targetZ ?? _stageLightState.targetZ
        ));
    }
    _triggerAutoSave();
}
