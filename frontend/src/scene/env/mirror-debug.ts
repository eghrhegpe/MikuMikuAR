// mirror-debug.ts — 镜面道具（场景反射道具）
// 独立于 PlanarReflection 引擎，直接使用 Babylon MirrorTexture。
// 最初为调试反射问题而生，现已升级为常态化场景道具（ADR-128）。

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
} from '@babylonjs/core';
import { getScene } from './_shared/env-context';
import { envState, triggerAutoSave } from '@/core/config';
import { setEnvState } from './_bridge/env-bridge';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { setTransformMetadata } from '../transform/transform-pick';
import {
    registerTransformAdapter,
    getGizmoTargetId,
    onGizmoDragObservable,
} from '../transform/transform-adapter';

/** 镜面在 TransformAdapter 注册表中的唯一 ID（镜面为单例）。 */
const MIRROR_ID = 'mirror';

let _mirrorMesh: Mesh | null = null;
let _mirrorRT: MirrorTexture | null = null;
let _mirrorMat: StandardMaterial | null = null;
// 场景网格增删观察者：镜面激活期间自动刷新反射列表（新加载的 MMD 角色等）
let _meshAddedObserver: ObserverHandle | null = null;
let _meshRemovedObserver: ObserverHandle | null = null;
// Gizmo 拖拽中实时刷新反射平面（位置/朝向联动）
let _gizmoDragObserver: ObserverHandle | null = null;

// 几何参数现驻留 envState（ADR: mirror 持久化收口），模块内不再持有副本；
// 默认值与 env-state-schema.ts 中 mirrorWidth/mirrorHeight/mirrorPosition/mirrorRotationY 一致。

/** 统一反射分辨率映射：envState.reflectionQuality → 实际像素 */
const RESOLUTION_MAP: Record<string, number> = { high: 2048, medium: 1024, low: 512, off: 0 };

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
export function updateMirrorClearColor(): void {
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
 * 创建镜面道具：竖直平面 + MirrorTexture 反射。
 * 反射列表包含场景全部 mesh（含天空球、地面、水面、角色）。
 */
export function createMirror(): void {
    if (_mirrorMesh) {
        return;
    }
    const scene = getScene();

    // 创建竖直平面（几何参数取自 envState，保证持久化恢复后按存档尺寸重建）
    _mirrorMesh = MeshBuilder.CreatePlane(
        'mirror',
        { width: envState.mirrorWidth, height: envState.mirrorHeight },
        scene
    );
    // Pivot 移到底边：平面默认 y 从 -h/2 到 +h/2，bakeTransform 上移 h/2 后底边在 y=0
    _mirrorMesh.bakeTransformIntoVertices(Matrix.Translation(0, envState.mirrorHeight / 2, 0));
    _mirrorMesh.position = new Vector3(
        envState.mirrorPosition[0],
        envState.mirrorPosition[1],
        envState.mirrorPosition[2]
    );
    _mirrorMesh.rotation.y = envState.mirrorRotationY;
    // 挂 transform metadata + 可拾取，接入场景拖拽模式（ADR-171 / ADR-126）
    _mirrorMesh.isPickable = true;
    setTransformMetadata(_mirrorMesh, 'mirror', MIRROR_ID);

    // MirrorTexture：反射全部 mesh
    const resolution = RESOLUTION_MAP[envState.reflectionQuality] ?? 512;
    if (!resolution) {
        disposeMirror();
        return;
    }
    _mirrorRT = new MirrorTexture('mirrorRT', resolution, scene, false);
    _mirrorRT.level = 1; // 完全反射
    _mirrorRT.adaptiveBlurKernel = 0; // 关闭模糊，锐利反射便于排查
    updateMirrorClearColor(); // 根据当前天空模式设置 clearColor

    // 镜面法线随 mesh 位置/旋转联动，从世界矩阵实时计算
    _updateMirrorPlane();

    // Gizmo 拖拽中实时刷新反射平面（拖拽结束由 adapter 回写参数）
    _gizmoDragObserver = observe(onGizmoDragObservable, () => {
        if (getGizmoTargetId() === MIRROR_ID) {
            _updateMirrorPlane();
        }
    });

    // 渲染列表：全部 mesh 排除自身
    _mirrorRT.renderList = scene.meshes.filter((m) => m !== _mirrorMesh);

    // 场景网格增删时自动刷新反射列表（如先建镜子后加载 MMD 角色，角色需进入反射）
    _meshAddedObserver = observe(scene.onNewMeshAddedObservable, () => refreshMirrorRenderList());
    _meshRemovedObserver = observe(scene.onMeshRemovedObservable, () => refreshMirrorRenderList());

    // 材质：低反照率底色 + 强反射，便于区分反射内容
    _mirrorMat = new StandardMaterial('mirrorMat', scene);
    _mirrorMat.diffuseColor = new Color3(0.05, 0.05, 0.08);
    _mirrorMat.specularColor = new Color3(1, 1, 1);
    _mirrorMat.specularPower = 64;
    _mirrorMat.reflectionTexture = _mirrorRT;
    _mirrorMat.backFaceCulling = false;

    _mirrorMesh.material = _mirrorMat;
}

/** 销毁镜面 */
export function disposeMirror(): void {
    // [fix P3] 移除未使用变量 _scene：此前取 getScene() 后全程未用，若 scene 未初始化
    // 会抛错使 dispose 在 init 前调用时崩溃而非安全降级
    if (_gizmoDragObserver) {
        _gizmoDragObserver.dispose();
        _gizmoDragObserver = null;
    }
    if (_meshAddedObserver) {
        _meshAddedObserver.dispose();
        _meshAddedObserver = null;
    }
    if (_meshRemovedObserver) {
        _meshRemovedObserver.dispose();
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

export function isMirrorActive(): boolean {
    return _mirrorMesh !== null;
}

export function toggleMirror(): boolean {
    if (_mirrorMesh) {
        disposeMirror();
        setEnvState({ mirrorEnabled: false }, true);
        triggerAutoSave();
        return false;
    }
    createMirror();
    setEnvState({ mirrorEnabled: true }, true);
    triggerAutoSave();
    return true;
}

/** 刷新渲染列表（模型加载/卸载后调用） */
export function refreshMirrorRenderList(): void {
    if (!_mirrorRT || !_mirrorMesh) {
        return;
    }
    _mirrorRT.renderList = getScene().meshes.filter((m) => m !== _mirrorMesh);
}

// ======== 参数设置 API ========

export function setMirrorSize(width: number, height: number): void {
    setEnvState(
        { mirrorWidth: Math.max(0.5, width), mirrorHeight: Math.max(0.5, height) },
        true
    );
    triggerAutoSave();
    // pivot 由 bakeTransform 写入顶点，改尺寸需重建
    if (_mirrorMesh) {
        disposeMirror();
        createMirror();
    }
}

export function setMirrorPosition(x: number, y: number, z: number): void {
    setEnvState({ mirrorPosition: [x, y, z] }, true);
    triggerAutoSave();
    if (_mirrorMesh) {
        _mirrorMesh.position.set(x, y, z);
        _updateMirrorPlane();
    }
}

export function setMirrorRotationY(rad: number): void {
    setEnvState({ mirrorRotationY: rad }, true);
    triggerAutoSave();
    if (_mirrorMesh) {
        _mirrorMesh.rotation.y = rad;
        _updateMirrorPlane();
    }
}

export function setMirrorResolution(res: number): void {
    // 统一反射分辨率：将像素值反向映射到 quality 枚举，经 setEnvState 写入（不直接写 envState）
    let quality: 'high' | 'medium' | 'low' | 'off';
    if (res >= 2048) {
        quality = 'high';
    } else if (res >= 1024) {
        quality = 'medium';
    } else if (res >= 512) {
        quality = 'low';
    } else {
        quality = 'off';
    }
    setEnvState({ reflectionQuality: quality });
    // 需要重建才生效
    if (_mirrorRT) {
        const wasActive = isMirrorActive();
        disposeMirror();
        if (wasActive) {
            createMirror();
        }
    }
}

export function getMirrorInfo(): {
    active: boolean;
    position: [number, number, number];
    width: number;
    height: number;
    resolution: number;
    meshCount: number;
} {
    return {
        active: isMirrorActive(),
        position: envState.mirrorPosition,
        width: envState.mirrorWidth,
        height: envState.mirrorHeight,
        resolution: RESOLUTION_MAP[envState.reflectionQuality] ?? 512,
        meshCount: _mirrorRT?.renderList?.length ?? 0,
    };
}

// ======== Transform Adapter (ADR-126: 场景拖拽模式接入) ========
// 位置/水平旋转由 3D Gizmo 实时拖拽（场景拖拽模式），拖拽结束回写模块参数。
// 反射平面已由 _gizmoDragObserver 在拖拽中实时联动，无需在此刷新。

registerTransformAdapter({
    kinds: ['mirror'],
    getNode: (id) => (id === MIRROR_ID ? _mirrorMesh : null),
    gizmoTypes: () => ['position', 'rotation'],
    onPositionDragEnd: (_id, n) => {
        const v = (n as unknown as { position: Vector3 }).position;
        setMirrorPosition(v.x, v.y, v.z);
    },
    onRotationDragEnd: (_id, n) => {
        const v = (n as unknown as { rotation: Vector3 }).rotation;
        setMirrorRotationY(v.y);
    },
    capabilities: [],
});
