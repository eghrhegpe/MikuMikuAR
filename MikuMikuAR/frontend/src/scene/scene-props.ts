// [doc:architecture] Scene Props — 场景道具管理
// 规范文档: docs/architecture.md §场景道具
// 职责: 道具加载、移除、变换、列表查询（独立于 modelRegistry / VMD / 物理）
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";

import {
    propRegistry, setPropRegistry,
    isLoadingProp, setIsLoadingProp,
    setStatus, triggerAutoSave,
    dom, PropInstance,
} from "../core/config";
import { resolveFileUrl, normPath } from "../core/fileservice";
import { scene } from "./scene";
import { _envSys } from "./scene-env";

export async function loadProp(filePath: string): Promise<string | null> {
    if (isLoadingProp) return null;
    setIsLoadingProp(true);
    dom.loadingEl.style.display = "block";
    dom.loadingText.textContent = "加载道具 0%";
    try {
        for (const [, inst] of propRegistry) {
            if (inst.filePath === filePath) {
                setStatus(`道具已存在: ${inst.name}`, false);
                return inst.id;
            }
        }

        const { url, port, dir: modelDir } = await resolveFileUrl(filePath);
        const fileName = normPath(filePath).split("/").pop() || "";
        setStatus("加载道具...", false);

        const result = await ImportMeshAsync(url, scene, {
            onProgress: (evt) => {
                if (evt.lengthComputable) {
                    const pct = Math.round((evt.loaded / evt.total) * 100);
                    dom.loadingText.textContent = `加载道具 ${pct}%`;
                }
            },
        });

        const meshes = result.meshes.filter(m => m instanceof Mesh) as Mesh[];
        if (meshes.length === 0) {
            setStatus("✗ 道具未加载到网格", false);
            return null;
        }

        const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const displayName = fileName.replace(/\.pmx$/i, "");
        const inst: PropInstance = {
            id, name: displayName, filePath, port, modelDir,
            meshes, rootMesh: meshes[0],
            position: [0, 0, 0], rotationY: 0, scaling: 1.0, visible: true,
        };
        propRegistry.set(id, inst);

        if (_envSys.shadow.generator) {
            for (const m of inst.meshes) {
                _envSys.shadow.generator.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }

        setStatus(`✓ 道具: ${displayName}`, true);
        triggerAutoSave();
        return id;
    } catch (err) {
        console.error("loadProp:", err);
        setStatus("✗ 道具加载失败", false);
        return null;
    } finally {
        setIsLoadingProp(false);
        dom.loadingEl.style.display = "none";
    }
}

export function removeProp(id: string): void {
    const inst = propRegistry.get(id);
    if (!inst) return;
    for (const m of inst.meshes) {
        scene.removeMesh(m);
        m.dispose();
    }
    propRegistry.delete(id);
    setStatus(`✓ 已移除道具: ${inst.name}`, true);
    triggerAutoSave();
}

export function setPropTransform(id: string, partial: Partial<Pick<PropInstance, "position" | "rotationY" | "scaling" | "visible">>): void {
    const inst = propRegistry.get(id);
    if (!inst) return;
    if (partial.position !== undefined) {
        inst.position = partial.position;
        inst.rootMesh.position.set(partial.position[0], partial.position[1], partial.position[2]);
    }
    if (partial.rotationY !== undefined) {
        inst.rotationY = partial.rotationY;
        inst.rootMesh.rotation.y = partial.rotationY;
    }
    if (partial.scaling !== undefined) {
        inst.scaling = partial.scaling;
        inst.rootMesh.scaling.setAll(partial.scaling);
    }
    if (partial.visible !== undefined) {
        inst.visible = partial.visible;
        for (const m of inst.meshes) m.setEnabled(partial.visible);
    }
    triggerAutoSave();
}

export function getPropList(): PropInstance[] {
    return Array.from(propRegistry.values());
}
