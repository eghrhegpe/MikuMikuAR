// [doc:architecture] Scene Props — 场景道具管理
// 规范文档: docs/architecture.md §场景道具
// 职责: 道具加载、移除、变换、列表查询（独立于 modelRegistry / VMD / 物理）
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { propRegistry, setStatus, triggerAutoSave, dom, PropInstance } from '@/core/config';
import { resolveFileUrl } from '@/core/fileservice';
import { orbitToCartesian, cartesianToOrbit, normalizeOrbit } from '@/core/orbit';
import { scene } from '../scene';
import { _envSys } from './env';
import { registerMaterialTarget, unregisterMaterialTarget } from '../manager/material';
import { t } from '@/core/i18n/t';
import { getBaseName, logWarn, logError } from '@/core/utils';
import { renderPropThumbnail } from '../manager/thumbnail-capture';
import { thumbnailBaseKey } from '../manager/thumbnail-key';
import {
    attachGizmo,
    detachGizmo,
    isGizmoActive,
    getGizmoTargetId,
} from '../render/transform-gizmo';

// ======== 类型守卫 ========

function isValidPosition(pos: number[]): pos is [number, number, number] {
    return Array.isArray(pos) && pos.length === 3 && pos.every((v) => Number.isFinite(v));
}

function isValidScaling(s: number): boolean {
    return Number.isFinite(s) && s > 0;
}

// ======== 加载 ========

export async function loadProp(filePath: string, signal?: AbortSignal): Promise<string | null> {
    // 使用 rAF 调度 DOM 操作，避免 onProgress 在非主线程回调中直接操作 DOM
    const updateLoadingText = (text: string) => {
        requestAnimationFrame(() => {
            dom.loadingText.textContent = text;
        });
    };
    let loadedMeshes: Mesh[] = [];

    // [adr-105] AbortSignal：允许外部取消；内部 AbortController 合并外部 signal
    let abortCtrl: AbortController | undefined;
    let effectiveSignal: AbortSignal;
    if (signal) {
        effectiveSignal = signal;
    } else {
        abortCtrl = new AbortController();
        effectiveSignal = abortCtrl.signal;
    }

    try {
        dom.loadingEl.style.display = 'block';
        updateLoadingText(t('props.loadingProgress', { pct: '0' }));

        console.info('[props] loadProp:', filePath);

        // 检查是否已加载
        for (const [, inst] of propRegistry) {
            if (inst.filePath === filePath) {
                setStatus(t('env.propExists', { name: inst.name }), false);
                return inst.id;
            }
        }

        const { url, port, dir: modelDir } = await resolveFileUrl(filePath);
        if (effectiveSignal.aborted) {
            return null;
        }
        const fileName = getBaseName(filePath) || '';
        setStatus(t('props.loading'), false);

        // [doc:adr-057] URL 使用 ?f=base64url 形式无扩展名，需显式指定 pluginExtension
        // 否则 SceneLoader 无法识别文件类型，回退到 JSON 解析导致 importMesh has failed JSON parse
        const result = await ImportMeshAsync(url, scene, {
            pluginExtension: '.pmx',
            onProgress: (evt) => {
                if (effectiveSignal.aborted) {
                    return;
                }
                if (evt.lengthComputable) {
                    const pct = Math.round((evt.loaded / evt.total) * 100);
                    updateLoadingText(t('props.loadingProgress', { pct: String(pct) }));
                }
            },
        });

        // [adr-105] 取消后清理已加载资源
        if (effectiveSignal.aborted) {
            result.meshes.forEach((m) => {
                try {
                    m.dispose();
                } catch {
                    // ignore
                }
            });
            return null;
        }

        loadedMeshes = result.meshes.filter((m) => m instanceof Mesh) as Mesh[];

        if (loadedMeshes.length === 0) {
            setStatus(t('props.noMesh'), false);
            return null;
        }

        const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const displayName = fileName.replace(/\.pmx$/i, '');

        // 创建父级 TransformNode，统一管理所有网格的变换
        const container = new TransformNode(`prop_container_${id}`, scene);
        for (const m of loadedMeshes) {
            m.parent = container;
        }

        const inst: PropInstance = {
            id,
            name: displayName,
            filePath,
            port,
            modelDir,
            meshes: loadedMeshes,
            rootMesh: loadedMeshes[0],
            container,
            position: [0, 0, 0],
            rotationY: 0,
            scaling: 1.0,
            visible: true,
        };
        propRegistry.set(id, inst);

        // 注册到材质系统，使 prop 可用 model 一致的材质 API
        registerMaterialTarget(id, loadedMeshes);

        // 阴影集成
        if (_envSys.shadow.generator) {
            for (const m of inst.meshes) {
                _envSys.shadow.generator.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }

        setStatus(t('env.propAdded', { name: displayName }), true);
        triggerAutoSave();
        console.info('[props] load complete:', id, displayName);

        // [fix:prop-thumbnail] 加载成功后离屏渲染道具缩略图并缓存。
        // 经统一 thumbnailBaseKey 收口（与模型写侧 / library-core 读侧同源），杜绝双源拼接反弹。
        // 道具无 innerPath（不支持 zip 内），故仅 filePath 入参；kind='prop' → isStageLike 命中 16/9。
        // fire-and-forget + catch，不阻塞加载主流程；共享 _thumbMutex 串行化。
        void renderPropThumbnail(scene, inst, thumbnailBaseKey({ filePath: inst.filePath })).catch(
            (thumbErr) => {
                logWarn('props', 'renderPropThumbnail:', thumbErr);
            }
        );

        return id;
    } catch (err) {
        // [adr-105] AbortError 不算错误：取消是正常流程，不打 console.error
        if (err instanceof DOMException && err.name === 'AbortError') {
            console.info('[props] loadProp aborted:', filePath);
        } else {
            logError('props', 'loadProp:', err);
        }
        // 清理已加载但未注册的资源
        loadedMeshes.forEach((m) => {
            try {
                m.dispose();
            } catch {
                // Intentionally empty — 回滚阶段单个 mesh dispose 失败不影响整体清理
            }
        });
        setStatus(t('props.loadFailed'), false);
        return null;
    } finally {
        abortCtrl?.abort(); // 清理内部 AbortController
        requestAnimationFrame(() => {
            dom.loadingEl.style.display = 'none';
        });
    }
}

// ======== 移除 ========

export function removeProp(id: string): void {
    const inst = propRegistry.get(id);
    if (!inst) {
        return;
    }

    console.info('[props] removeProp:', inst.name);

    // 从阴影生成器中移除（防止悬空引用）
    if (_envSys.shadow.generator) {
        for (const m of inst.meshes) {
            try {
                _envSys.shadow.generator.removeShadowCaster(m);
            } catch {
                // Intentionally empty — 移除阴影投射器失败不影响道具销毁主流程
            }
        }
    }

    for (const m of inst.meshes) {
        scene.removeMesh(m);
        m.dispose();
    }

    // 释放父级容器
    if (inst.container) {
        inst.container.dispose();
    }

    // 注销材质系统注册（同时清理材质状态）
    unregisterMaterialTarget(id);

    propRegistry.delete(id);
    setStatus(t('env.propRemoved', { name: inst.name }), true);
    triggerAutoSave();
}

// ======== 变换 ========

export function setPropTransform(
    id: string,
    partial: Partial<Pick<PropInstance, 'position' | 'rotationY' | 'scaling' | 'visible'>>
): void {
    const inst = propRegistry.get(id);
    if (!inst) {
        return;
    }

    // 优先使用 container（多网格父级容器），否则回退到 rootMesh
    const target = inst.container ?? inst.rootMesh;

    if (partial.position !== undefined) {
        if (!isValidPosition(partial.position)) {
            logWarn('props', 'setPropTransform: 无效的 position', partial.position);
            return;
        }
        inst.position = partial.position;
        target.position.set(partial.position[0], partial.position[1], partial.position[2]);
    }
    if (partial.rotationY !== undefined) {
        inst.rotationY = partial.rotationY;
        target.rotation.y = partial.rotationY;
    }
    if (partial.scaling !== undefined) {
        if (!isValidScaling(partial.scaling)) {
            logWarn('props', 'setPropTransform: 无效的 scaling', partial.scaling);
            return;
        }
        inst.scaling = partial.scaling;
        target.scaling.setAll(partial.scaling);
    }
    if (partial.visible !== undefined) {
        inst.visible = partial.visible;
        for (const m of inst.meshes) {
            m.setEnabled(partial.visible);
        }
        // 若使用 container，同步其可见性
        if (inst.container) {
            inst.container.setEnabled(partial.visible);
        }
    }
    triggerAutoSave();
}

// ======== [doc:adr-049] 球面坐标轨道控制 ========

/** 以球面坐标（方位角/仰角/距离）定位道具，等价于围绕原点旋转。 */
export function setPropOrbit(
    id: string,
    azimuth: number,
    elevation: number,
    distance: number
): void {
    const inst = propRegistry.get(id);
    if (!inst) {
        return;
    }
    // 边界保护：钳制到合法值域（绝不产生 NaN / 退化），损坏场景文件反序列化也能安全定位。
    const invalid =
        !Number.isFinite(azimuth) ||
        !Number.isFinite(elevation) ||
        !Number.isFinite(distance) ||
        distance <= 0 ||
        elevation < -90 ||
        elevation > 90;
    const o = normalizeOrbit(azimuth, elevation, distance);
    if (invalid) {
        logWarn('props', 'setPropOrbit: 输入越界已钳制', {
            azimuth,
            elevation,
            distance,
            result: o,
        });
    }
    inst.positionMode = 'orbit';
    inst.orbitAzimuth = o.azimuth;
    inst.orbitElevation = o.elevation;
    inst.orbitDistance = o.distance;
    const [x, y, z] = orbitToCartesian(o.azimuth, o.elevation, o.distance);
    inst.position = [x, y, z];
    const target = inst.container ?? inst.rootMesh;
    target.position.set(x, y, z);
    triggerAutoSave();
}

/** 读取道具当前球面坐标。orbit 模式下返回存储值，否则从当前笛卡尔位置反推。 */
export function getPropOrbit(
    id: string
): { azimuth: number; elevation: number; distance: number } | null {
    const inst = propRegistry.get(id);
    if (!inst) {
        return null;
    }
    if (
        inst.positionMode === 'orbit' &&
        inst.orbitAzimuth !== undefined &&
        inst.orbitElevation !== undefined &&
        inst.orbitDistance !== undefined
    ) {
        return {
            azimuth: inst.orbitAzimuth,
            elevation: inst.orbitElevation,
            distance: inst.orbitDistance,
        };
    }
    const [x, y, z] = inst.position;
    return cartesianToOrbit(x, y, z);
}

/** 切换坐标模式。切到 orbit 时从当前笛卡尔位置反推球面参数（无跳变）；切回 cartesian 保留当前位置。 */
export function setPropPositionMode(id: string, mode: 'cartesian' | 'orbit'): void {
    const inst = propRegistry.get(id);
    if (!inst) {
        return;
    }
    if (mode === 'orbit') {
        const o = cartesianToOrbit(inst.position[0], inst.position[1], inst.position[2]);
        inst.orbitAzimuth = o.azimuth;
        inst.orbitElevation = o.elevation;
        inst.orbitDistance = o.distance;
    }
    inst.positionMode = mode;
    triggerAutoSave();
}

/** 读取道具当前坐标模式（默认 'cartesian'）。 */
export function getPropPositionMode(id: string): 'cartesian' | 'orbit' {
    const inst = propRegistry.get(id);
    return inst?.positionMode ?? 'cartesian';
}

// ======== Prop Gizmo (→ transform-gizmo.ts) ========

/**
 * 为道具激活 3D 拖拽 Gizmo（PositionGizmo）。
 * 拖拽结束后自动通过 setPropTransform 持久化。
 */
export function attachPropGizmo(id: string): boolean {
    const inst = propRegistry.get(id);
    if (!inst) {
        return false;
    }
    const node = inst.container ?? inst.rootMesh;
    if (!node) {
        return false;
    }

    return attachGizmo({
        id,
        node,
        types: ['position'],
        onPositionDragEnd: () => {
            // node 已在上方验证为 TransformNode，直接读取更新后的位置
            const v = node.position;
            setPropTransform(id, { position: [v.x, v.y, v.z] });
        },
    });
}

export {
    detachGizmo as detachPropGizmo,
    isGizmoActive as isPropGizmoActive,
    getGizmoTargetId as getPropGizmoTargetId,
};

// ======== 查询 ========

export function getPropList(): PropInstance[] {
    return Array.from(propRegistry.values());
}
