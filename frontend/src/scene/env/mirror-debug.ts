// mirror-debug.ts — 调试用镜面道具
// 独立于 PlanarReflection 引擎，直接使用 Babylon MirrorTexture，
// 用于快速验证反射是否正常工作（地面/水面设置项太多，排查困难）。

import {
    Scene,
    Mesh,
    MeshBuilder,
    StandardMaterial,
    MirrorTexture,
    Color3,
    Color4,
    Vector3,
    Plane,
} from '@babylonjs/core';
import { getScene } from './env-impl';

let _mirrorMesh: Mesh | null = null;
let _mirrorRT: MirrorTexture | null = null;
let _mirrorMat: StandardMaterial | null = null;

const MIRROR_SIZE = 4;
const MIRROR_RESOLUTION = 512;

/**
 * 创建调试镜面：一个竖直朝向相机的平面，带 MirrorTexture 反射。
 * 用于快速验证反射管线是否正常（排除地面/水面复杂设置干扰）。
 */
export function createDebugMirror(): void {
    if (_mirrorMesh) {
        return;
    }
    const scene = getScene();

    // 创建竖直平面（正面朝 Z-）
    _mirrorMesh = MeshBuilder.CreatePlane(
        'debugMirror',
        { width: MIRROR_SIZE, height: MIRROR_SIZE },
        scene
    );
    _mirrorMesh.position = new Vector3(0, 1.5, -3);
    _mirrorMesh.isPickable = false;

    // MirrorTexture：反射场景中除自身外的所有 mesh
    _mirrorRT = new MirrorTexture('debugMirrorRT', MIRROR_RESOLUTION, scene, false);
    _mirrorRT.clearColor = new Color4(0, 0, 0, 0);
    _mirrorRT.mirrorPlane = new Plane(0, 0, 1, 0); // 朝 Z+ 的镜面
    _mirrorRT.level = 1; // 完全反射
    // 渲染列表：排除自身
    _mirrorRT.renderList = scene.meshes.filter((m) => m !== _mirrorMesh);

    // 简单材质：反射 + 微弱底色
    _mirrorMat = new StandardMaterial('debugMirrorMat', scene);
    _mirrorMat.diffuseColor = new Color3(0.1, 0.1, 0.15);
    _mirrorMat.specularColor = new Color3(0.5, 0.5, 0.5);
    _mirrorMat.reflectionTexture = _mirrorRT;
    _mirrorMat.backFaceCulling = false;

    _mirrorMesh.material = _mirrorMat;
}

/** 销毁调试镜面 */
export function disposeDebugMirror(): void {
    if (_mirrorRT) {
        _mirrorRT.dispose();
        _mirrorRT = null;
    }
    if (_mirrorMat) {
        _mirrorMat.dispose();
        _mirrorMat = null;
    }
    if (_mirrorMesh) {
        _mirrorMesh.dispose();
        _mirrorMesh = null;
    }
}

/** 调试镜面是否已创建 */
export function isDebugMirrorActive(): boolean {
    return _mirrorMesh !== null;
}

/** 切换调试镜面开/关 */
export function toggleDebugMirror(): boolean {
    if (_mirrorMesh) {
        disposeDebugMirror();
        return false;
    }
    createDebugMirror();
    return true;
}

/**
 * 刷新调试镜面的渲染列表（场景 mesh 变化后调用）。
 * 用于确保新加载的模型能出现在反射中。
 */
export function refreshDebugMirrorRenderList(): void {
    if (!_mirrorRT || !_mirrorMesh) {
        return;
    }
    _mirrorRT.renderList = getScene().meshes.filter((m) => m !== _mirrorMesh);
}
