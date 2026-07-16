// mirror-debug.ts — 调试用镜面道具
// 独立于 PlanarReflection 引擎，直接使用 Babylon MirrorTexture，
// 用于快速验证反射是否正常工作（地面/水面设置项太多，排查困难）。

import {
    Mesh,
    MeshBuilder,
    StandardMaterial,
    MirrorTexture,
    Color3,
    Color4,
    Vector3,
    Plane,
    Matrix,
    AbstractMesh,
} from '@babylonjs/core';
import type { Observer } from '@babylonjs/core';
import { getScene } from './env-impl';
import { envState } from '@/core/config';

let _mirrorMesh: Mesh | null = null;
let _mirrorRT: MirrorTexture | null = null;
let _mirrorMat: StandardMaterial | null = null;
// 场景网格增删观察者：镜面激活期间自动刷新反射列表（新加载的 MMD 角色等）
let _meshAddedObserver: Observer<AbstractMesh> | null = null;
let _meshRemovedObserver: Observer<AbstractMesh> | null = null;

// 可调参数（通过 API 修改，下次 create 时生效）
let _mirrorWidth = 22;
let _mirrorHeight = 19;
let _mirrorResolution = 512;
let _mirrorPosition: [number, number, number] = [0, 1.5, 4];
let _mirrorRotationY = 0; // 水平旋转（弧度）

/** 从当前 mesh 世界矩阵更新 mirrorPlane，使反射平面与 mesh 实际位置/朝向一致。 */
function _updateMirrorPlane(): void {
    if (!_mirrorMesh || !_mirrorRT) {
        return;
    }
    // CreatePlane 局部法线为 (0,0,1)，经世界矩阵变换得到世界法线
    const normal = Vector3.TransformNormal(
        new Vector3(0, 0, 1),
        _mirrorMesh.getWorldMatrix()
    ).normalize();
    const position = _mirrorMesh.getAbsolutePosition();
    _mirrorRT.mirrorPlane = Plane.FromPositionAndNormal(position, normal);
}

/** 同步 RT clearColor 与当前天空模式一致：
 *  - color 模式：用 scene.clearColor（天空色），使纯净的天空色在镜子中可见
 *  - 其他模式：透明黑，由反射内容自然叠加 */
export function updateDebugMirrorClearColor(): void {
    if (!_mirrorRT) {
        return;
    }
    const scene = getScene();
    if (envState.skyMode === 'color') {
        _mirrorRT.clearColor = scene.clearColor.clone();
    } else {
        _mirrorRT.clearColor = new Color4(0, 0, 0, 0);
    }
}

/**
 * 创建调试镜面：竖直平面 + MirrorTexture 反射。
 * 反射列表包含场景全部 mesh（含天空球、地面、水面、角色）。
 */
export function createDebugMirror(): void {
    if (_mirrorMesh) {
        return;
    }
    const scene = getScene();

    // 创建竖直平面
    _mirrorMesh = MeshBuilder.CreatePlane(
        'debugMirror',
        { width: _mirrorWidth, height: _mirrorHeight },
        scene
    );
    // Pivot 移到底边：平面默认 y 从 -h/2 到 +h/2，bakeTransform 上移 h/2 后底边在 y=0
    _mirrorMesh.bakeTransformIntoVertices(Matrix.Translation(0, _mirrorHeight / 2, 0));
    _mirrorMesh.position = new Vector3(_mirrorPosition[0], _mirrorPosition[1], _mirrorPosition[2]);
    _mirrorMesh.rotation.y = _mirrorRotationY;
    _mirrorMesh.isPickable = false;

    // MirrorTexture：反射全部 mesh
    _mirrorRT = new MirrorTexture('debugMirrorRT', _mirrorResolution, scene, false);
    _mirrorRT.level = 1; // 完全反射
    _mirrorRT.adaptiveBlurKernel = 0; // 关闭模糊，锐利反射便于排查
    updateDebugMirrorClearColor(); // 根据当前天空模式设置 clearColor

    // 镜面法线随 mesh 位置/旋转联动，从世界矩阵实时计算
    _updateMirrorPlane();

    // 渲染列表：全部 mesh 排除自身
    _mirrorRT.renderList = scene.meshes.filter((m) => m !== _mirrorMesh);

    // 场景网格增删时自动刷新反射列表（如先建镜子后加载 MMD 角色，角色需进入反射）
    _meshAddedObserver = scene.onNewMeshAddedObservable.add(() => refreshDebugMirrorRenderList());
    _meshRemovedObserver = scene.onMeshRemovedObservable.add(() => refreshDebugMirrorRenderList());

    // 材质：低反照率底色 + 强反射，便于区分反射内容
    _mirrorMat = new StandardMaterial('debugMirrorMat', scene);
    _mirrorMat.diffuseColor = new Color3(0.05, 0.05, 0.08);
    _mirrorMat.specularColor = new Color3(1, 1, 1);
    _mirrorMat.specularPower = 64;
    _mirrorMat.reflectionTexture = _mirrorRT;
    _mirrorMat.backFaceCulling = false;

    _mirrorMesh.material = _mirrorMat;
}

/** 销毁调试镜面 */
export function disposeDebugMirror(): void {
    const scene = getScene();
    if (_meshAddedObserver) {
        scene.onNewMeshAddedObservable.remove(_meshAddedObserver);
        _meshAddedObserver = null;
    }
    if (_meshRemovedObserver) {
        scene.onMeshRemovedObservable.remove(_meshRemovedObserver);
        _meshRemovedObserver = null;
    }
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

export function isDebugMirrorActive(): boolean {
    return _mirrorMesh !== null;
}

export function toggleDebugMirror(): boolean {
    if (_mirrorMesh) {
        disposeDebugMirror();
        return false;
    }
    createDebugMirror();
    return true;
}

/** 刷新渲染列表（模型加载/卸载后调用） */
export function refreshDebugMirrorRenderList(): void {
    if (!_mirrorRT || !_mirrorMesh) {
        return;
    }
    _mirrorRT.renderList = getScene().meshes.filter((m) => m !== _mirrorMesh);
}

// ======== 参数设置 API ========

export function setDebugMirrorSize(width: number, height: number): void {
    _mirrorWidth = Math.max(0.5, width);
    _mirrorHeight = Math.max(0.5, height);
    // pivot 由 bakeTransform 写入顶点，改尺寸需重建
    if (_mirrorMesh) {
        disposeDebugMirror();
        createDebugMirror();
    }
}

export function setDebugMirrorPosition(x: number, y: number, z: number): void {
    _mirrorPosition = [x, y, z];
    if (_mirrorMesh) {
        _mirrorMesh.position.set(x, y, z);
        _updateMirrorPlane();
    }
}

export function setDebugMirrorRotationY(rad: number): void {
    _mirrorRotationY = rad;
    if (_mirrorMesh) {
        _mirrorMesh.rotation.y = rad;
        _updateMirrorPlane();
    }
}

export function setDebugMirrorResolution(res: number): void {
    _mirrorResolution = Math.max(64, Math.min(2048, res));
    // 需要重建才生效，标记即可
    if (_mirrorRT) {
        // 简单方案：dispose 重建
        const wasActive = isDebugMirrorActive();
        disposeDebugMirror();
        if (wasActive) {
            createDebugMirror();
        }
    }
}

export function getDebugMirrorInfo(): {
    active: boolean;
    position: [number, number, number];
    width: number;
    height: number;
    resolution: number;
    meshCount: number;
} {
    return {
        active: isDebugMirrorActive(),
        position: _mirrorPosition,
        width: _mirrorWidth,
        height: _mirrorHeight,
        resolution: _mirrorResolution,
        meshCount: _mirrorRT?.renderList?.length ?? 0,
    };
}
