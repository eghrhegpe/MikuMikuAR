// [doc:architecture] Scene Props — 场景道具管理
// 规范文档: docs/architecture.md §场景道具
// 职责: 道具加载、移除、变换、列表查询（独立于 modelRegistry / VMD / 物理）
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';

import {
    propRegistry,
    isLoadingProp,
    setIsLoadingProp,
    setStatus,
    triggerAutoSave,
    dom,
    PropInstance,
} from '../../core/config';
import { resolveFileUrl, normPath } from '../../core/fileservice';
import { scene } from '../scene';
import { _envSys } from './env';

// ======== 加载队列（替代简单的布尔锁） ========
// 允许多次 loadProp 调用依次执行，而非直接返回 null。
let _propLoadQueue: Promise<void> = Promise.resolve();

/**
 * 将下一次道具加载入队，确保串行执行。
 * 返回一个 Promise，在本次加载完成后 resolve。
 */
function enqueueLoad<T>(loader: () => Promise<T>): Promise<T> {
    const result = _propLoadQueue.then(loader, loader);
    _propLoadQueue = result.then(
        () => {},
        () => {}
    );
    return result;
}

// ======== 类型守卫 ========

function isValidPosition(pos: number[]): pos is [number, number, number] {
    return Array.isArray(pos) && pos.length === 3 && pos.every((v) => Number.isFinite(v));
}

function isValidScaling(s: number): boolean {
    return Number.isFinite(s) && s > 0;
}

// ======== 加载 ========

export async function loadProp(filePath: string): Promise<string | null> {
    // 通过队列保证串行加载，不再需要直接返回 null
    return enqueueLoad(async () => {
        if (isLoadingProp) {
            // 队列中如果上一个任务还未开始（理论上不会发生），等待即可
            return null;
        }
        setIsLoadingProp(true);

        // 使用 rAF 调度 DOM 操作，避免 onProgress 在非主线程回调中直接操作 DOM
        const updateLoadingText = (text: string) => {
            requestAnimationFrame(() => {
                dom.loadingText.textContent = text;
            });
        };
        let loadedMeshes: Mesh[] = [];

        try {
            dom.loadingEl.style.display = 'block';
            updateLoadingText('加载道具 0%');

            console.info('[props] loadProp:', filePath);

            // 检查是否已加载
            for (const [, inst] of propRegistry) {
                if (inst.filePath === filePath) {
                    setStatus(`道具已存在: ${inst.name}`, false);
                    return inst.id;
                }
            }

            const { url, port, dir: modelDir } = await resolveFileUrl(filePath);
            const fileName = normPath(filePath).split('/').pop() || '';
            setStatus('加载道具...', false);

            const result = await ImportMeshAsync(url, scene, {
                onProgress: (evt) => {
                    if (evt.lengthComputable) {
                        const pct = Math.round((evt.loaded / evt.total) * 100);
                        updateLoadingText(`加载道具 ${pct}%`);
                    }
                },
            });

            loadedMeshes = result.meshes.filter((m) => m instanceof Mesh) as Mesh[];

            if (loadedMeshes.length === 0) {
                setStatus('✗ 道具未加载到网格', false);
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

            // 阴影集成
            if (_envSys.shadow.generator) {
                for (const m of inst.meshes) {
                    _envSys.shadow.generator.addShadowCaster(m);
                    m.receiveShadows = true;
                }
            }

            setStatus(`✓ 道具: ${displayName}`, true);
            triggerAutoSave();
            console.info('[props] load complete:', id, displayName);
            return id;
        } catch (err) {
            console.error('[props] loadProp:', err);
            // 清理已加载但未注册的资源
            loadedMeshes.forEach((m) => {
                try {
                    m.dispose();
                } catch {
                    // Intentionally empty — 回滚阶段单个 mesh dispose 失败不影响整体清理
                }
            });
            setStatus('✗ 道具加载失败', false);
            return null;
        } finally {
            setIsLoadingProp(false);
            requestAnimationFrame(() => {
                dom.loadingEl.style.display = 'none';
            });
        }
    });
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

    propRegistry.delete(id);
    setStatus(`✓ 已移除道具: ${inst.name}`, true);
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
            console.warn('[props] setPropTransform: 无效的 position', partial.position);
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
            console.warn('[props] setPropTransform: 无效的 scaling', partial.scaling);
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

// ======== 查询 ========

export function getPropList(): PropInstance[] {
    return Array.from(propRegistry.values());
}
