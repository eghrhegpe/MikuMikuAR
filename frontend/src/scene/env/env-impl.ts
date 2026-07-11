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
    MirrorTexture,
    Plane,
    Vector3,
} from '@babylonjs/core';
import { EnvState, envState } from '@/core/config';
import { createHeightmapGround, applyTerrainMaterial } from './env-terrain';
import { PlanarReflection, registerReflectionSurface } from './planar-reflection';
import { createCanvasTexture, getOrCreateCanvasTexture, disposeTextureCache } from './env-texture';

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
/** 地面高度/坡度变化回调，供 model-loader 在 groundLevel/pitch/roll 变化时重贴地模型。 */
let _onGroundChanged: (() => void) | null = null;
/** 上一帧影响贴地的地面参数，用于检测变化后触发 _onGroundChanged。 */
let _prevGroundHeight = NaN;
let _prevGroundPitch = NaN;
let _prevGroundRoll = NaN;
/** 纹理滚动累计偏移量（每帧由 observer 累加，取模 1.0）。 */
let _groundScrollU = 0;
let _groundScrollV = 0;

// === Phase B: 地面镜面反射（统一平面反射引擎，ADR-092）===
// 地面用 mirrorTexture 模式：MirrorTexture 挂在 StandardMaterial.reflectionTexture 后由 Babylon
// 自动渲染（不手动 .render()、不 push customRenderTargets），根除旧实现的双重驱动与镜像平面未配置问题。
const groundReflection = new PlanarReflection({
    name: 'ground',
    mode: 'mirrorTexture',
    resolutionMap: { high: 1024, medium: 512, low: 256, off: 0 },
    getQuality: (s) => s.groundReflectionQuality,
    getBlend: (s) => s.groundReflectionBlend,
    getSurfaceLevel: (s) => s.groundLevel,
    getMirrorPlane: (_s, _scene) => {
        const mesh = _envSys.ground.mesh;
        if (mesh) {
            const n = Vector3.TransformNormal(Vector3.Up(), mesh.getWorldMatrix()).normalize();
            return Plane.FromPositionAndNormal(mesh.getAbsolutePosition(), n);
        }
        return new Plane(0, -1, 0, 0);
    },
    predicate: (mesh, level) =>
        !mesh.name.startsWith('envGround') &&
        mesh.isEnabled() &&
        mesh.getBoundingInfo().boundingBox.maximumWorld.y >= level,
    getMaterial: () => _envSys.ground.mesh?.material ?? null,
    mount: (rt) => {
        const mat = _envSys.ground.mesh?.material as StandardMaterial | null;
        if (mat) {
            mat.reflectionTexture = rt as MirrorTexture | null;
        }
    },
    setBlend: (b) => {
        const mat = _envSys.ground.mesh?.material as StandardMaterial | null;
        if (mat && mat.reflectionTexture) {
            mat.reflectionTexture.level = b;
        }
    },
});
registerReflectionSurface('ground', groundReflection, () => groundReflection.update(envState, getScene()));

/**
 * 统一纹理生成器：按层绘制 canvas 并返回 Texture。
 * 分层逻辑：
 *   1. 基础层：地面色填充（始终绘制）
 *   2. 装饰层：网格线或棋盘格（由 groundDecoStyle 控制）
 * 贴图层由外部单独加载（不经过 canvas），可与装饰层叠加。
 * 返回的 Texture 可直接设为 StandardMaterial.diffuseTexture。
 */
function _generateGroundTexture(state: EnvState, scene: Scene): Texture {
    const c0 = `rgb(${Math.round(state.groundColor[0] * 255)},${Math.round(state.groundColor[1] * 255)},${Math.round(state.groundColor[2] * 255)})`;
    const c1 = `rgb(${Math.round(state.groundLineColor[0] * 255)},${Math.round(state.groundLineColor[1] * 255)},${Math.round(state.groundLineColor[2] * 255)})`;

    // 经统一工厂创建（优先 DynamicTexture，回退 toDataURL→Texture，受约束环境不崩）。
    // 每次调用返回新 Texture，由 _updateGroundTexture 负责 dispose 旧贴图。
    const size = 512;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        // 第 1 层：基础色填充
        ctx.fillStyle = c0;
        ctx.fillRect(0, 0, s, s);

        // 第 2 层：装饰叠加（网格/棋盘格）
        if (state.groundDecoStyle === 'grid') {
            const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));
            ctx.strokeStyle = c1;
            ctx.lineWidth = Math.max(1, Math.round(tileSize / 24));
            for (let x = tileSize; x < s; x += tileSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, s);
                ctx.stroke();
            }
            for (let y = tileSize; y < s; y += tileSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(s, y);
                ctx.stroke();
            }
        } else if (state.groundDecoStyle === 'checker') {
            const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));
            switch (state.groundPattern) {
                case 'checker':
                    for (let y = 0; y < s; y += tileSize) {
                        for (let x = 0; x < s; x += tileSize) {
                            const isEven = (x / tileSize + y / tileSize) % 2 === 0;
                            ctx.fillStyle = isEven ? c0 : c1;
                            ctx.fillRect(x, y, tileSize, tileSize);
                        }
                    }
                    break;
                case 'dots':
                    ctx.fillStyle = c0;
                    ctx.fillRect(0, 0, s, s);
                    ctx.fillStyle = c1;
                    for (let y = 0; y < s; y += tileSize) {
                        for (let x = 0; x < s; x += tileSize) {
                            ctx.beginPath();
                            ctx.arc(x + tileSize / 2, y + tileSize / 2, tileSize / 3, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                    break;
                case 'stripes':
                    for (let x = 0; x < s; x += tileSize) {
                        const isEven = (x / tileSize) % 2 === 0;
                        ctx.fillStyle = isEven ? c0 : c1;
                        ctx.fillRect(x, 0, tileSize, s);
                    }
                    break;
                case 'radial': {
                    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
                    grad.addColorStop(0, c0);
                    grad.addColorStop(1, c1);
                    ctx.fillStyle = grad;
                    ctx.fillRect(0, 0, s, s);
                    break;
                }
                default:
                    // 未知 pattern 时兜底绘制标准棋盘格
                    for (let y = 0; y < s; y += tileSize) {
                        for (let x = 0; x < s; x += tileSize) {
                            const isEven = (x / tileSize + y / tileSize) % 2 === 0;
                            ctx.fillStyle = isEven ? c0 : c1;
                            ctx.fillRect(x, y, tileSize, tileSize);
                        }
                    }
                    break;
            }
        }
    };

    return createCanvasTexture({ size, draw, scene, name: 'envGround', wrap: 'clamp' });
}

/**
 * 查询某世界坐标 (x, z) 处的地面高度，用于把模型贴合到地面上。
 * - heightmap 模式：返回地形网格 getHeightAtCoordinates（真实起伏，world 坐标入参）。
 * - 其他模式：返回 groundLevel（平面参考高度）。
 * 地形尚未加载完成时回退到 groundLevel，避免模型被错误地放到 0。
 */
// 平面模式解析求高用的复用临时量，避免每帧 allocate（feet-adjustment 按脚调用）。
const _groundPlaneNormal = new Vector3();
const _groundPlaneUp = new Vector3(0, 1, 0);
const _groundPlanePoint = new Vector3();

/**
 * 平面模式（grid/checker/texture/solid）求世界坐标 (x, z) 处地面高度。
 *
 * 这些模式顶点局部 y≡0，但可被 pitch/roll 倾斜（ADR-083 Phase A）。
 * Babylon `GroundMesh.getHeightAtCoordinates` 在世界变换时只对 (0, y, 0) 取 y 分量
 * （groundMesh.pure.js:83），丢弃了局部 x/z 偏移，导致倾斜后只返回 position.y，
 * 模型脚悬空/穿模。
 *
 * 改用世界平面方程解析求解 N·(X - P0) = 0，精确反映倾斜：
 *   - 无倾斜时 normal=(0,1,0)、P0.y=groundLevel → 结果退化为 groundLevel（与原行为一致）。
 *   - 近垂直平面（|N.y|<ε）退化回 groundLevel，防止除零。
 */
function getTiltedPlaneHeight(mesh: Mesh, x: number, z: number): number {
    const world = mesh.getWorldMatrix();
    Vector3.TransformNormalToRef(_groundPlaneUp, world, _groundPlaneNormal);
    _groundPlaneNormal.normalize();
    if (Math.abs(_groundPlaneNormal.y) < 1e-4) return envState.groundLevel;
    Vector3.TransformCoordinatesFromFloatsToRef(0, 0, 0, world, _groundPlanePoint);
    return (
        _groundPlanePoint.y -
        (_groundPlaneNormal.x * (x - _groundPlanePoint.x) +
            _groundPlaneNormal.z * (z - _groundPlanePoint.z)) /
            _groundPlaneNormal.y
    );
}

export function getGroundHeightAt(x: number, z: number): number {
    const m = _envSys.ground.mesh;
    if (!m || !m.isReady()) return envState.groundLevel;

    // 高度图模式：Babylon 原生起伏采样。ADR-083 已禁用其 pitch/roll（恒水平），
    // 仅平移变换下 getHeightAtCoordinates 世界变换退化为 (0,y,0)+平移，结果正确。
    if (envState.groundType === 'terrain' && typeof (m as GroundMesh).getHeightAtCoordinates === 'function') {
        try {
            return (m as GroundMesh).getHeightAtCoordinates(x, z);
        } catch (e) {
            console.warn('[terrain] getGroundHeightAt failed', e);
            return envState.groundLevel;
        }
    }

    // 平面模式（grid/checker/texture/solid）：用世界平面方程解析求真实高度，
    // 修正 Babylon 在倾斜时丢弃旋转的问题（groundMesh.pure.js:83）。
    return getTiltedPlaneHeight(m, x, z);
}

/** 注册地形就绪回调（由 model-loader 调用，用于在高度图加载完成后重新贴地所有模型）。 */
export function setOnTerrainReady(cb: (() => void) | null): void {
    _onTerrainReady = cb;
}

/** 注册地面参数变化回调（由 model-loader 订阅，在 groundLevel/pitch/roll 变化时重贴地模型）。 */
export function setOnGroundChanged(cb: (() => void) | null): void {
    _onGroundChanged = cb;
}

// ======== 地面边缘淡出（径向不透明度贴图）========
// 生成「中心白→边缘黑」的径向渐变，作为 opacityTexture 挂到各模式材质上，
// 使地面边缘柔和淡出而非硬方块边。fade<=0 时返回 null（保持原硬边行为）。
// 按 fade 量化值经统一工厂缓存，避免拖动滑块时反复生成 canvas；
// 缓存统一由 disposeTextureCache 在 disposeEnvUpdateObserver 时释放。
function getGroundEdgeFadeTexture(fade: number, scene: Scene): Texture | null {
    if (fade <= 0) return null;
    const key = Math.round(fade * 100);
    const S = 256;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        // r0：保持完全不透明的内部半径占比（0..1）。fade 越大，r0 越小，淡出越广。
        const r0 = Math.max(0, 1 - fade);
        const grad = ctx.createRadialGradient(s / 2, s / 2, r0 * (s / 2), s / 2, s / 2, s / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
    };
    return getOrCreateCanvasTexture(`env-ground-edge-fade-${key}`, {
        size: S,
        draw,
        scene,
        name: 'envGroundEdgeFade',
        wrap: 'clamp',
        getAlphaFromRGB: true,
    });
}

function applyGroundEdgeFade(
    mat: StandardMaterial,
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
 * 所有纹理样式原地更新：重新绘制 canvas 并替换现有贴图。
 * 不重建整个 material，避免失去引用（如反射纹理、边缘 fade）。
 */
function _updateGroundTexture(mat: StandardMaterial, state: EnvState): void {
    const scene = getScene();
    const newTex = _generateGroundTexture(state, scene);
    const oldTex = mat.diffuseTexture;
    newTex.uScale = oldTex instanceof Texture ? oldTex.uScale : 1;
    newTex.vScale = oldTex instanceof Texture ? oldTex.vScale : 1;
    mat.diffuseTexture = newTex;
    mat.diffuseColor = new Color3(1, 1, 1);
    if (oldTex) {
        oldTex.dispose();
    }
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
// Phase B: 地面镜面反射（委托给统一平面反射引擎，ADR-092）
// ══════════════════════════════════════════════════════════════

/**
 * 构建/更新地面镜面反射：委托给统一平面反射引擎（ADR-092）。
 * 引擎内部处理 RT 创建、BFC、renderList 脏标记、帧跳过、互斥（关地即开水）。
 */
function buildGroundReflection(state: EnvState): void {
    groundReflection.update(state, getScene());
}

/** 销毁地面反射（供 applyGround 重建路径与 disposeEnv 调用）。 */
function disposeGroundReflection(): void {
    groundReflection.dispose();
}

export function applyGround(state: EnvState): void {
    const scene = getScene();

    const typeKey =
        state.groundType === 'terrain'
            ? `heightmap:${state.groundTerrainHeight}:${state.groundTerrainScale}:${state.groundTerrainSeed}:${state.groundTerrainOctaves}:${state.groundLevel}:${state.groundSize}:${state.groundColor.join(',')}:${state.groundAlpha}:${state.groundTextureEnabled}:${state.groundTexture}:${state.groundTextureScale}:${state.groundTextureRotation}`
            : state.groundTextureEnabled && state.groundTexture
              ? `texture:${state.groundTexture}:${state.groundSize}:${state.groundReflectionQuality}`
              : `canvas:${state.groundStyle}:${state.groundGridSize}:${state.groundColor.join(',')}:${state.groundLineColor.join(',')}:${state.groundSize}:${state.groundReflectionQuality}`;
    const keyChanged = typeKey !== _currentGroundKey;

    // 地面已存在、可见、类型未变 → 原地更新颜色/透明度/纹理缩放/旋转/坡度/法线/反射
    if (_envSys.ground.mesh && state.groundVisible && !keyChanged) {
        const mat = _envSys.ground.mesh.material;
        if (mat) {
            if (mat instanceof StandardMaterial) {
                // 所有纹理样式（solid/grid/checker）：颜色/图案/网格大小变化时重新生成 canvas 贴图
                if (state.groundStyle !== 'texture') {
                    _updateGroundTexture(mat, state);
                } else {
                    mat.diffuseColor = new Color3(
                        state.groundColor[0],
                        state.groundColor[1],
                        state.groundColor[2]
                    );
                }
                mat.alpha = state.groundAlpha;
                if (mat.diffuseTexture && mat.diffuseTexture instanceof Texture) {
                    (mat.diffuseTexture as Texture).uScale = (
                        mat.diffuseTexture as Texture
                    ).vScale = 1 / Math.max(0.1, state.groundTextureScale);
                    _syncGroundTextureOffset(mat, state);
                }
                // 法线贴图（Phase B）
                _syncGroundNormalTexture(mat, state);
            }
            // 边缘淡出：随滑块实时更新 opacityTexture（fade<=0 时移除）
            applyGroundEdgeFade(mat as StandardMaterial, state.groundEdgeFade, scene);
        }
        // 更新地面高度
        _envSys.ground.mesh.position.y = state.groundLevel;
        // 更新坡度（heightmap 模式禁用，保持 0）
        if (state.groundType !== 'terrain') {
            _envSys.ground.mesh.rotation.x = (state.groundPitch * Math.PI) / 180;
            _envSys.ground.mesh.rotation.z = (state.groundRoll * Math.PI) / 180;
        }
        // 地面高度/坡度变化 → 通知模型重贴地（脚底跟随 groundLevel / 倾斜）
        if (
            state.groundLevel !== _prevGroundHeight ||
            state.groundPitch !== _prevGroundPitch ||
            state.groundRoll !== _prevGroundRoll
        ) {
            _prevGroundHeight = state.groundLevel;
            _prevGroundPitch = state.groundPitch;
            _prevGroundRoll = state.groundRoll;
            _onGroundChanged?.();
        }
        // 反射 RT 重建（委托引擎：quality 变更时重建、blend 变更走原地更新、互斥自动处理）
        buildGroundReflection(state);
        return;
    }

    _currentGroundKey = typeKey;
    // 样式切换时重置滚动偏移，避免旧样式的累积偏移影响新样式
    _groundScrollU = 0;
    _groundScrollV = 0;
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
    if (state.groundType === 'terrain') {
        const hg = createHeightmapGround(state, scene, (gm) => {
            applyTerrainMaterial(gm, state, scene);
            applyGroundEdgeFade(gm.material as StandardMaterial, state.groundEdgeFade, scene);
            // Phase B: 地形地面材质就绪后再挂载反射（修复此前直接 return 致反射永久丢失）。
            buildGroundReflection(state);
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

    if (state.groundStyle !== 'texture') {
        // solid / grid / checker：统一用 canvas 生成纹理
        const tex = _generateGroundTexture(state, scene);
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseTexture = tex;
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
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
        applyGroundEdgeFade(ground.material as StandardMaterial, state.groundEdgeFade, scene);
    }

    // 坡度（heightmap 模式已提前 return，此处一定是非 heightmap 模式）
    ground.rotation.x = (state.groundPitch * Math.PI) / 180;
    ground.rotation.z = (state.groundRoll * Math.PI) / 180;

    // Phase B: 镜面反射（创建后挂载，委托引擎）
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
            (envState.groundStyle === 'checker' ||
                (envState.groundStyle === 'texture' && envState.groundTextureEnabled && envState.groundTexture))
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

        // Phase B: 地面镜面反射（委托统一平面反射引擎：镜像平面跟随、renderList 脏标记、
        // 帧跳过、异常保护、互斥均内置于引擎，ADR-092）
        groundReflection.update(envState, scene);

        // 跟随相机（每帧重定位到相机下方）。所有样式统一支持，便于观察网格/棋盘格细节
        if (_envSys.ground.mesh && envState.groundFollowCamera) {
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
    // 释放统一贴图工厂缓存（含地面边缘淡出等）
    disposeTextureCache();
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
