import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';

import { EnvState, envState } from '@/core/config';
import { _envSys, getScene, effectiveGroundSize } from './_shared/env-context';
import { causticsController } from './env-caustics';
import { registerEnvCallback, registerEnvDtTickCallback } from './_bridge/env-dispatcher';
import { logWarn } from '@/core/logger';

// ADR-239: FX 子系统（涟漪/地面涟漪/LOD/水下/波方向）已拆分至 env-water-fx.ts，
// 宿主经此转发保持对外导出面不变（调用方零改动）。
export * from './env-water-fx';
// 文件内使用需显式 import（export * 仅对文件外生效）
import {
    _applyWaterLOD,
    clearRipples,
    disposeGroundRipples,
    getWaterLODMeshes,
    resetUnderwaterFlags,
    resetWaterLODState,
    setWaterLODMeshes,
} from './env-water-fx';

// ADR-239: 平面反射已拆分至 env-water-reflect.ts（叶子模块，经 _envSys 与材质间接通信）。
export * from './env-water-reflect';
import { _setupMirrorRT, waterReflection } from './env-water-reflect';

// ADR-239: 材质/着色器与预设已拆分至 env-water-material.ts。
export * from './env-water-material';
import {
    _WATER_KEYS,
    _createWaterMaterial,
    _rebuildWaterMaterial,
    _syncWaterUniforms,
    _waterUpdateCallback,
    disposeDetailNormalTexture,
    resetWaterPhaseState,
    setWaterWaveSpeed,
} from './env-water-material';

// ======== 常量定义 ========
const WATER_BASE_SIZE = 60; // 水面基准尺寸（世界单位），通过缩放调整最终大小

// ======== 生命周期编排（ADR-239）========
let _waterUpdateObserver: ObserverHandle | null = null;
let _waterScene: Scene | null = null;

/** 更新水面网格的位置和缩放（非破坏性）。所有 LOD 层同步变换。 */
function _updateWaterMesh(state: EnvState): void {
    const scale = Math.max(
        1,
        effectiveGroundSize(state.groundSize, state.groundInfiniteEnabled ?? false) /
            WATER_BASE_SIZE
    );
    const rotX = state.waterFlipEnabled ? Math.PI : 0;
    const meshes: Mesh[] = [];
    if (_envSys.water.mesh) {
        meshes.push(_envSys.water.mesh);
    }
    meshes.push(...getWaterLODMeshes());
    for (const m of meshes) {
        m.position.y = state.waterLevel;
        m.scaling = new Vector3(scale, 1, scale);
        m.rotation.x = rotX;
    }
}

/**
 * 按相机到水面的距离选择 LOD 层级（纯函数，便于单测）。
 * 0=近景高精度, 1=中景, 2=远景低精度。
 */
export function createWater(state: EnvState): void {
    // 惰性路径：已初始化 → 只同步参数
    if (state.waterEnabled && _envSys.water.material && _envSys.water.mesh) {
        const scene = getScene();
        // P1 修复：reflectionQuality 跨 off↔非 off 时材质 define 需切换，强制重建
        const needReflect = state.reflectionQuality !== 'off';
        const hasReflect = !!_envSys.water.material.options.defines?.includes('PLANAR_REFLECTION');
        if (needReflect !== hasReflect) {
            _rebuildWaterMaterial(scene, state);
        }
        _syncWaterUniforms(state, scene);
        _updateWaterMesh(state);
        _setupMirrorRT(scene, state);
        _applyWaterLOD(scene);
        return;
    }

    if (!state.waterEnabled) {
        disposeWater();
        return;
    }

    // 首次创建
    const scene = getScene();
    if (!scene) {
        logWarn('env-water', 'createWater: scene not ready');
        return;
    }

    const scale = Math.max(
        1,
        effectiveGroundSize(state.groundSize, state.groundInfiniteEnabled ?? false) /
            WATER_BASE_SIZE
    );
    const rotX = state.waterFlipEnabled ? Math.PI : 0;
    const makeGround = (name: string, subdivisions: number): Mesh => {
        const m = MeshBuilder.CreateGround(
            name,
            { width: WATER_BASE_SIZE, height: WATER_BASE_SIZE, subdivisions },
            scene
        );
        m.isPickable = false;
        m.position.y = state.waterLevel;
        m.scaling = new Vector3(scale, 1, scale);
        m.rotation.x = rotX;
        return m;
    };

    const meshHigh = makeGround('envWater', 48);
    const meshMid = makeGround('envWater_LOD1', 16);
    const meshLow = makeGround('envWater_LOD2', 6);
    meshMid.setEnabled(false);
    meshLow.setEnabled(false);
    setWaterLODMeshes([meshMid, meshLow]);

    const mat = _createWaterMaterial(scene, state);
    meshHigh.material = mat;
    meshMid.material = mat;
    meshLow.material = mat;
    _envSys.water.mesh = meshHigh;
    _envSys.water.material = mat;

    _syncWaterUniforms(state, scene);
    _setupMirrorRT(scene, state);
    _applyWaterLOD(scene);

    if (!_waterUpdateObserver) {
        _waterScene = scene;
        _waterUpdateObserver = observe(scene.onBeforeRenderObservable, () =>
            _waterUpdateCallback(scene)
        );
    }
}

export function disposeWater(): void {
    // [fix] 先解绑所有 mesh 的材质引用，防止 mesh.dispose() 级联销毁
    // 共享 ShaderMaterial 导致其他仍存活 mesh 引用已销毁材质（_effect=null），
    // 下一帧 GroundMesh.render() → ShaderMaterial.isReady() → 💥
    if (_envSys.water.mesh) {
        _envSys.water.mesh.material = null;
    }
    for (const lod of getWaterLODMeshes()) {
        lod.material = null;
    }
    // 先释放材质，确保 _effect 被正确清理
    _envSys.water.material = safeDispose(_envSys.water.material);
    // LOD 网格为兄弟根网格（非父子），需显式销毁（材质已解绑，dispose 不再级联）
    for (const lod of getWaterLODMeshes()) {
        lod.dispose(false, false); // doNotRecurse=false, disposeMaterialAndTextures=false
    }
    _envSys.water.mesh = safeDispose(_envSys.water.mesh, false, false); // doNotRecurse=false, disposeMaterialAndTextures=false
    resetWaterLODState();
    resetWaterPhaseState();
    clearRipples(); // 清理残留涟漪，避免 dispose 后再次 createWater 时显示旧数据
    disposeGroundRipples(); // 释放地面涟漪 DynamicTexture（256×256）+ 状态，防止 GPU 泄漏
    // 焦散纹理由 env-caustics controller 集中管理，env-impl dispose 时统一释放
    // ADR-115 P1: 释放法线细节纹理
    disposeDetailNormalTexture();
    if (_waterUpdateObserver) {
        // 使用注册时捕获的 scene 引用摘除，避免 getScene() 在 scene 已 dispose 时返回 null 导致漏删
        if (_waterScene) {
            _waterUpdateObserver = safeDispose(_waterUpdateObserver);
        }
        _waterUpdateObserver = null;
        _waterScene = null;
    }
    resetUnderwaterFlags();
    // 清理平面反射（委托引擎：释放 RT、镜像相机、移出 customRenderTargets、清材质引用）
    waterReflection.dispose();
}

/**
 * 刷新水面渲染列表（钩子函数）
 * 当前为空实现，保留作为API接口，未来可能用于：
 * - 更新水的渲染顺序
 * - 响应场景图形变更（如新增/移除需要水面反射的对象）
 * - 同步水的渲染状态
 * 当前水系统通过ShaderMaterial和场景渲染自动处理，无需手动刷新
 */
export function refreshWaterRenderList(): void {}

// ======== Water Animation Speed ========
export function updateWaterAnimSpeed(speed: number): void {
    // 只更新累加速率：相位由每帧 observer 累加，改波速不会造成相位跳变
    // 不直接操作材质 uniform（由 _syncWaterUniforms / 每帧 observer 统一同步），
    // 避免与 setEnvState → _syncWaterUniforms 重复写入 _waterWaveSpeed。
    setWaterWaveSpeed(speed);
}

// ======== Underwater Transition (called by Env Update Observer) ========
// ======== Water Presets (migrated from env-lighting.ts) =======


registerEnvCallback((changed, state) => {
    if (!changed || [...changed].some((k) => _WATER_KEYS.includes(k))) {
        if (state.waterEnabled) {
            createWater(state);
        } else {
            disposeWater();
        }
    }
});

// 焦散 UV 滚动由 controller 集中维护（共享给水面 + 水底地面）。
// 速度按用户可调参数 causticScrollX/Y 推（缩放 0.5 避免过快），经纹理 uOffset/vOffset 每帧累加；
// water frag 通过 uCausticOffset 读取该偏移，故水面焦散与用户滑块联动，且与水底地面共享同一节奏。
let _causticsLastConfig: { sx: number; sy: number } = { sx: NaN, sy: NaN };

/** [fix code_review P2] 复位焦散 config diff guard 内存：dispose 后 causticsController
 *  config 回 DEFAULT_CONFIG，若此处不把 _causticsLastConfig 复位为 NaN，下次 dt tick
 *  的 diff 守卫（envState.causticScrollX !== NaN 恒真）不再触发 setConfig → 用户配置
 *  丢失且 scrollY 停在 DEFAULT（与 envState 派生值不匹配）。env-impl dispose 时调用。 */
export function resetCausticsSyncGuard(): void {
    _causticsLastConfig = { sx: NaN, sy: NaN };
}

registerEnvDtTickCallback((_dt) => {
    if (
        envState.causticScrollX !== _causticsLastConfig.sx ||
        envState.causticScrollY !== _causticsLastConfig.sy
    ) {
        // 速度比缩放到 (0..0.5) 区间（避免过快）
        causticsController.setConfig({
            scrollX: envState.causticScrollX * 0.5,
            scrollY: envState.causticScrollY * 0.5,
        });
        _causticsLastConfig = { sx: envState.causticScrollX, sy: envState.causticScrollY };
    }
    // UV 推进（每秒累加）
    causticsController.update(_dt);
});
