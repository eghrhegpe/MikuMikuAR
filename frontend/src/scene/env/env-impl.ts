// scene-env-impl.ts — Environment System Implementation (Phase 8)
// All functions use module-level _scene / _pipeline injected by scene.ts
// Import this file via scene-env.ts (Facade), never import directly.

import {
    Scene,
    Color3,
    Color4,
    Texture,
    BaseTexture,
    DynamicTexture,
    StandardMaterial,
    GPUParticleSystem,
    Observer,
    ShadowGenerator,
    CubeTexture,
    Constants,
    DefaultRenderingPipeline,
    Mesh,
    MeshBuilder,
    GroundMesh,
    ShaderMaterial,
    RenderTargetTexture,
    FreeCamera,
    Plane,
    Matrix,
    Vector3,
} from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';
import { EnvState, envState } from '@/core/config';
import { createHeightmapGround, applyTerrainMaterial } from './env-terrain';
import { disableWaterReflection } from './env-water';

// ======== Static Asset URL Resolver (Android 安全) ========
/** 将相对路径转为绝对 URL，确保 Android WebView 能正确加载嵌入资源。
 *  相对路径（如 'textures/grass.png'）在 Android 可能因 base URL 不同而 404。 */
function resolveStaticAsset(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path; // 已经是绝对 URL 或 data URL，原样返回
    }
    // 相对路径 → 绝对 URL（基于当前页面 origin）
    return new URL(path, window.location.origin).href;
}

// ======== Scene Tick Callback Registry (统一 scene observer) ========
/** 统一管理所有 scene.onBeforeRenderObservable 回调。
 *  避免多个模块各自添加 observer，导致重复 tick 或竞态。 */
const _sceneTickCallbacks = new Set<() => void>();

/** 注册一个每帧回调（回调会在 env observer 中被调用）。
 *  @returns 取消注册函数 */
export function registerSceneTickCallback(cb: () => void): () => void {
    _sceneTickCallbacks.add(cb);
    return () => _sceneTickCallbacks.delete(cb);
}

// ======== Injected dependencies (set by scene.ts on init) ========
let _scene: Scene | null = null;
let _pipeline: DefaultRenderingPipeline | null = null;

export function initEnvImpl(scene: Scene, pipeline: DefaultRenderingPipeline): void {
    _scene = scene;
    _pipeline = pipeline;
}

export function getScene(): Scene {
    if (!_scene) {
        throw new Error('[scene-env-impl] Scene not initialized');
    }
    return _scene;
}

export function getPipeline(): DefaultRenderingPipeline {
    if (!_pipeline) {
        throw new Error('[scene-env-impl] Pipeline not initialized');
    }
    return _pipeline;
}

// ======== Module-level state ========
interface EnvSkyResources {
    skyMesh: Mesh | null;
    skyCubeTexture: BaseTexture | null;
    skyDynamicTex: DynamicTexture | null;
}

export {
    createWater,
    disposeWater,
    refreshWaterRenderList,
    addRipple,
    clearRipples,
    updateWaterAnimSpeed,
    _underwaterActive,
    _underwaterSavedFog,
    _underwaterTransitionProgress,
    _underwaterTarget,
} from './env-water';
export { createClouds, disposeClouds } from './env-clouds';
import {
    createParticleEmitter,
    disposeParticles,
    applyWindToParticles,
    updateParticleWind,
    updateParticleParams,
    updateParticleTexture,
    syncSplashState,
    disposeSplash,
    getCurrentParticleType,
} from './env-particles';
import { _disposeSunDisc } from '../render/lighting';
import { updateUnderwaterTransition, resetUnderwaterState } from './env-water';

export {
    createParticleEmitter,
    disposeParticles,
    applyWindToParticles,
    updateParticleWind,
    updateParticleTexture,
};

export const _envSys: {
    sky: EnvSkyResources;
    ground: { mesh: Mesh | null };
    particles: { system: GPUParticleSystem | null; followObserver: Observer<Scene> | null };
    splash: { observer: Observer<Scene> | null };
    clouds: {
        postProcess: Mesh | null;
        postProcess2: Mesh | null;
        material: StandardMaterial | null;
        texture: Texture | null;
    };
    water: { mesh: Mesh | null; material: ShaderMaterial | null };
    shadow: { generator: ShadowGenerator | null };
} = {
    sky: { skyMesh: null, skyCubeTexture: null, skyDynamicTex: null },
    ground: { mesh: null },
    particles: { system: null, followObserver: null },
    splash: { observer: null },
    clouds: { postProcess: null, postProcess2: null, material: null, texture: null },
    water: { mesh: null, material: null },
    shadow: { generator: null },
};

/** Cache key for procedural gradient: skip rebuild when unchanged */
let _lastProceduralSkyKey = '';

// ======== Sky ========
export function disposeSky(): void {
    const scene = getScene();
    if (_envSys.sky.skyMesh) {
        _envSys.sky.skyMesh.dispose();
        _envSys.sky.skyMesh = null;
    }
    if (_envSys.sky.skyCubeTexture) {
        scene.environmentTexture = null;
        _envSys.sky.skyCubeTexture.dispose();
        _envSys.sky.skyCubeTexture = null;
    }
    if (_envSys.sky.skyDynamicTex) {
        _envSys.sky.skyDynamicTex.dispose();
        _envSys.sky.skyDynamicTex = null;
    }
    _lastProceduralSkyKey = '';
    disposeSunDisc();
}

function disposeSunDisc(): void {
    _disposeSunDisc();
}

/** 天空渐变 canvas 尺寸 */
const SKY_TEX_SIZE = 256;

/** 绘制天空渐变到已有 canvas 上下文（不创建 Texture，供 DynamicTexture 复用） */
function drawSkyGradient(
    ctx: CanvasRenderingContext2D,
    top: Color3,
    mid: Color3,
    bot: Color3,
    brightness: number,
    sunAngle: number,
    starsEnabled: boolean
): void {
    const W = SKY_TEX_SIZE,
        H = SKY_TEX_SIZE;
    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const scale = (c: Color3) =>
        `rgb(${(c.r * brightness * 255) | 0},${(c.g * brightness * 255) | 0},${(c.b * brightness * 255) | 0})`;
    grad.addColorStop(0, scale(bot));
    grad.addColorStop(0.35, scale(bot));
    grad.addColorStop(0.5, scale(mid));
    grad.addColorStop(0.65, scale(top));
    grad.addColorStop(1, scale(top));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (starsEnabled) {
        const starAlpha = sunAngle > 10 ? 0 : sunAngle < -5 ? 1 : (10 - sunAngle) / 15;
        if (starAlpha > 0.01) {
            const starSeed = 12345;
            const hash = (i: number) => {
                let h = (i * 2654435761 + starSeed) | 0;
                h ^= h >>> 13;
                return (h & 0x7fffffff) / 0x7fffffff;
            };
            const starCount = Math.round(200 + starAlpha * 100);
            for (let i = 0; i < starCount; i++) {
                const sx = hash(i * 3) * W;
                const sy = hash(i * 3 + 1) * H * 0.55;
                const sr = 0.5 + hash(i * 3 + 2) * 2.0;
                const sa = starAlpha * (0.3 + hash(i + 1000) * 0.7);
                const twinkle = 0.7 + hash(i + 2000) * 0.3;
                const r = (220 + hash(i + 3000) * 35) | 0;
                const g = (210 + hash(i + 4000) * 45) | 0;
                const b = (200 + hash(i + 5000) * 55) | 0;
                ctx.fillStyle = `rgba(${r},${g},${b},${(sa * twinkle).toFixed(2)})`;
                ctx.beginPath();
                ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

/** 创建或复用 DynamicTexture 并重绘天空渐变 */
function updateSkyDynamicTexture(state: EnvState): DynamicTexture {
    const scene = getScene();
    let tex = _envSys.sky.skyDynamicTex;
    if (!tex) {
        tex = new DynamicTexture(
            'skyGradient',
            { width: SKY_TEX_SIZE, height: SKY_TEX_SIZE },
            scene,
            false
        );
        tex.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        tex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        tex.hasAlpha = false;
        _envSys.sky.skyDynamicTex = tex;
    }
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    drawSkyGradient(
        ctx,
        new Color3(state.skyColorTop[0], state.skyColorTop[1], state.skyColorTop[2]),
        new Color3(state.skyColorMid[0], state.skyColorMid[1], state.skyColorMid[2]),
        new Color3(state.skyColorBot[0], state.skyColorBot[1], state.skyColorBot[2]),
        state.skyBrightness,
        state.sunAngle,
        state.starsEnabled
    );
    tex.update();
    return tex;
}

function createProceduralSky(state: EnvState): void {
    const scene = getScene();
    const sphere = MeshBuilder.CreateSphere(
        'envSkySphere',
        {
            diameter: 1000,
            segments: 24,
            sideOrientation: Mesh.BACKSIDE,
        },
        scene
    );
    sphere.isPickable = false;

    const mat = new StandardMaterial('envSkyMat', scene);
    mat.emissiveTexture = updateSkyDynamicTexture(state);
    mat.disableLighting = true;
    mat.backFaceCulling = false;

    sphere.material = mat;
    _envSys.sky.skyMesh = sphere;
    scene.clearColor = new Color4(0, 0, 0, 1);
    _lastProceduralSkyKey = `${state.skyColorTop}|${state.skyColorMid}|${state.skyColorBot}|${state.skyBrightness}|${state.starsEnabled}`;
}

function loadSkyCube(path: string, rotationY: number, intensity: number): void {
    const scene = getScene();
    const ext = path.split('.').pop().toLowerCase();
    const supported = ['hdr', 'dds', 'exr'];
    if (!supported.includes(ext ?? '')) {
        console.warn(`[sky] unsupported format .${ext}, falling back to procedural`);
        disposeSky();
        createProceduralSky(envState);
        return;
    }

    const cubeTex = new CubeTexture(
        path,
        scene,
        null, // extensionsOrOptions
        false, // noMipmap
        null, // files
        null, // onLoad
        (message?: string, exception?: any) => {
            // Texture load failed — fall back to procedural sky (Fix E)
            console.warn(`[sky] loadSkyCube failed: ${message}`, exception);
            disposeSky();
            createProceduralSky(envState);
        }
    );
    cubeTex.rotationY = rotationY;
    scene.environmentTexture = cubeTex;
    scene.environmentIntensity = intensity;
    scene.clearColor = new Color4(0, 0, 0, 1);
    _envSys.sky.skyCubeTexture = cubeTex;

    const sphere = MeshBuilder.CreateSphere(
        'envSkyDome',
        {
            diameter: 1000,
            segments: 24,
            sideOrientation: Mesh.BACKSIDE,
        },
        scene
    );
    sphere.isPickable = false;
    const mat = new StandardMaterial('envSkyDomeMat', scene);
    mat.reflectionTexture = cubeTex;
    mat.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    sphere.material = mat;
    _envSys.sky.skyMesh = sphere;
}

export function applySky(state: EnvState): void {
    const scene = getScene();
    if (state.skyMode === 'color') {
        disposeSky();
        scene.clearColor = new Color4(
            state.skyColorTop[0],
            state.skyColorTop[1],
            state.skyColorTop[2],
            1
        );
        return;
    }

    const mesh = _envSys.sky.skyMesh;

    if (state.skyMode === 'procedural') {
        // Guard: mesh or material may be null after dispose/recreate
        if (!mesh || !mesh.material) {
            disposeSky();
            createProceduralSky(state);
            return;
        }
        if (mesh.material && mesh.material.getClassName() === 'StandardMaterial') {
            const mat = mesh.material as StandardMaterial;

            // Early-out: skip rebuild when gradient inputs haven't changed (Fix J)
            // sunAngle 不参与 key：它只影响星星 alpha，time-of-day 流转时 sunAngle 每 0.4° 变化
            // 若纳入 key 会导致纹理缓存持续失效 → 每帧 dispose+重建。星星 alpha 退化由下次颜色变化时重建补偿。
            const skyKey = `${state.skyColorTop}|${state.skyColorMid}|${state.skyColorBot}|${state.skyBrightness}|${state.starsEnabled}`;
            if (skyKey === _lastProceduralSkyKey && _envSys.sky.skyDynamicTex) {
                return;
            }
            _lastProceduralSkyKey = skyKey;

            // Clean up CubeTexture / reflectionTexture when transitioning texture→procedural
            // Prevents A) visual corruption from dual reflection+emissive, and H) stale scene.environmentTexture
            if (_envSys.sky.skyCubeTexture || mat.reflectionTexture) {
                if (_envSys.sky.skyCubeTexture) {
                    scene.environmentTexture = null;
                    _envSys.sky.skyCubeTexture.dispose();
                    _envSys.sky.skyCubeTexture = null;
                }
                mat.reflectionTexture = null;
            }

            // 复用 DynamicTexture：重绘 canvas + update()，不 dispose/新建
            // 消除 toDataURL PNG 编码瓶颈（预设动画 40 次重建从 ~4s 阻塞 → ~280ms）
            mat.emissiveTexture = updateSkyDynamicTexture(state);
            return;
        }
        disposeSky();
        createProceduralSky(state);
        return;
    }

    disposeSky();
    if (state.skyTexture) {
        loadSkyCube(state.skyTexture, state.skyRotationY, state.envIntensity);
    }
}

// ======== Ground ========
let _currentGroundKey: string = '';
/** 地形（heightmap）就绪后回调，供 model-loader 重新贴地所有模型。 */
let _onTerrainReady: (() => void) | null = null;
/** 纹理滚动累计偏移量（每帧由 observer 累加，取模 1.0）。 */
let _groundScrollU = 0;
let _groundScrollV = 0;

// === Phase B: 地面镜面反射 RT（复用 ADR-062 水面反射模式）===
let _groundMirrorRT: RenderTargetTexture | null = null;
let _groundMirrorCam: FreeCamera | null = null;
let _groundMirrorFrameCount = 0;
// 反射渲染时保存材质原始 backFaceCulling 值，渲染后恢复（避免强制覆盖双面材质）
let _groundMirrorOrigBFC: Map<number, boolean> = new Map();
const RT_REFRESH_ONCE = (RenderTargetTexture as unknown as { REFRESHRATE_RENDER_ONCE?: number })
    .REFRESHRATE_RENDER_ONCE ?? 0;

function applyProceduralGround(ground: Mesh, state: EnvState): void {
    const scene = getScene();
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const tileSize = Math.max(4, Math.round(16 * state.groundGridSize));

    const c0 = `rgb(${Math.round(state.groundColor[0] * 255)},${Math.round(state.groundColor[1] * 255)},${Math.round(state.groundColor[2] * 255)})`;
    const c1 = `rgb(${Math.round(state.groundLineColor[0] * 255)},${Math.round(state.groundLineColor[1] * 255)},${Math.round(state.groundLineColor[2] * 255)})`;

    switch (state.groundPattern) {
        case 'checker':
            for (let y = 0; y < 128; y += tileSize) {
                for (let x = 0; x < 128; x += tileSize) {
                    const isWhite = (x / tileSize + y / tileSize) % 2 === 0;
                    ctx.fillStyle = isWhite ? c0 : c1;
                    ctx.fillRect(x, y, tileSize, tileSize);
                }
            }
            break;
        case 'dots':
            ctx.fillStyle = c0;
            ctx.fillRect(0, 0, 128, 128);
            ctx.fillStyle = c1;
            for (let y = 0; y < 128; y += tileSize) {
                for (let x = 0; x < 128; x += tileSize) {
                    ctx.beginPath();
                    ctx.arc(x + tileSize / 2, y + tileSize / 2, tileSize / 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            break;
        case 'stripes':
            for (let x = 0; x < 128; x += tileSize) {
                const isEven = (x / tileSize) % 2 === 0;
                ctx.fillStyle = isEven ? c0 : c1;
                ctx.fillRect(x, 0, tileSize, 128);
            }
            break;
        case 'radial': {
            const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
            grad.addColorStop(0, c0);
            grad.addColorStop(1, c1);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 128, 128);
            break;
        }
    }

    const tex = new Texture(canvas.toDataURL(), scene);
    const mat = new StandardMaterial('envGroundChecker', scene);
    mat.diffuseTexture = tex;
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.alpha = state.groundAlpha;
    mat.backFaceCulling = false;
    ground.material = mat;
}

/**
 * 查询某世界坐标 (x, z) 处的地面高度，用于把模型贴合到地面上。
 * - heightmap 模式：返回地形网格 getHeightAtCoordinates（真实起伏，world 坐标入参）。
 * - 其他模式：返回 groundLevel（平面参考高度）。
 * 地形尚未加载完成时回退到 groundLevel，避免模型被错误地放到 0。
 */
export function getGroundHeightAt(x: number, z: number): number {
    const m = _envSys.ground.mesh;
    if (m && typeof (m as GroundMesh).getHeightAtCoordinates === 'function' && m.isReady()) {
        try {
            return (m as GroundMesh).getHeightAtCoordinates(x, z);
        } catch (e) {
            console.warn('[terrain] getGroundHeightAt failed', e);
            return envState.groundLevel;
        }
    }
    return envState.groundLevel;
}

/** 注册地形就绪回调（由 model-loader 调用，用于在高度图加载完成后重新贴地所有模型）。 */
export function setOnTerrainReady(cb: (() => void) | null): void {
    _onTerrainReady = cb;
}

// ======== 地面边缘淡出（径向不透明度贴图）========
// 生成「中心白→边缘黑」的径向渐变，作为 opacityTexture 挂到各模式材质上，
// 使地面边缘柔和淡出而非硬方块边。fade<=0 时返回 null（保持原硬边行为）。
// 按 fade 量化值缓存，避免拖动滑块时反复生成 canvas。
const _edgeFadeTexCache = new Map<number, Texture>();

function getGroundEdgeFadeTexture(fade: number, scene: Scene): Texture | null {
    if (fade <= 0) return null;
    const key = Math.round(fade * 100);
    const cached = _edgeFadeTexCache.get(key);
    if (cached) return cached;
    const S = 256;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // r0：保持完全不透明的内部半径占比（0..1）。fade 越大，r0 越小，淡出越广。
    const r0 = Math.max(0, 1 - fade);
    const grad = ctx.createRadialGradient(S / 2, S / 2, r0 * (S / 2), S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    const tex = new Texture(canvas.toDataURL(), scene);
    tex.getAlphaFromRGB = true; // 用亮度（白=不透明，黑=透明）驱动不透明度
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.name = 'envGroundEdgeFade';
    _edgeFadeTexCache.set(key, tex);
    return tex;
}

function applyGroundEdgeFade(
    mat: StandardMaterial | GridMaterial,
    fade: number,
    scene: Scene
): void {
    mat.opacityTexture = getGroundEdgeFadeTexture(fade, scene);
}

/**
 * 同步地面纹理的 uOffset/vOffset。
 * 组合「纹理旋转基准偏移 + 滚动累计偏移」，两者叠加后取模 1.0。
 * 仅适用于有 diffuseTexture 的 StandardMaterial（checker/texture 模式）。
 */
function _syncGroundTextureOffset(mat: StandardMaterial, state: EnvState): void {
    const tex = mat.diffuseTexture as Texture | null;
    if (!tex) return;
    const angle = (state.groundTextureRotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const baseU = 0.5 * (1 - cos) + 0.5 * sin;
    const baseV = 0.5 * (1 - cos) - 0.5 * sin;
    let u = baseU + _groundScrollU;
    let v = baseV + _groundScrollV;
    u = u - Math.floor(u);
    v = v - Math.floor(v);
    if (u < 0) u += 1;
    if (v < 0) v += 1;
    tex.uOffset = u;
    tex.vOffset = v;
}

/**
 * 同步地面法线贴图（bumpTexture）。
 * 仅 texture 模式且指定了法线路径时挂载；否则移除。
 */
function _syncGroundNormalTexture(mat: StandardMaterial, state: EnvState): void {
    const scene = getScene();
    if (state.groundNormalTexture) {
        if (!mat.bumpTexture || (mat.bumpTexture as Texture).name !== state.groundNormalTexture) {
            mat.bumpTexture = new Texture(resolveStaticAsset(state.groundNormalTexture), scene);
        }
        mat.bumpTexture.level = state.groundNormalStrength;
    } else {
        if (mat.bumpTexture) {
            mat.bumpTexture.dispose();
            mat.bumpTexture = null;
        }
    }
}

// ══════════════════════════════════════════════════════════════
// Phase B: 地面镜面反射（复用 ADR-062 水面反射模式）
// ══════════════════════════════════════════════════════════════

/** 创建地面反射 RT。 */
function _createGroundMirrorRT(scene: Scene, resolution: number): RenderTargetTexture {
    const rt = new RenderTargetTexture(
        'groundReflectionRT',
        resolution,
        scene,
        false // generateMipMaps
    );
    rt.clearColor = new Color4(0, 0, 0, 0);
    rt.refreshRate = RT_REFRESH_ONCE;
    return rt;
}

/** 创建反射镜像相机。 */
function _createGroundMirrorCam(scene: Scene): FreeCamera {
    const cam = new FreeCamera('_groundMirrorCam', Vector3.Zero(), scene);
    cam.minZ = 0.5;
    cam.maxZ = 200;
    cam.rotation.x = -Math.PI / 2; // 朝上反射
    return cam;
}

/** 更新镜像相机位置（基于主相机关于地面平面的反射）。 */
function _updateGroundMirrorCamera(scene: Scene, groundLevel: number): void {
    const cam = scene.activeCamera;
    if (!_groundMirrorCam || !cam) return;
    const mirrorPlane = new Plane(0, 1, 0, -groundLevel);
    const reflMatrix = Matrix.Reflection(mirrorPlane);
    const camWorld = cam.getWorldMatrix();
    const mirrorWorld = camWorld.multiply(reflMatrix);
    // TransformNode.freezeWorldMatrix / setWorldMatrix 不在 Camera 继承链上
    // （FreeCamera → TargetCamera → Camera → Node，不经过 AbstractMesh），
    // 直接操作 Node 基类内部属性，等价于 TransformNode.freezeWorldMatrix(matrix)
    (_groundMirrorCam as any)._worldMatrix = mirrorWorld;
    (_groundMirrorCam as any)._isWorldMatrixFrozen = true;
    if ('fov' in cam) {
        _groundMirrorCam.fov = cam.fov;
    }
}

/** 填充地面反射 renderList：排除地面自身，排除地面以下几何。 */
function _populateGroundMirrorRenderList(
    scene: Scene,
    rt: RenderTargetTexture,
    groundLevel: number
): void {
    rt.renderList = [];
    for (const mesh of scene.meshes) {
        if (mesh.name === 'envGround' || mesh.name.startsWith('envGround')) {
            continue; // 排除地面自身
        }
        if (!mesh.isEnabled()) {
            continue;
        }
        // 排除地面以下的几何（模拟 clipPlane 效果）
        const bounds = mesh.getBoundingInfo().boundingBox;
        if (bounds.maximumWorld.y < groundLevel) {
            continue;
        }
        rt.renderList.push(mesh);
    }
}

/**
 * 构建地面镜面反射：创建 RT + 镜像相机 + 挂载到材质。
 * 若 groundReflectionQuality='off' 或 blend<=0，则销毁既有 RT。
 * 互斥守卫：启用地面反射时关闭水面反射。
 */
function buildGroundReflection(state: EnvState): void {
    const scene = getScene();
    const shouldEnable =
        state.groundReflectionQuality !== 'off' && state.groundReflectionBlend > 0;

    if (!shouldEnable) {
        disposeGroundReflection();
        return;
    }

    // 互斥守卫：关闭水面反射（调用水面模块完整 dispose，而非仅写状态变量）
    if (envState.planarReflectBlend > 0) {
        envState.planarReflectBlend = 0;
        disableWaterReflection();
    }

    // 创建或复用 RT
    if (!_groundMirrorRT) {
        const resolutionMap: Record<string, number> = { high: 1024, medium: 512, low: 256, off: 0 };
        const resolution = resolutionMap[state.groundReflectionQuality] ?? 256;
        _groundMirrorRT = _createGroundMirrorRT(scene, resolution);
        _groundMirrorCam = _createGroundMirrorCam(scene);
        _groundMirrorRT.activeCamera = _groundMirrorCam;

        _groundMirrorRT.onBeforeRenderObservable.add(() => {
            for (const mesh of _groundMirrorRT!.renderList ?? []) {
                if (mesh.material) {
                    _groundMirrorOrigBFC.set(mesh.material.uniqueId, mesh.material.backFaceCulling);
                    mesh.material.backFaceCulling = false;
                }
            }
        });
        _groundMirrorRT.onAfterRenderObservable.add(() => {
            for (const mesh of _groundMirrorRT!.renderList ?? []) {
                if (mesh.material && _groundMirrorOrigBFC.has(mesh.material.uniqueId)) {
                    mesh.material.backFaceCulling = _groundMirrorOrigBFC.get(mesh.material.uniqueId)!;
                }
            }
            _groundMirrorOrigBFC.clear();
        });

        _populateGroundMirrorRenderList(scene, _groundMirrorRT, state.groundLevel);
        scene.customRenderTargets.push(_groundMirrorRT);
    }

    // 挂载到地面材质
    const mat = _envSys.ground.mesh?.material;
    if (mat && mat instanceof StandardMaterial && _groundMirrorRT) {
        if (mat.reflectionTexture !== _groundMirrorRT) {
            mat.reflectionTexture = _groundMirrorRT;
        }
        // 用 alpha 混合反射强度
        mat.reflectionTexture.level = state.groundReflectionBlend;
    }
}

/** 销毁地面反射 RT（供 disposeEnv 调用）。 */
function disposeGroundReflection(): void {
    const scene = getScene();
    if (_groundMirrorRT) {
        scene.customRenderTargets = scene.customRenderTargets.filter(
            (t) => t !== _groundMirrorRT
        );
        _groundMirrorRT.dispose();
        _groundMirrorRT = null;
    }
    if (_groundMirrorCam) {
        _groundMirrorCam.dispose();
        _groundMirrorCam = null;
    }
    _groundMirrorFrameCount = 0;
    _groundMirrorOrigBFC.clear();
    // 清理材质上的反射纹理引用（避免悬空引用指向已 dispose 的 RT）
    const mat = _envSys.ground.mesh?.material;
    if (mat && mat instanceof StandardMaterial && mat.reflectionTexture) {
        mat.reflectionTexture = null;
    }
}

export function applyGround(state: EnvState): void {
    const scene = getScene();

    const typeKey =
        state.groundMode === 'heightmap'
            ? `heightmap:${state.groundTerrainHeight}:${state.groundTerrainScale}:${state.groundTerrainSeed}:${state.groundTerrainOctaves}:${state.groundLevel}:${state.groundSize}:${state.groundColor.join(',')}:${state.groundAlpha}:${state.groundTextureEnabled}:${state.groundTexture}:${state.groundTextureScale}:${state.groundTextureRotation}`
            : state.groundTextureEnabled && state.groundTexture
              ? `texture:${state.groundTexture}:${state.groundSize}:${state.groundReflectionQuality}`
              : state.groundMode === 'checker'
                ? `checker:${state.groundPattern}:${state.groundSize}:${state.groundReflectionQuality}`
                : `mode:${state.groundMode}:${state.groundSize}:${state.groundReflectionQuality}`;
    const keyChanged = typeKey !== _currentGroundKey;

    // 地面已存在、可见、类型未变 → 原地更新颜色/透明度/纹理缩放/旋转/坡度/法线/反射
    if (_envSys.ground.mesh && state.groundVisible && !keyChanged) {
        const mat = _envSys.ground.mesh.material;
        if (mat) {
            if (mat instanceof GridMaterial) {
                mat.mainColor = new Color3(
                    state.groundColor[0],
                    state.groundColor[1],
                    state.groundColor[2]
                );
                mat.lineColor = new Color3(
                    state.groundLineColor[0],
                    state.groundLineColor[1],
                    state.groundLineColor[2]
                );
                mat.gridRatio = state.groundGridSize;
            } else if (mat instanceof StandardMaterial) {
                mat.diffuseColor = new Color3(
                    state.groundColor[0],
                    state.groundColor[1],
                    state.groundColor[2]
                );
                mat.alpha = state.groundAlpha;
                if (mat.diffuseTexture && mat.diffuseTexture instanceof Texture) {
                    (mat.diffuseTexture as Texture).uScale = (
                        mat.diffuseTexture as Texture
                    ).vScale = 1 / Math.max(0.1, state.groundTextureScale);
                    _syncGroundTextureOffset(mat, state);
                }
                // 法线贴图（Phase B）
                _syncGroundNormalTexture(mat, state);
                // 反射 blend 实时更新（不重建 RT）
                if (mat.reflectionTexture && _groundMirrorRT) {
                    mat.reflectionTexture.level = state.groundReflectionBlend;
                }
            }
            // 边缘淡出：随滑块实时更新 opacityTexture（fade<=0 时移除）
            applyGroundEdgeFade(mat as StandardMaterial | GridMaterial, state.groundEdgeFade, scene);
        }
        // 更新地面高度
        _envSys.ground.mesh.position.y = state.groundLevel;
        // 更新坡度（heightmap 模式禁用，保持 0）
        if (state.groundMode !== 'heightmap') {
            _envSys.ground.mesh.rotation.x = (state.groundPitch * Math.PI) / 180;
            _envSys.ground.mesh.rotation.z = (state.groundRoll * Math.PI) / 180;
        }
        // 反射 RT 重建（quality 变更时由 typeKey 触发，blend 变更走上面的原地更新）
        buildGroundReflection(state);
        return;
    }

    _currentGroundKey = typeKey;
    // 销毁旧地面反射 RT（Phase B）
    disposeGroundReflection();
    if (_envSys.ground.mesh) {
        _envSys.ground.mesh.dispose();
        _envSys.ground.mesh = null;
    }
    if (!state.groundVisible) {
        return;
    }

    // 地形模式：程序化 FBM 高度图 → 可拾取 GroundMesh（自带碰撞）。
    // onReady（图像异步加载完成后）才建材质并触发模型重贴地。
    if (state.groundMode === 'heightmap') {
        const hg = createHeightmapGround(state, scene, (gm) => {
            applyTerrainMaterial(gm, state, scene);
            applyGroundEdgeFade(gm.material as StandardMaterial, state.groundEdgeFade, scene);
            _onTerrainReady?.();
        });
        _envSys.ground.mesh = hg;
        return;
    }

    const ground = MeshBuilder.CreateGround(
        'envGround',
        {
            width: state.groundSize,
            height: state.groundSize,
            subdivisions: 2,
        },
        scene
    );
    ground.isPickable = false;
    ground.position.y = state.groundLevel;

    if (state.groundMode === 'grid') {
        const mat = new GridMaterial('envGroundMat', scene);
        mat.gridRatio = state.groundGridSize;
        mat.mainColor = new Color3(
            state.groundColor[0],
            state.groundColor[1],
            state.groundColor[2]
        );
        mat.lineColor = new Color3(
            state.groundLineColor[0],
            state.groundLineColor[1],
            state.groundLineColor[2]
        );
        mat.backFaceCulling = false;
        ground.material = mat;
    } else if (state.groundMode === 'checker') {
        applyProceduralGround(ground, state);
    } else if (state.groundTextureEnabled && state.groundTexture) {
        // 纹理地面：subdivisions 保持 2（性能），纹理重复由 uScale/vScale 控制
        const tex = new Texture(resolveStaticAsset(state.groundTexture), scene);
        tex.uScale = tex.vScale = 1 / Math.max(0.1, state.groundTextureScale);
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseTexture = tex;
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
        _syncGroundTextureOffset(mat, state);
        _syncGroundNormalTexture(mat, state); // 法线贴图（Phase B）
    } else {
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseColor = new Color3(
            state.groundColor[0],
            state.groundColor[1],
            state.groundColor[2]
        );
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    }

    // 边缘淡出（solid/grid/checker/texture 统一在创建后挂载）
    if (ground.material) {
        applyGroundEdgeFade(ground.material as StandardMaterial | GridMaterial, state.groundEdgeFade, scene);
    }

    // 坡度（heightmap 模式已提前 return，此处一定是非 heightmap 模式）
    ground.rotation.x = (state.groundPitch * Math.PI) / 180;
    ground.rotation.z = (state.groundRoll * Math.PI) / 180;

    // Phase B: 镜面反射（创建后挂载）
    buildGroundReflection(state);

    _envSys.ground.mesh = ground;
}

// ======== Env Update Observer (wind, sky rotation, underwater) ========
let _envUpdateObserver: Observer<Scene> | null = null;
let _prevParticleEnabled = true; // 用于检测 particleEnabled 变化
let _prevSplash = false; // 用于检测 particleSplash 变化
let _prevCustomTexture = ''; // 用于检测 particleCustomTexture 变化

export function ensureEnvUpdateObserver(): void {
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) {
        return;
    }
    _envUpdateObserver = scene.onBeforeRenderObservable.add(() => {
        // dt 以秒为单位，确保不同帧率下动画速度一致
        const dt = scene.deltaTime / 1000;
        // Cloud drift + camera follow
        if (envState.cloudsEnabled && _envSys.clouds.postProcess) {
            const cam = scene.activeCamera;
            const dx = envState.windEnabled
                ? envState.windDirection[0] * envState.windSpeed * 0.3 * dt
                : 0;
            const dz = envState.windEnabled
                ? envState.windDirection[2] * envState.windSpeed * 0.3 * dt
                : 0;
            for (const key of ['postProcess', 'postProcess2'] as const) {
                const m = _envSys.clouds[key];
                if (m) {
                    const speedMul = key === 'postProcess2' ? 0.7 : 1.0;
                    if (cam) {
                        m.position.x = cam.position.x;
                        m.position.z = cam.position.z;
                    }
                    const mat = m.material as StandardMaterial | null;
                    if (mat.diffuseTexture) {
                        const tex = mat.diffuseTexture as Texture;
                        // 对偏移取模 1.0，防止长时间运行后浮点精度退化
                        tex.uOffset = (tex.uOffset + dx * speedMul) % 1;
                        if (tex.uOffset < 0) {
                            tex.uOffset += 1;
                        }
                        tex.vOffset = (tex.vOffset + dz * speedMul) % 1;
                        if (tex.vOffset < 0) {
                            tex.vOffset += 1;
                        }
                    }
                }
            }
        }
        // 动态更新粒子风力（响应运行时参数变化）
        updateParticleWind();
        // 动态更新粒子参数（密度/大小/速度滑条）
        updateParticleParams();

        // 自动启停粒子系统（检测 particleEnabled 状态变化）
        if (_prevParticleEnabled !== envState.particleEnabled) {
            _prevParticleEnabled = envState.particleEnabled;
            if (!envState.particleEnabled && _envSys.particles.system) {
                disposeParticles();
                disposeSplash(); // 粒子关闭时也关闭溅射
            } else if (
                envState.particleEnabled &&
                !_envSys.particles.system &&
                getCurrentParticleType() !== 'none'
            ) {
                createParticleEmitter(getCurrentParticleType(), envState.windEnabled);
            }
        }

        // 同步溅射状态（检测 particleSplash 或粒子类型变化）
        if (_prevSplash !== envState.particleSplash) {
            _prevSplash = envState.particleSplash;
            syncSplashState();
        }

        // 自定义粒子纹理变化检测
        if (_prevCustomTexture !== envState.particleCustomTexture) {
            _prevCustomTexture = envState.particleCustomTexture ?? '';
            if (_envSys.particles.system) {
                updateParticleTexture();
            }
        }

        // Sky rotation animation
        if (envState.skyRotationSpeed > 0.001 && _envSys.sky.skyMesh) {
            _envSys.sky.skyMesh.rotation.y += envState.skyRotationSpeed * 0.6 * dt;
            if (_envSys.sky.skyMesh.rotation.y > Math.PI * 2) {
                _envSys.sky.skyMesh.rotation.y -= Math.PI * 2;
            } else if (_envSys.sky.skyMesh.rotation.y < -Math.PI * 2) {
                _envSys.sky.skyMesh.rotation.y += Math.PI * 2;
            }
        }

        // Ground texture scroll (checker / texture 模式)
        if (
            _envSys.ground.mesh &&
            (envState.groundScrollSpeedX !== 0 || envState.groundScrollSpeedZ !== 0) &&
            (envState.groundMode === 'checker' ||
                (envState.groundMode === 'texture' && envState.groundTextureEnabled && envState.groundTexture))
        ) {
            const mat = _envSys.ground.mesh.material;
            if (mat && mat instanceof StandardMaterial && mat.diffuseTexture) {
                _groundScrollU += envState.groundScrollSpeedX * dt;
                _groundScrollV += envState.groundScrollSpeedZ * dt;
                _groundScrollU = _groundScrollU - Math.floor(_groundScrollU);
                _groundScrollV = _groundScrollV - Math.floor(_groundScrollV);
                if (_groundScrollU < 0) _groundScrollU += 1;
                if (_groundScrollV < 0) _groundScrollV += 1;
                _syncGroundTextureOffset(mat, envState);
            }
        }

        // Phase B: 地面镜面反射渲染（分帧策略，复用水面反射模式）
        if (_groundMirrorRT && _groundMirrorCam) {
            _groundMirrorFrameCount++;
            const frameSkipMap: Record<string, number> = { high: 0, medium: 1, low: 3, off: 999 };
            const frameSkip = frameSkipMap[envState.groundReflectionQuality] ?? 999;
            if (_groundMirrorFrameCount % (frameSkip + 1) === 0) {
                _updateGroundMirrorCamera(scene, envState.groundLevel);
                _populateGroundMirrorRenderList(scene, _groundMirrorRT, envState.groundLevel);
                _groundMirrorRT.render();
            }
        }

        // Phase B: grid 模式跟随相机（每帧重定位到相机下方）
        if (_envSys.ground.mesh && envState.groundFollowCamera && envState.groundMode === 'grid') {
            const cam = scene.activeCamera;
            if (cam) {
                _envSys.ground.mesh.position.x = cam.position.x;
                _envSys.ground.mesh.position.y = envState.groundLevel;
                _envSys.ground.mesh.position.z = cam.position.z;
            }
        }

        // Water wave direction is embedded in Gerstner wave shader — no per-frame wind update needed
        // Underwater post-processing (delegated to water module)
        updateUnderwaterTransition(scene, pipeline);
        // Call all registered scene tick callbacks (e.g., time-of-day from bridge module)
        for (const cb of _sceneTickCallbacks) {
            cb();
        }
    });
}

export function disposeEnvUpdateObserver(): void {
    const scene = getScene();
    const pipeline = getPipeline();
    if (_envUpdateObserver) {
        scene.onBeforeRenderObservable.remove(_envUpdateObserver);
        _envUpdateObserver = null;
    }
    // 释放边缘淡出纹理缓存
    for (const tex of _edgeFadeTexCache.values()) {
        tex.dispose();
    }
    _edgeFadeTexCache.clear();
    disposeGroundReflection(); // Phase B: 清理地面反射 RT
    resetUnderwaterState(scene, pipeline);
}

// ======== Fog ========
export function applyFog(state: EnvState): void {
    const scene = getScene();
    if (state.fogEnabled) {
        const fogMode = state.fogMode || 'exp2';
        switch (fogMode) {
            case 'exp':
                scene.fogMode = Scene.FOGMODE_EXP;
                scene.fogDensity = state.fogDensity;
                break;
            case 'exp2':
                scene.fogMode = Scene.FOGMODE_EXP2;
                scene.fogDensity = state.fogDensity;
                break;
            case 'linear':
                scene.fogMode = Scene.FOGMODE_LINEAR;
                scene.fogStart = state.fogStart;
                scene.fogEnd = state.fogEnd;
                break;
            default:
                console.warn(`[env] unknown fogMode "${fogMode}", falling back to exp2`);
                scene.fogMode = Scene.FOGMODE_EXP2;
                scene.fogDensity = state.fogDensity;
                break;
        }
        scene.fogColor = new Color3(state.fogColor[0], state.fogColor[1], state.fogColor[2]);
    } else {
        scene.fogMode = Scene.FOGMODE_NONE;
    }
}
