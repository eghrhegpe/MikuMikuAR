// env-sky.ts — 天空子系统（程序化渐变 / CubeTexture / color 模式）
// 从 env-impl.ts 拆分而来，导入共享依赖通过 env-impl.ts barrel。

import {
    Scene,
    Color3,
    Color4,
    Texture,
    BaseTexture,
    DynamicTexture,
    StandardMaterial,
    Constants,
    Mesh,
    MeshBuilder,
    CubeTexture,
    RawCubeTexture,
} from '@babylonjs/core';
import { EnvState, envState } from '@/core/config';
import { col3FromTriple } from '@/core/color-helpers';
import { logWarn } from '@/core/logger';
import { _envSys, getScene, resolveStaticAsset } from './env-context';
import { ensureEnvUpdateObserver } from './env-impl';
import { _disposeSunDisc } from '../render/lighting';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';

// ======== Module state ========
let _lastProceduralSkyKey = '';
let _lastSkyCubePath: string | null = null; // cube 路径缓存，避免旋转/强度微调时重复从磁盘加载
let _skyFollowHandle: ObserverHandle | null = null;
let _proceduralEnvTexture: RawCubeTexture | null = null;

/** 天空渐变 canvas 尺寸 */
const SKY_TEX_SIZE = 256;

// ======== 星空贴图异步加载缓存 ========
let _texStarsImg: HTMLImageElement | null = null;
let _texStarsImgUrl: string | null = null;
let _texStarsGeneration = 0;

export function _getStarsTexCache() {
    return { img: _texStarsImg, url: _texStarsImgUrl, generation: _texStarsGeneration };
}

export function _setStarsTexCache(img: HTMLImageElement | null, url: string | null, gen: number) {
    _texStarsImg = img;
    _texStarsImgUrl = url;
    _texStarsGeneration = gen;
}

export function clearStarsTexCache() {
    _texStarsImg = null;
    _texStarsImgUrl = null;
    _texStarsGeneration = 0;
}

/** 异步加载星空贴图（带 generation 守卫）。 */
function _ensureStarsTextureImage(url: string, onReady: (img: HTMLImageElement) => void): void {
    if (_texStarsImg && _texStarsImgUrl === url && _texStarsImg.complete) {
        onReady(_texStarsImg);
        return;
    }
    if (_texStarsImgUrl !== url) {
        _texStarsImg = null;
        _texStarsImgUrl = url;
    }
    const generation = ++_texStarsGeneration;
    const img = new Image();
    img.onload = () => {
        if (generation !== _texStarsGeneration) {
            return;
        }
        _texStarsImg = img;
        onReady(img);
    };
    img.onerror = () => {
        if (generation !== _texStarsGeneration) {
            return;
        }
        logWarn('stars', 'texture load failed:', url);
    };
    img.src = url;
}

// ======== Sky Gradient Drawing ========

function drawSkyGradient(
    ctx: CanvasRenderingContext2D,
    top: Color3,
    mid: Color3,
    bot: Color3,
    brightness: number,
    sunAngle: number,
    starsEnabled: boolean,
    starsTextureImg?: HTMLImageElement | null
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
            if (starsTextureImg) {
                ctx.save();
                ctx.globalAlpha = starAlpha;
                ctx.drawImage(starsTextureImg, 0, 0, W, H);
                ctx.restore();
            } else {
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
}

// ======== DynamicTexture Management ========

function updateSkyDynamicTexture(state: EnvState): DynamicTexture {
    const scene = getScene();
    const envBrightness = state.envBrightness ?? 1;
    const effectiveSkyBrightness = state.skyBrightness * envBrightness;
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

    let starsImg: HTMLImageElement | null = null;
    if (
        state.starsTexture &&
        _texStarsImg &&
        _texStarsImgUrl === state.starsTexture &&
        _texStarsImg.complete
    ) {
        starsImg = _texStarsImg;
    }

    drawSkyGradient(
        ctx,
        col3FromTriple(state.skyColorTop),
        col3FromTriple(state.skyColorMid),
        col3FromTriple(state.skyColorBot),
        effectiveSkyBrightness,
        state.sunAngle,
        state.starsEnabled,
        starsImg
    );
    tex.update();

    if (state.starsTexture && !starsImg) {
        const url = resolveStaticAsset(state.starsTexture);
        _ensureStarsTextureImage(url, (img) => {
            const cur = _envSys.sky.skyDynamicTex;
            if (!cur) {
                return;
            }
            const curCtx = cur.getContext() as CanvasRenderingContext2D | null;
            if (!curCtx) {
                return;
            }
            drawSkyGradient(
                curCtx,
                col3FromTriple(state.skyColorTop),
                col3FromTriple(state.skyColorMid),
                col3FromTriple(state.skyColorBot),
                effectiveSkyBrightness,
                state.sunAngle,
                state.starsEnabled,
                img
            );
            cur.update();
        });
    }

    return tex;
}

// ======== Procedural Sky ========

function createProceduralSky(state: EnvState): void {
    const scene = getScene();
    const cam = scene.activeCamera;
    const farZ = cam?.maxZ ?? 10000;
    const diameter = Math.min(20000, Math.max(2000, farZ * 1.8));
    const sphere = MeshBuilder.CreateSphere(
        'envSkySphere',
        { diameter, segments: 32, sideOrientation: Mesh.BACKSIDE },
        scene
    );
    sphere.isPickable = false;
    // 先于体积云（Group -1）渲染，填背景但不写深度，避免挡住云的 alpha 合成
    sphere.renderingGroupId = -2;

    const mat = new StandardMaterial('envSkyMat', scene);
    mat.emissiveTexture = updateSkyDynamicTexture(state);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;

    sphere.material = mat;
    _envSys.sky.skyMesh = sphere;

    // 跟随相机，与云层同心（同 center），确保深度测试正确
    _skyFollowHandle = observe(scene.onBeforeRenderObservable, () => {
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        sphere.position.x = cam.position.x;
        sphere.position.z = cam.position.z;
    });

    scene.clearColor = new Color4(0, 0, 0, 1);

    // 为 PBR 材质创建简单环境贴图（IBL）
    createProceduralEnvTexture(state, scene);

    const envBrightness = state.envBrightness ?? 1;
    const effectiveSkyBrightness = state.skyBrightness * envBrightness;
    const starsPhase = state.starsEnabled ? (state.sunAngle > 10 ? 'h' : 'l') : '';
    _lastProceduralSkyKey = `${state.skyColorTop}|${state.skyColorMid}|${state.skyColorBot}|${effectiveSkyBrightness}|${state.starsEnabled}|${state.starsTexture}|${starsPhase}`;
}

/** 为 PBR 材质创建简单环境立方体贴图（基于天空渐变颜色） */
function createProceduralEnvTexture(state: EnvState, scene: Scene): void {
    // 释放旧贴图
    if (_proceduralEnvTexture) {
        _proceduralEnvTexture.dispose();
        _proceduralEnvTexture = null;
    }

    const size = 32; // 小尺寸足够，环境贴图不需要高分辨率
    const topColor = col3FromTriple(state.skyColorTop);
    const midColor = col3FromTriple(state.skyColorMid);
    const botColor = col3FromTriple(state.skyColorBot);
    const brightness = state.skyBrightness * (state.envBrightness ?? 1);

    // 创建 6 个面的像素数据（简单渐变：上=顶色，中=中色，下=底色）
    const faces: Uint8Array[] = [];
    for (let face = 0; face < 6; face++) {
        const data = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) {
            // 根据 y 位置插值颜色
            const t = y / size;
            let r: number, g: number, b: number;
            if (t < 0.5) {
                // 上半：顶色 → 中色
                const lt = t * 2;
                r = (topColor.r * (1 - lt) + midColor.r * lt) * brightness;
                g = (topColor.g * (1 - lt) + midColor.g * lt) * brightness;
                b = (topColor.b * (1 - lt) + midColor.b * lt) * brightness;
            } else {
                // 下半：中色 → 底色
                const lt = (t - 0.5) * 2;
                r = (midColor.r * (1 - lt) + botColor.r * lt) * brightness;
                g = (midColor.g * (1 - lt) + botColor.g * lt) * brightness;
                b = (midColor.b * (1 - lt) + botColor.b * lt) * brightness;
            }
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                data[idx] = Math.min(255, r * 255);
                data[idx + 1] = Math.min(255, g * 255);
                data[idx + 2] = Math.min(255, b * 255);
                data[idx + 3] = 255;
            }
        }
        faces.push(data);
    }

    // 创建 RawCubeTexture
    _proceduralEnvTexture = new RawCubeTexture(scene, faces, size);
    scene.environmentTexture = _proceduralEnvTexture;
}

// ======== CubeTexture Sky ========

function loadSkyCube(path: string, rotationY: number, intensity: number): void {
    const scene = getScene();
    const ext = path.split('.').pop().toLowerCase();
    const supported = ['hdr', 'dds', 'exr'];
    if (!supported.includes(ext ?? '')) {
        logWarn('sky', `unsupported format .${ext}, falling back to procedural`);
        disposeSky();
        createProceduralSky(envState);
        return;
    }

    const cubeTex = new CubeTexture(
        path,
        scene,
        null,
        false,
        null,
        null,
        (message?: string, exception?: any) => {
            logWarn('sky', `loadSkyCube failed: ${message}`, exception);
            disposeSky();
            createProceduralSky(envState);
        }
    );
    cubeTex.rotationY = rotationY;
    scene.environmentTexture = cubeTex;
    scene.environmentIntensity = intensity;
    scene.clearColor = new Color4(0, 0, 0, 1);
    _envSys.sky.skyCubeTexture = cubeTex;
    _lastSkyCubePath = path; // 缓存成功加载的路径，供 applySky 判定是否需重载

    const cam = scene.activeCamera;
    const farZ = cam?.maxZ ?? 10000;
    const diameter = Math.min(20000, Math.max(2000, farZ * 1.8));
    const sphere = MeshBuilder.CreateSphere(
        'envSkyDome',
        { diameter, segments: 32, sideOrientation: Mesh.BACKSIDE },
        scene
    );
    sphere.isPickable = false;
    // 先于体积云（Group -1）渲染，填背景但不写深度，避免挡住云的 alpha 合成
    sphere.renderingGroupId = -2;
    const mat = new StandardMaterial('envSkyDomeMat', scene);
    mat.reflectionTexture = cubeTex;
    mat.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.disableDepthWrite = true;
    sphere.material = mat;
    _envSys.sky.skyMesh = sphere;

    // 跟随相机，与云层同心（同 center），确保深度测试正确
    _skyFollowHandle = observe(scene.onBeforeRenderObservable, () => {
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        sphere.position.x = cam.position.x;
        sphere.position.z = cam.position.z;
    });
}

// ======== Public API ========

export function disposeSky(): void {
    const scene = getScene();
    // 移除相机跟随观察者，避免泄漏
    _skyFollowHandle = safeDispose(_skyFollowHandle);
    if (_envSys.sky.skyMesh) {
        _envSys.sky.skyMesh.material?.dispose();
        _envSys.sky.skyMesh = safeDispose(_envSys.sky.skyMesh);
    }
    if (_envSys.sky.skyCubeTexture) {
        scene.environmentTexture = null;
        _envSys.sky.skyCubeTexture = safeDispose(_envSys.sky.skyCubeTexture);
    }
    if (_envSys.sky.skyDynamicTex) {
        _envSys.sky.skyDynamicTex = safeDispose(_envSys.sky.skyDynamicTex);
    }
    // 释放程序化环境贴图
    if (_proceduralEnvTexture) {
        scene.environmentTexture = null;
        _proceduralEnvTexture.dispose();
        _proceduralEnvTexture = null;
    }
    _lastProceduralSkyKey = '';
    _lastSkyCubePath = null;
    _disposeSunDisc();
}

export function applySky(state: EnvState): void {
    const scene = getScene();
    ensureEnvUpdateObserver();
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
        if (!mesh || !mesh.material) {
            disposeSky();
            createProceduralSky(state);
            return;
        }
        if (mesh.material && mesh.material.getClassName() === 'StandardMaterial') {
            const mat = mesh.material as StandardMaterial;

            const envBrightness = state.envBrightness ?? 1;
            const effectiveSkyBrightness = state.skyBrightness * envBrightness;
            const starsPhase = state.starsEnabled ? (state.sunAngle > 10 ? 'h' : 'l') : '';
            const skyKey = `${state.skyColorTop}|${state.skyColorMid}|${state.skyColorBot}|${effectiveSkyBrightness}|${state.starsEnabled}|${state.starsTexture}|${starsPhase}`;
            if (skyKey === _lastProceduralSkyKey && _envSys.sky.skyDynamicTex) {
                return;
            }
            _lastProceduralSkyKey = skyKey;

            if (_envSys.sky.skyCubeTexture || mat.reflectionTexture) {
                if (_envSys.sky.skyCubeTexture) {
                    scene.environmentTexture = null;
                    _envSys.sky.skyCubeTexture.dispose();
                    _envSys.sky.skyCubeTexture = null;
                }
                mat.reflectionTexture = null;
            }

            mat.emissiveTexture = updateSkyDynamicTexture(state);
            return;
        }
        disposeSky();
        createProceduralSky(state);
        return;
    }

    if (state.skyTexture) {
        const intensity = state.envIntensity * (state.envBrightness ?? 1);
        // 路径未变：仅更新静态旋转与 IBL 强度，避免重复从磁盘加载 CubeTexture
        // （旋转滑块拖动 / 强度微调场景 —— 修复此前每次 sky key 变更都整图重载的隐患）
        if (
            _lastSkyCubePath === state.skyTexture &&
            _envSys.sky.skyCubeTexture &&
            _envSys.sky.skyMesh
        ) {
            (_envSys.sky.skyCubeTexture as CubeTexture).rotationY = state.skyRotationY;
            getScene().environmentIntensity = intensity;
            return;
        }
        disposeSky();
        loadSkyCube(state.skyTexture, state.skyRotationY, intensity);
    } else {
        disposeSky();
    }
}
