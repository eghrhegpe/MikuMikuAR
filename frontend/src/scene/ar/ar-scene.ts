// [doc:architecture] AR Scene — AR 模式场景级协调
// 职责: 切换 AR 模式时同步调整场景状态（清屏颜色、天空可见性、视线追踪）
// 依赖: ar-camera.ts（摄像头流）+ scene（清屏色）+ env-impl（天空网格）+ proc-motion-bridge（视线追踪）

import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Material } from '@babylonjs/core/Materials/material';
import { scene } from '../scene';
import { _envSys } from '../env/env-impl';
import { startARCamera, stopARCamera, captureARScreenshot, isARActive } from './ar-camera';
import type { CameraFacing } from './ar-camera';
import {
    getPerceptionState,
    setEyeTrackingEnabled,
    setHeadTrackingEnabled,
    activatePerception,
} from '../motion/perception';
import { focusedModelId, modelRegistry } from '@/core/config';

// ======== Internal State ========

let _originalClearColor: Color4 | null = null;
let _skyHidden = false;
let _prevGazeState: { eye: boolean; head: boolean } | null = null;
let _contactShadow: Mesh | null = null;

// ======== Internal Helpers: AR contact shadow ========
// AR passthrough 无平面检测，模型悬浮在视频上会显「飘」。
// 用一块贴脚的半透明径向渐变「假阴影」在视觉上把模型「踩稳」，
// 这是 Unity blob-shadow projector 同思路的轻量替代（无需 ARCore/ARKit）。

function _makeRadialShadowTexture(): DynamicTexture {
    const size = 256;
    const tex = new DynamicTexture('arContactShadowTex', size, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const r = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0.0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.30)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    tex.update();
    tex.hasAlpha = true;
    return tex;
}

function _makeContactShadowMaterial(tex: DynamicTexture): StandardMaterial {
    const mat = new StandardMaterial('arContactShadowMat', scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.backFaceCulling = false;
    return mat;
}

/** 取当前聚焦模型的世界 AABB 足迹（中心 XZ、脚底 Y、半径）。复刻 model-manager.focus 的算法。 */
function _getFocusedFootprint(): {
    cx: number;
    cz: number;
    bottomY: number;
    radius: number;
} | null {
    if (!focusedModelId) {
        return null;
    }
    const inst = modelRegistry.get(focusedModelId);
    if (!inst || inst.meshes.length === 0) {
        return null;
    }
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of inst.meshes) {
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        min.minimizeInPlace(bb.minimumWorld);
        max.maximizeInPlace(bb.maximumWorld);
    }
    const cx = (min.x + max.x) * 0.5;
    const cz = (min.z + max.z) * 0.5;
    const bottomY = min.y;
    const radius = Math.max(max.x - min.x, max.z - min.z) * 0.5 * 1.15;
    return { cx, cz, bottomY, radius };
}

function _createContactShadow(): void {
    _disposeContactShadow();
    const fp = _getFocusedFootprint();
    if (!fp) {
        return;
    }
    const tex = _makeRadialShadowTexture();
    const mat = _makeContactShadowMaterial(tex);
    const ground = MeshBuilder.CreateGround(
        'arContactShadow',
        { width: fp.radius * 2, height: fp.radius * 2, subdivisions: 1 },
        scene
    );
    ground.material = mat;
    ground.position.set(fp.cx, fp.bottomY + 0.02, fp.cz);
    ground.isPickable = false;
    ground.metadata = { arContactShadow: true };
    _contactShadow = ground;
}

function _disposeContactShadow(): void {
    if (_contactShadow) {
        const mat = _contactShadow.material;
        if (mat) {
            mat.dispose();
        }
        _contactShadow.dispose();
        _contactShadow = null;
    }
}

// ======== Public API ========

/**
 * 切换 AR 模式（摄像头视频背景 + 透明 canvas）。
 * 由 camera.ts 的 switchCameraMode('ar') 调用。
 */
export async function setARMode(enabled: boolean): Promise<boolean> {
    if (enabled) {
        const isMobile =
            'ontouchstart' in window ||
            navigator.maxTouchPoints > 0 ||
            window.matchMedia('(pointer: coarse)').matches;
        const facing: CameraFacing = isMobile ? 'environment' : 'user';
        const ok = await startARCamera(facing);
        if (!ok) {
            return false;
        }
        if (!_originalClearColor) {
            _originalClearColor = scene.clearColor.clone();
        }
        scene.clearColor = new Color4(0, 0, 0, 0);
        if (_envSys.sky.skyMesh && !_skyHidden) {
            _envSys.sky.skyMesh.setEnabled(false);
            _skyHidden = true;
        }
        _prevGazeState = {
            eye: getPerceptionState().eyeTrackingEnabled,
            head: getPerceptionState().headTrackingEnabled,
        };
        setEyeTrackingEnabled(true);
        setHeadTrackingEnabled(true);
        activatePerception();
        _createContactShadow();
        return true;
    } else {
        stopARCamera();
        _disposeContactShadow();
        if (_originalClearColor) {
            scene.clearColor = _originalClearColor;
            _originalClearColor = null;
        }
        if (_envSys.sky.skyMesh && _skyHidden) {
            _envSys.sky.skyMesh.setEnabled(true);
            _skyHidden = false;
        }
        if (_prevGazeState) {
            setEyeTrackingEnabled(_prevGazeState.eye);
            setHeadTrackingEnabled(_prevGazeState.head);
            activatePerception();
            _prevGazeState = null;
        }
        return true;
    }
}

/** AR 合成截图（视频底 + 3D 层），供截图功能调用。 */
export function takeARScreenshot(fmt: string, quality: number): string {
    return captureARScreenshot(fmt, quality);
}

export function isARModeActive(): boolean {
    return isARActive();
}
