// [doc:architecture] Scene Lighting — 光照、阴影、太阳盘（barrel + 主光管理）
// 职责: 方向光/半球光管理、阴影生成器、太阳圆盘可视化
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。
// 子文件（lighting-stage/-shadow/-sun/-tween）通过单一 `lightingState` 共享全部模块状态。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { observe } from '@/core/observer-handle';
import { initTransformGizmo } from './transform-gizmo';
import { scheduleRefresh } from '@/core/reactivity';
import { resetPerformanceSnapshot, isSnapshotResetSuppressed } from './performance';
import { setKey } from '@/core/utils';
import { safeDispose } from '@/core/dispose-helpers';
import { col3FromTriple } from '@/core/color-helpers';
import { envState } from '@/core/config';
import { lightingState } from './lighting-state';
import { _createStageLight, _updateIndicator, _disposeStageLightEntry } from './lighting-stage';
import { _ensureShadow } from './lighting-shadow';
import { _updateSunDisc, _disposeSunDisc } from './lighting-sun';
import { _cancelAllLightingTweens } from './lighting-tween';
import { tickPersonalLights, disposeAllPersonalLights, tickStageLightFollow } from './lighting-follow';

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
    // 指示球体缩放/透明度（UI 大统一 — 与模型/道具共享 buildTransformCard）
    indicatorScale: number;
    indicatorOpacity: number;
    // 真实光锥（锥形光柱可视化）
    coneEnabled: boolean;
    coneIntensity: number; // 0-2, default 0.5
    coneLength: number; // 1-50, default 20
    coneSoftness: number; // 0-1, default 0.5
    // [doc:adr-168] 跟随目标（null = 静态模式，向后兼容）
    followTarget: {
        modelId: string;
        boneName: string | null;
        offset: [number, number, number];
        smoothing: number; // 0-1, default 0.15
        moveWithTarget: boolean; // default false
    } | null;
}

export function _defaultStageLightState(id: string, name: string): StageLightState {
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
        posY: 35,
        posZ: 0,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        orbitAzimuth: 180,
        orbitElevation: 90,
        orbitDistance: 35,
        indicatorScale: 1,
        indicatorOpacity: 1,
        // 光锥默认关闭
        coneEnabled: false,
        coneIntensity: 0.5,
        coneLength: 30,
        coneSoftness: 0.5,
        // [doc:adr-168] 默认静态模式
        followTarget: null,
    };
}

// ======== Lights (module-level state) ========

/** 主半球光（未初始化时为 null）。导出 getter 替代原 `export let`，消除导出可变绑定。 */
export function getHemiLight(): HemisphericLight | null {
    return lightingState.hemiLight;
}

/** 主方向光（未初始化时为 null）。 */
export function getDirLight(): DirectionalLight | null {
    return lightingState.dirLight;
}

/** 预设动画期间临时抑制 setLightState 内的自动保存，由 applyEnvPreset 控制 */
export function setSkipLightAutoSave(skip: boolean): void {
    lightingState.skipLightAutoSave = skip;
}

export function initLighting(
    scene: Scene,
    envSysShadow: { generator: ShadowGenerator | null },
    saveCb: () => void
): void {
    // 防御重复调用（正常流程由 disposeScene 保证，此处为模块级安全网）
    if (lightingState.scene) {
        disposeLighting();
    }
    lightingState.scene = scene;
    initTransformGizmo(scene);
    lightingState.envSysShadow = envSysShadow;
    lightingState.triggerAutoSave = saveCb;

    lightingState.hemiLight = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.5), scene);
    lightingState.hemiLight.intensity = 0.8;
    lightingState.hemiLight.diffuse = new Color3(1, 1, 1);
    lightingState.hemiLight.groundColor = new Color3(0.3, 0.3, 0.4);

    lightingState.dirLight = new DirectionalLight('dir', new Vector3(0, -1, 0), scene);
    lightingState.dirLight.intensity = 0.4;
    lightingState.dirLight.position = new Vector3(0, 40, 0);

    const def = _defaultStageLightState('light-1', '主光');
    const light = _createStageLight(def.type, def);
    lightingState.stageLights.set(def.id, { state: def, light, indicator: null, dirLine: null });
    lightingState.activeStageLightId = def.id;
    lightingState.stageLightCounter = 1;
    _updateIndicator(lightingState.stageLights.get(def.id)!);

    // 每帧更新光锥的相机位置 uniform（fresnel 计算需要）
    lightingState.coneUpdateHandle = observe(lightingState.scene.onBeforeRenderObservable, () => {
        const cam = lightingState.scene?.activeCamera;
        if (!cam) {
            return;
        }
        for (const [, cone] of lightingState.stageCones) {
            cone.material.setVector3('u_cameraPos', cam.position);
        }
    });

    // [doc:adr-168] 个人灯 tick：骨骼动画求值后再更新灯位置，避免延迟一帧
    lightingState.personalLightTickHandle = observe(
        lightingState.scene.onAfterAnimationsObservable,
        tickPersonalLights
    );

    // [doc:adr-168] 舞台灯追光 tick：更新绑定了 followTarget 的舞台灯
    observe(lightingState.scene.onAfterAnimationsObservable, tickStageLightFollow);
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

/** [doc:adr-132] 当 envBrightness 变化时 rebake 存储的光照强度 */
export function rebakeEnvBrightness(ratio: number): void {
    if (!lightingState.hemiLight || !lightingState.dirLight || ratio <= 0) {
        return;
    }
    lightingState.hemiLight.intensity *= ratio;
    lightingState.dirLight.intensity *= ratio;
}

export function getLightState(): LightState {
    const envBrightness = Math.max(0.01, envState.envBrightness ?? 1);
    if (!lightingState.hemiLight || !lightingState.dirLight || !lightingState.envSysShadow) {
        const base = _defaultLightState();
        return {
            ...base,
            shadowEnabled: lightingState.shadowEnabled,
            shadowType: lightingState.shadowType,
            shadowCascades: lightingState.shadowCascades,
            shadowResolution: lightingState.shadowResolution,
            shadowBias: lightingState.shadowBias,
        };
    }
    return {
        hemiIntensity: lightingState.hemiLight.intensity / envBrightness,
        dirIntensity: lightingState.dirLight.intensity / envBrightness,
        dirX: -lightingState.dirLight.direction.x,
        dirY: -lightingState.dirLight.direction.y,
        dirZ: -lightingState.dirLight.direction.z,
        dirColor: [
            lightingState.dirLight.diffuse.r,
            lightingState.dirLight.diffuse.g,
            lightingState.dirLight.diffuse.b,
        ],
        hemiColor: [
            lightingState.hemiLight.diffuse.r,
            lightingState.hemiLight.diffuse.g,
            lightingState.hemiLight.diffuse.b,
        ],
        groundColor: [
            lightingState.hemiLight.groundColor.r,
            lightingState.hemiLight.groundColor.g,
            lightingState.hemiLight.groundColor.b,
        ],
        shadowEnabled: lightingState.envSysShadow.generator !== null,
        shadowType: lightingState.shadowType,
        shadowCascades: lightingState.shadowCascades,
        shadowResolution: lightingState.shadowResolution, // 新增
        shadowBias: lightingState.shadowBias, // 新增
    };
}

export function setLightState(s: Partial<LightState>): void {
    if (!lightingState.hemiLight || !lightingState.dirLight || !lightingState.triggerAutoSave) {
        return;
    }

    const envBrightness = Math.max(0.01, envState.envBrightness ?? 1);
    if (s.hemiIntensity !== undefined) {
        lightingState.hemiLight.intensity = s.hemiIntensity * envBrightness;
    }
    if (s.dirIntensity !== undefined) {
        lightingState.dirLight.intensity = s.dirIntensity * envBrightness;
    }
    if (s.dirX !== undefined || s.dirY !== undefined || s.dirZ !== undefined) {
        const dir = new Vector3(
            -(s.dirX ?? -lightingState.dirLight.direction.x),
            -(s.dirY ?? -lightingState.dirLight.direction.y),
            -(s.dirZ ?? -lightingState.dirLight.direction.z)
        );
        dir.normalize();
        lightingState.dirLight.direction = dir;
    }
    if (s.dirColor !== undefined) {
        lightingState.dirLight.diffuse = col3FromTriple(s.dirColor);
    }
    if (s.hemiColor !== undefined) {
        lightingState.hemiLight.diffuse = col3FromTriple(s.hemiColor);
    }
    if (s.groundColor !== undefined) {
        lightingState.hemiLight.groundColor = col3FromTriple(s.groundColor);
    }
    if (s.shadowEnabled !== undefined) {
        lightingState.shadowEnabled = s.shadowEnabled;
    }
    if (s.shadowType !== undefined) {
        lightingState.shadowType = s.shadowType;
    }
    let needRebuildShadow = false;
    if (s.shadowCascades !== undefined) {
        lightingState.shadowCascades = s.shadowCascades;
        needRebuildShadow = true;
    }
    if (s.shadowResolution !== undefined && s.shadowResolution !== lightingState.shadowResolution) {
        lightingState.shadowResolution = s.shadowResolution;
        needRebuildShadow = true;
    }
    if (s.shadowBias !== undefined) {
        lightingState.shadowBias = s.shadowBias;
        // 如果阴影生成器已存在，直接更新 bias（避免重建）
        if (lightingState.envSysShadow?.generator) {
            lightingState.envSysShadow.generator.bias = lightingState.shadowBias;
        } else {
            needRebuildShadow = true; // 还未创建，重建时会应用
        }
    }
    if (s.shadowEnabled !== undefined || s.shadowType !== undefined || needRebuildShadow) {
        _ensureShadow();
    }
    _updateSunDisc();
    if (!lightingState.skipLightAutoSave) {
        lightingState.triggerAutoSave();
        // 用户手动修改灯光/阴影设置：清除自动降级快照，避免 auto 模式后续降级覆盖用户意图。
        // applyDegrade 触发的 setLightState 通过 _suppressSnapshotReset 跳过，防止降级→恢复→再降级循环。
        if (!isSnapshotResetSuppressed()) {
            resetPerformanceSnapshot();
        }
    }
    scheduleRefresh();
}

/** 平滑过渡当前灯光到目标灯光参数，默认 2 秒 */
export function transitionLighting(
    target: Partial<LightState>,
    duration: number = 2000,
    onComplete?: () => void
): void {
    if (
        !lightingState.hemiLight ||
        !lightingState.dirLight ||
        !lightingState.triggerAutoSave ||
        !lightingState.scene
    ) {
        return;
    }
    const source = getLightState(); // 当前完整状态
    const startTime = performance.now();
    // 需要重建阴影生成器的参数 — 动画进行中跳，仅结束时一次性应用
    const rebuildShadowKeys = new Set<string>(['shadowResolution', 'shadowType', 'shadowEnabled']);

    // P4-fix: 取消任何在途过渡，避免重复调用堆叠多个渲染循环 observer（并发打架、旧动画覆盖新值）
    if (lightingState.activeTransitionObs) {
        lightingState.activeTransitionObs.dispose();
        lightingState.activeTransitionObs = null;
    }

    const animLoop = () => {
        // 防御：场景/主光已被销毁（disposeLighting 已清理）则立即退出并移除 observer，避免对已释放对象操作
        if (!lightingState.scene || !lightingState.hemiLight || !lightingState.dirLight) {
            lightingState.activeTransitionObs?.dispose();
            lightingState.activeTransitionObs = null;
            return;
        }
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1.0);
        const lerp = (a: number, b: number) => a + (b - a) * t;

        const interpState: Partial<LightState> = {};
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
            // 动画结束，移除自身 observer
            lightingState.activeTransitionObs?.dispose();
            lightingState.activeTransitionObs = null;
            if (onComplete) {
                onComplete();
            }
        }
    };

    // 注册到渲染循环，每帧驱动插值
    lightingState.activeTransitionObs = observe(
        lightingState.scene.onBeforeRenderObservable,
        animLoop
    );
}

/** 整体清理光照模块（场景销毁时调用） */
export function disposeLighting(): void {
    _cancelAllLightingTweens();
    // P1-fix: 预设动画中途销毁场景时，被取消的 tween 不会触发 onTweenDone，
    // 必须显式重置标志，否则重新初始化后自动保存永久失效。
    lightingState.skipLightAutoSave = false;
    // 清理舞台灯（含各自的指示器/阴影/光锥）
    for (const [lid, entry] of lightingState.stageLights) {
        _disposeStageLightEntry(lid, entry);
    }
    lightingState.stageLights.clear();
    lightingState.stageShadows.clear();
    lightingState.stageCones.clear();
    if (lightingState.coneUpdateHandle) {
        lightingState.coneUpdateHandle.dispose();
        lightingState.coneUpdateHandle = null;
    }
    // [doc:adr-168] 释放个人灯 tick observer + 所有个人灯
    if (lightingState.personalLightTickHandle) {
        lightingState.personalLightTickHandle.dispose();
        lightingState.personalLightTickHandle = null;
    }
    disposeAllPersonalLights();
    // P4-fix: 释放在途主光过渡 observer，避免场景销毁后其仍挂在旧 scene 的渲染循环上
    if (lightingState.activeTransitionObs) {
        lightingState.activeTransitionObs.dispose();
        lightingState.activeTransitionObs = null;
    }
    lightingState.stageLightCounter = 0;
    lightingState.activeStageLightId = null;
    // 清理主灯光
    lightingState.hemiLight = safeDispose(lightingState.hemiLight);
    lightingState.dirLight = safeDispose(lightingState.dirLight);
    // 清理太阳盘（含材质释放，避免 StandardMaterial 泄漏）
    _disposeSunDisc();
    // 清理场景灯光的阴影生成器
    if (lightingState.envSysShadow?.generator) {
        lightingState.envSysShadow.generator = safeDispose(lightingState.envSysShadow.generator);
    }
    lightingState.scene = null;
    lightingState.triggerAutoSave = null;
    // 补全阴影参数重置：避免场景重建后携带上一场景的脏值
    lightingState.shadowEnabled = false;
    lightingState.shadowType = 'soft';
    lightingState.shadowCascades = 2;
    lightingState.shadowResolution = 1024;
    lightingState.shadowBias = 0.0001;
    lightingState.skipLightAutoSave = false;
}

// ======== barrel: 子文件公开 API 透传 ========

export * from './lighting-stage';
export * from './lighting-shadow';
export * from './lighting-sun';
export * from './lighting-tween';
export * from './lighting-follow';
