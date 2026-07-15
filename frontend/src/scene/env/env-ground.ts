// env-ground.ts — 地面子系统（程序化/纹理/地形/反射/淡出/滚动）
// 从 env-impl.ts 拆分而来。

import {
    Scene,
    Color3,
    Texture,
    DynamicTexture,
    StandardMaterial,
    FresnelParameters,
    Mesh,
    MeshBuilder,
    GroundMesh,
    MirrorTexture,
    Plane,
    Vector3,
    Matrix,
} from '@babylonjs/core';
import { EnvState, envState } from '@/core/config';
import { col3FromTriple, rgbString } from '@/core/color-helpers';
import { logWarn } from '@/core/utils';
import { createHeightmapGround, applyTerrainMaterial } from './env-terrain';
import { PlanarReflection, registerReflectionSurface } from './planar-reflection';
import { createCanvasTexture, getOrCreateCanvasTexture } from './env-texture';
import { _envSys, getScene, ensureEnvUpdateObserver } from './env-impl';

// ======== Module state ========
let _currentGroundKey: string = '';
let _onTerrainReady: (() => void) | null = null;
let _onGroundChanged: (() => void) | null = null;
let _prevGroundHeight = NaN;
let _prevGroundPitch = NaN;
let _prevGroundRoll = NaN;
let _groundScrollU = 0;
let _groundScrollV = 0;

// ======== Texture mode cache ========
const _TEX_GROUND_SIZE = 512;
let _texGroundImg: HTMLImageElement | null = null;
let _texGroundImgUrl: string | null = null;
let _texGroundGeneration = 0;

export function clearGroundTexCache() {
    _texGroundImg = null;
    _texGroundImgUrl = null;
    _texGroundGeneration = 0;
}

// ======== 地面镜面反射（ADR-092）========
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
            if (rt) {
                mat.reflectionTexture = rt as MirrorTexture | null;
                mat.reflectionFresnelParameters = new FresnelParameters();
                mat.reflectionFresnelParameters.isEnabled = false;
                mat.specularColor = new Color3(0.5, 0.5, 0.5);
            } else {
                mat.reflectionTexture = null;
                mat.reflectionFresnelParameters = new FresnelParameters();
                mat.reflectionFresnelParameters.isEnabled = true;
                mat.specularColor = new Color3(0.2, 0.2, 0.2);
            }
        }
    },
    setBlend: (b) => {
        const mat = _envSys.ground.mesh?.material as StandardMaterial | null;
        if (mat && mat.reflectionTexture) {
            mat.reflectionTexture.level = b;
        }
    },
});
registerReflectionSurface('ground', groundReflection, () =>
    groundReflection.update(envState, getScene())
);

function buildGroundReflection(state: EnvState): void {
    groundReflection.markRenderListDirty();
    groundReflection.update(state, getScene());
}

function disposeGroundReflection(): void {
    groundReflection.dispose();
}

// ======== 地面高度查询（倾斜平面补偿）========
const _groundPlaneNormal = new Vector3();
const _groundPlaneUp = new Vector3(0, 1, 0);
const _groundPlanePoint = new Vector3();
const _terrainInvWorld = new Matrix();
const _terrainLocalPos = new Vector3();
const _terrainWorldPos = new Vector3();

function getTiltedPlaneHeight(mesh: Mesh, x: number, z: number): number {
    const world = mesh.getWorldMatrix();
    Vector3.TransformNormalToRef(_groundPlaneUp, world, _groundPlaneNormal);
    _groundPlaneNormal.normalize();
    if (Math.abs(_groundPlaneNormal.y) < 1e-4) {
        return envState.groundLevel;
    }
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
    if (!m || !m.isReady()) {
        return envState.groundLevel;
    }

    if (
        envState.groundType === 'terrain' &&
        typeof (m as GroundMesh).getHeightAtCoordinates === 'function'
    ) {
        try {
            const gm = m as GroundMesh;
            if (Math.abs(gm.rotation.x) > 0.001 || Math.abs(gm.rotation.z) > 0.001) {
                const worldMat = gm.getWorldMatrix();
                worldMat.invertToRef(_terrainInvWorld);
                Vector3.TransformCoordinatesFromFloatsToRef(x, 0, z, _terrainInvWorld, _terrainLocalPos);
                const localHeight = gm.getHeightAtCoordinates(_terrainLocalPos.x, _terrainLocalPos.z);
                if (!isFinite(localHeight)) return envState.groundLevel;
                Vector3.TransformCoordinatesFromFloatsToRef(
                    _terrainLocalPos.x, localHeight, _terrainLocalPos.z, worldMat, _terrainWorldPos
                );
                return _terrainWorldPos.y;
            }
            return gm.getHeightAtCoordinates(x, z);
        } catch (e) {
            logWarn('terrain', 'getGroundHeightAt failed', e);
            return envState.groundLevel;
        }
    }

    return getTiltedPlaneHeight(m, x, z);
}

export function setOnTerrainReady(cb: (() => void) | null): void {
    _onTerrainReady = cb;
}

export function setOnGroundChanged(cb: (() => void) | null): void {
    _onGroundChanged = cb;
}

// ======== 纹理生成 ========

function _generateGroundTexture(state: EnvState, scene: Scene): Texture {
    const c0 = rgbString(col3FromTriple(state.groundColor));
    const c1 = rgbString(col3FromTriple(state.groundLineColor));

    const size = 512;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        ctx.fillStyle = c0;
        ctx.fillRect(0, 0, s, s);

        if (state.groundDecoStyle === 'grid') {
            const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));
            ctx.strokeStyle = c1;
            ctx.lineWidth = Math.max(1, Math.round(tileSize / 24));
            for (let x = tileSize; x < s; x += tileSize) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke();
            }
            for (let y = tileSize; y < s; y += tileSize) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
            }
        } else if (state.groundDecoStyle === 'checker') {
            const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));
            switch (state.groundPattern) {
                case 'checker':
                    for (let y = 0; y < s; y += tileSize) {
                        for (let x = 0; x < s; x += tileSize) {
                            ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? c0 : c1;
                            ctx.fillRect(x, y, tileSize, tileSize);
                        }
                    }
                    break;
                case 'dots':
                    ctx.fillStyle = c0; ctx.fillRect(0, 0, s, s);
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
                        ctx.fillStyle = (x / tileSize) % 2 === 0 ? c0 : c1;
                        ctx.fillRect(x, 0, tileSize, s);
                    }
                    break;
                case 'radial': {
                    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
                    grad.addColorStop(0, c0); grad.addColorStop(1, c1);
                    ctx.fillStyle = grad; ctx.fillRect(0, 0, s, s);
                    break;
                }
                default:
                    for (let y = 0; y < s; y += tileSize) {
                        for (let x = 0; x < s; x += tileSize) {
                            ctx.fillStyle = (x / tileSize + y / tileSize) % 2 === 0 ? c0 : c1;
                            ctx.fillRect(x, y, tileSize, tileSize);
                        }
                    }
                    break;
            }
        }
    };

    return createCanvasTexture({ size, draw, scene, name: 'envGround', wrap: 'clamp' });
}

// ======== Texture mode: external image compositing ========

function _drawTextureGroundCanvas(
    ctx: CanvasRenderingContext2D, size: number, img: HTMLImageElement, state: EnvState
): void {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    if (state.groundDecoStyle === 'none') return;

    const r = Math.round(state.groundLineColor[0] * 255);
    const g = Math.round(state.groundLineColor[1] * 255);
    const b = Math.round(state.groundLineColor[2] * 255);
    const lineColor = `rgb(${r},${g},${b})`;
    const tileSize = Math.max(8, Math.round(64 * state.groundGridSize));

    if (state.groundDecoStyle === 'grid') {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = Math.max(1, Math.round(tileSize / 24));
        for (let x = tileSize; x < size; x += tileSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
        }
        for (let y = tileSize; y < size; y += tileSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
        }
    } else if (state.groundDecoStyle === 'checker') {
        for (let y = 0; y < size; y += tileSize) {
            for (let x = 0; x < size; x += tileSize) {
                if ((x / tileSize + y / tileSize) % 2 === 0) {
                    ctx.fillStyle = lineColor;
                    ctx.fillRect(x, y, tileSize, tileSize);
                }
            }
        }
    }
}

function _ensureTextureGroundImage(url: string, onReady: (img: HTMLImageElement) => void): void {
    if (_texGroundImg && _texGroundImgUrl === url && _texGroundImg.complete) {
        onReady(_texGroundImg);
        return;
    }
    if (_texGroundImgUrl !== url) {
        _texGroundImg = null;
        _texGroundImgUrl = url;
    }
    const generation = ++_texGroundGeneration;
    const img = new Image();
    img.onload = () => {
        if (generation !== _texGroundGeneration) return;
        _texGroundImg = img;
        onReady(img);
    };
    img.onerror = () => {
        if (generation !== _texGroundGeneration) return;
        logWarn('ground', 'texture load failed:', url);
    };
    img.src = url;
}

function _syncTextureGroundTexture(mat: StandardMaterial, state: EnvState, scene: Scene): void {
    const url = state.groundTexture ? new URL(state.groundTexture, window.location.origin).href : null;
    if (!url) return;

    let dt = mat.diffuseTexture as DynamicTexture | null;
    const needCreate = !dt || !(dt instanceof DynamicTexture) || dt.name !== 'envGroundTex';
    if (needCreate) {
        if (dt) dt.dispose();
        dt = new DynamicTexture('envGroundTex', _TEX_GROUND_SIZE, scene, false);
        dt.wrapU = dt.wrapV = Texture.WRAP_ADDRESSMODE;
        dt.uScale = dt.vScale = 1 / Math.max(0.1, state.groundTextureScale);
        mat.diffuseTexture = dt;
        mat.diffuseColor = new Color3(1, 1, 1);
    } else {
        dt.uScale = dt.vScale = 1 / Math.max(0.1, state.groundTextureScale);
    }
    _syncGroundTextureOffset(mat, state);

    _ensureTextureGroundImage(url, (img) => {
        const cur = mat.diffuseTexture as DynamicTexture | null;
        if (!(cur instanceof DynamicTexture) || cur !== dt) return;
        const ctx = cur.getContext() as unknown as CanvasRenderingContext2D | null;
        if (!ctx) return;
        _drawTextureGroundCanvas(ctx, _TEX_GROUND_SIZE, img, state);
        cur.update(false);
    });
}

// ======== Edge fade / normal / offset helpers ========

function getGroundEdgeFadeTexture(fade: number, scene: Scene): Texture | null {
    if (fade <= 0) return null;
    const key = Math.round(fade * 100);
    const S = 256;
    const draw = (ctx: CanvasRenderingContext2D, s: number) => {
        const r0 = Math.max(0, 1 - fade);
        const grad = ctx.createRadialGradient(s / 2, s / 2, r0 * (s / 2), s / 2, s / 2, s / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, s, s);
    };
    return getOrCreateCanvasTexture(`env-ground-edge-fade-${key}`, {
        size: S, draw, scene, name: 'envGroundEdgeFade', wrap: 'clamp', getAlphaFromRGB: true,
    });
}

function applyGroundEdgeFade(mat: StandardMaterial, fade: number, scene: Scene): void {
    mat.opacityTexture = getGroundEdgeFadeTexture(fade, scene);
}

function _syncGroundTextureOffset(mat: StandardMaterial, state: EnvState): void {
    const tex = mat.diffuseTexture as Texture | null;
    if (!tex) return;
    const angle = (state.groundTextureRotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let u = 0.5 * (1 - cos) + 0.5 * sin + _groundScrollU;
    let v = 0.5 * (1 - cos) - 0.5 * sin + _groundScrollV;
    u = u - Math.floor(u);
    v = v - Math.floor(v);
    if (u < 0) u += 1;
    if (v < 0) v += 1;
    tex.uOffset = u;
    tex.vOffset = v;
}

function _updateGroundTexture(mat: StandardMaterial, state: EnvState): void {
    const scene = getScene();
    const newTex = _generateGroundTexture(state, scene);
    const oldTex = mat.diffuseTexture;
    newTex.uScale = oldTex instanceof Texture ? oldTex.uScale : 1;
    newTex.vScale = oldTex instanceof Texture ? oldTex.vScale : 1;
    mat.diffuseTexture = newTex;
    mat.diffuseColor = new Color3(1, 1, 1);
    if (oldTex) oldTex.dispose();
}

function _syncGroundNormalTexture(mat: StandardMaterial, state: EnvState): void {
    const scene = getScene();
    if (state.groundNormalTexture) {
        if (!mat.bumpTexture || (mat.bumpTexture as Texture).name !== state.groundNormalTexture) {
            mat.bumpTexture = new Texture(state.groundNormalTexture, scene);
        }
        mat.bumpTexture.level = state.groundNormalStrength;
    } else {
        if (mat.bumpTexture) {
            mat.bumpTexture.dispose();
            mat.bumpTexture = null;
        }
    }
}

// ======== applyGround (public) ========

export function applyGround(state: EnvState): void {
    const scene = getScene();
    ensureEnvUpdateObserver();

    const typeKey =
        state.groundType === 'terrain'
            ? `heightmap:${state.groundTerrainHeight}:${state.groundTerrainScale}:${state.groundTerrainSeed}:${state.groundTerrainOctaves}:${state.groundLevel}:${state.groundSize}:${state.groundColor.join(',')}:${state.groundAlpha}:${state.groundTextureEnabled}:${state.groundTexture}:${state.groundTextureScale}:${state.groundTextureRotation}`
            : state.groundTextureEnabled && state.groundTexture
              ? `texture:${state.groundTexture}:${state.groundSize}:${state.groundReflectionQuality}`
              : `canvas:${state.groundStyle}:${state.groundGridSize}:${state.groundColor.join(',')}:${state.groundLineColor.join(',')}:${state.groundSize}:${state.groundReflectionQuality}`;
    const keyChanged = typeKey !== _currentGroundKey;

    // 原地更新路径
    if (_envSys.ground.mesh && state.groundVisible && !keyChanged) {
        const mat = _envSys.ground.mesh.material;
        if (mat) {
            if (mat instanceof StandardMaterial) {
                if (state.groundStyle !== 'texture') {
                    _updateGroundTexture(mat, state);
                }
                mat.alpha = state.groundAlpha;
                if (mat.diffuseTexture && mat.diffuseTexture instanceof Texture) {
                    (mat.diffuseTexture as Texture).uScale = (mat.diffuseTexture as Texture).vScale =
                        1 / Math.max(0.1, state.groundTextureScale);
                    _syncGroundTextureOffset(mat, state);
                }
                _syncGroundNormalTexture(mat, state);
                if (state.groundStyle === 'texture') {
                    _syncTextureGroundTexture(mat as StandardMaterial, state, scene);
                }
            }
            applyGroundEdgeFade(mat as StandardMaterial, state.groundEdgeFade, scene);
        }
        _envSys.ground.mesh.position.y = state.groundLevel;
        _envSys.ground.mesh.rotation.x = (state.groundPitch * Math.PI) / 180;
        _envSys.ground.mesh.rotation.z = (state.groundRoll * Math.PI) / 180;
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
        buildGroundReflection(state);
        return;
    }

    // 重建路径
    _currentGroundKey = typeKey;
    _groundScrollU = 0;
    _groundScrollV = 0;
    disposeGroundReflection();
    if (_envSys.ground.mesh) {
        const oldMesh = _envSys.ground.mesh;
        const oldMat = oldMesh.material;
        if (oldMat instanceof StandardMaterial) {
            oldMat.diffuseTexture?.dispose();
            oldMat.bumpTexture?.dispose();
            oldMat.opacityTexture?.dispose();
            oldMat.reflectionTexture?.dispose();
        }
        oldMat?.dispose();
        oldMesh.dispose();
        _envSys.ground.mesh = null;
    }
    if (!state.groundVisible) return;

    // 地形模式
    if (state.groundType === 'terrain') {
        const hg = createHeightmapGround(state, scene, (gm) => {
            applyTerrainMaterial(gm, state, scene);
            applyGroundEdgeFade(gm.material as StandardMaterial, state.groundEdgeFade, scene);
            buildGroundReflection(state);
            _onTerrainReady?.();
        });
        _envSys.ground.mesh = hg;
        return;
    }

    // 平面模式
    const ground = MeshBuilder.CreateGround(
        'envGround', { width: state.groundSize, height: state.groundSize, subdivisions: 2 }, scene
    );
    ground.isPickable = false;
    ground.position.y = state.groundLevel;

    if (state.groundStyle !== 'texture') {
        const tex = _generateGroundTexture(state, scene);
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseTexture = tex;
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    } else if (state.groundTextureEnabled && state.groundTexture) {
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
        _syncTextureGroundTexture(mat, state, scene);
        _syncGroundNormalTexture(mat, state);
    } else {
        const mat = new StandardMaterial('envGroundMat', scene);
        mat.diffuseColor = new Color3(state.groundColor[0], state.groundColor[1], state.groundColor[2]);
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    }

    if (ground.material) {
        applyGroundEdgeFade(ground.material as StandardMaterial, state.groundEdgeFade, scene);
    }
    ground.rotation.x = (state.groundPitch * Math.PI) / 180;
    ground.rotation.z = (state.groundRoll * Math.PI) / 180;

    buildGroundReflection(state);
    _envSys.ground.mesh = ground;
}

// ======== Per-frame ground updates (called by observer) ========

export function tickGround(dt: number): void {
    // Ground texture scroll
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

    // Ground reflection
    groundReflection.update(envState, getScene());

    // Follow camera
    if (_envSys.ground.mesh && envState.groundFollowCamera) {
        const cam = getScene().activeCamera;
        if (cam) {
            _envSys.ground.mesh.position.x = cam.position.x;
            _envSys.ground.mesh.position.y = envState.groundLevel;
            _envSys.ground.mesh.position.z = cam.position.z;
        }
    }
}

export function disposeGround(): void {
    disposeGroundReflection();
}
