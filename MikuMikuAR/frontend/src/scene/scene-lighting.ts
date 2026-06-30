// [doc:architecture] Scene Lighting — 光照、阴影、太阳盘
// 职责: 方向光/半球光管理、阴影生成器、太阳圆盘可视化
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { ModelInstance, PropInstance } from '../core/config';

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

// ======== Lights (module-level state) ========

let _scene: import('@babylonjs/core/scene').Scene | null = null;
let _modelRegistry: Map<string, ModelInstance> | null = null;
let _propRegistry: Map<string, PropInstance> | null = null;
let _envSysShadow: { generator: ShadowGenerator | null } | null = null;
let _triggerAutoSave: (() => void) | null = null;

export let hemiLight: HemisphericLight;
export let dirLight: DirectionalLight;

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

    dirLight = new DirectionalLight('dir', new Vector3(-0.5, -1, -0.5), scene);
    dirLight.intensity = 0.4;
    dirLight.position = new Vector3(20, 40, 20);
}

function _defaultLightState(): LightState {
    return {
        hemiIntensity: 0.8,
        dirIntensity: 0.4,
        dirX: -0.5,
        dirY: -1,
        dirZ: -0.5,
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
        return _defaultLightState();
    }
    return {
        hemiIntensity: hemiLight.intensity,
        dirIntensity: dirLight.intensity,
        dirX: dirLight.direction.x,
        dirY: dirLight.direction.y,
        dirZ: dirLight.direction.z,
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
        dirLight.direction = new Vector3(
            s.dirX ?? dirLight.direction.x,
            s.dirY ?? dirLight.direction.y,
            s.dirZ ?? dirLight.direction.z
        );
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

    // 夜间或极低光强时自动禁用阴影（避免无用 GPU 开销）
    // 仅当用户未显式设置 shadowEnabled 时才自动关闭，避免覆盖用户意图
    if (s.dirIntensity !== undefined && s.dirIntensity < 0.1 && s.shadowEnabled === undefined) {
        _shadowEnabled = false;
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
    if (!_skipLightAutoSave) _triggerAutoSave();
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
        const rebuildShadowKeys = new Set<string>(['shadowResolution', 'shadowType', 'shadowEnabled']);
        // 仅对 target 中存在的字段插值
        for (const key of Object.keys(target) as (keyof LightState)[]) {
            // 跳过会触发每帧重建阴影生成器的参数，在动画结束时统一处理
            if (rebuildShadowKeys.has(key) && t < 1) continue;
            const a = source[key];
            const b = target[key];
            if (typeof a === 'number' && typeof b === 'number') {
                (interpState as any)[key] = lerp(a, b);
            } else if (Array.isArray(a) && Array.isArray(b)) {
                (interpState as any)[key] = a.map((v, i) => lerp(v, b[i])) as any;
            } else {
                // 布尔等类型，在动画结束时才切换
                (interpState as any)[key] = t >= 1 ? b : a;
            }
        }
        // 动画结束时一次性应用被跳过的阴影重建参数
        if (t >= 1) {
            for (const key of Object.keys(target) as (keyof LightState)[]) {
                if (rebuildShadowKeys.has(key)) {
                    (interpState as any)[key] = target[key];
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
    _sunDisc = MeshBuilder.CreateSphere('sunDisc', { diameter: 20, segments: 8 }, _scene);
    const mat = new StandardMaterial('sunDiscMat', _scene);
    mat.emissiveColor = new Color3(1, 0.9, 0.7);
    mat.disableLighting = true;
    _sunDisc.material = mat;
    _sunDisc.isPickable = false;
    return _sunDisc;
}

/** 更新太阳圆盘位置和颜色（根据方向光方向和强度）。@internal scene-env-bridge.ts 使用。 */
export function _updateSunDisc(): void {
    if (!dirLight) {
        return;
    }
    const disc = _ensureSunDisc();
    const d = dirLight.direction;
    if (d.y <= 0) {
        disc.setEnabled(false);
        return;
    }
    disc.setEnabled(true);
    disc.position = new Vector3(
        d.x * SUN_DISC_DISTANCE,
        d.y * SUN_DISC_DISTANCE,
        d.z * SUN_DISC_DISTANCE
    );
    const b = Math.max(0.05, dirLight.intensity);
    const mat = disc.material as StandardMaterial;
    mat.emissiveColor = new Color3(b, b * 0.9, b * 0.7);
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
    gen.bias = _shadowBias; // 改为变量

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
