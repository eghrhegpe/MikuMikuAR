// Scene menu — consolidated camera + lighting controls (MenuStack-based).

import {
    dom, closeAllOverlays, setStatus,
    PopupRow, PopupLevel,
} from "./config";
import { MenuStack } from "./menu";
import { switchCameraMode, getCameraMode } from "./camera";
import { getLightState, setLightState, triggerAutoSave, serializeScene, deserializeScene } from "./scene";
import { SelectSceneSaveFile, SelectSceneOpenFile, SaveSceneFile, LoadSceneFile } from "../wailsjs/go/main/App";

// ======== Scene Menu (MenuStack) ========

let sceneStack: MenuStack | null = null;

function buildSceneRoot(): PopupLevel {
    return {
        label: "场景",
        dir: "",
        items: [
            { kind: "folder", label: "相机模式", icon: "camera", target: "scene:camera" },
            { kind: "folder", label: "灯光", icon: "sun", target: "scene:light" },
            { kind: "action", label: "保存场景", icon: "save", target: "scene:save" },
            { kind: "action", label: "加载场景", icon: "upload", target: "scene:load" },
        ],
    };
}

function buildCameraLevel(): PopupLevel {
    const currentMode = getCameraMode();
    return {
        label: "相机模式",
        dir: "",
        items: [
            { kind: "action", label: "轨道", icon: currentMode === "orbit" ? "check" : "circle", target: "camera:orbit", sublabel: "默认轨道相机" },
            { kind: "action", label: "自由飞行", icon: currentMode === "freefly" ? "check" : "circle", target: "camera:freefly", sublabel: "WASD 自由移动" },
            { kind: "action", label: "镜头预设", icon: currentMode === "oneshot" ? "check" : "circle", target: "camera:oneshot", sublabel: "预设关键帧" },
            { kind: "action", label: "演唱会", icon: currentMode === "concert" ? "check" : "circle", target: "camera:concert", sublabel: "自动切换视角" },
        ],
    };
}

function buildLightLevel(): PopupLevel {
    const lightState = getLightState();
    return {
        label: "灯光",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            const fields: Array<{ label: string; key: "hemiIntensity" | "dirIntensity" | "dirX" | "dirZ"; min: number; max: number; step: number }> = [
                { label: "环境光强度", key: "hemiIntensity", min: 0, max: 2, step: 0.05 },
                { label: "方向光强度", key: "dirIntensity", min: 0, max: 2, step: 0.05 },
                { label: "方向光角度 X", key: "dirX", min: -1, max: 1, step: 0.05 },
                { label: "方向光角度 Z", key: "dirZ", min: -1, max: 1, step: 0.05 },
            ];
            for (const f of fields) {
                const row = document.createElement("div");
                row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
                const label = document.createElement("label");
                label.style.cssText = "font-size:11px;color:var(--text-dim);width:80px;flex-shrink:0;";
                label.textContent = f.label;
                const val = document.createElement("span");
                val.style.cssText = "font-size:11px;color:var(--text-bright);width:32px;text-align:right;";
                val.textContent = String(lightState[f.key].toFixed(2));
                const slider = document.createElement("input");
                slider.type = "range";
                slider.min = String(f.min);
                slider.max = String(f.max);
                slider.step = String(f.step);
                slider.value = String(lightState[f.key]);
                slider.style.cssText = "flex:1;accent-color:var(--accent);height:4px;";
                slider.addEventListener("input", () => {
                    const v = parseFloat(slider.value);
                    val.textContent = v.toFixed(2);
                    setLightState({ [f.key]: v } as any);
                    triggerAutoSave();
                });
                row.appendChild(label);
                row.appendChild(slider);
                row.appendChild(val);
                container.appendChild(row);
            }
        },
    };
}

function handleSceneAction(row: PopupRow): void {
    // Camera mode switching
    if (row.target && row.target.startsWith("camera:")) {
        const mode = row.target.replace("camera:", "") as "orbit" | "freefly" | "oneshot" | "concert";
        switchCameraMode(mode);
        sceneStack?.reRender();
        const labels: Record<string, string> = {
            orbit: "轨道", freefly: "自由飞行",
            oneshot: "镜头预设", concert: "演唱会",
        };
        setStatus(`📷 ${labels[mode] || mode}`, true);
        return;
    }
    // Save scene
    if (row.target === "scene:save") {
        (async () => {
            try {
                const path = await SelectSceneSaveFile();
                if (!path) return;
                const json = JSON.stringify(serializeScene(), null, 2);
                await SaveSceneFile(json, path);
                setStatus("✓ 场景已保存", true);
            } catch (err) {
                setStatus("✗ 保存失败", false);
                console.error("Save scene error:", err);
            }
        })();
        return;
    }
    // Load scene
    if (row.target === "scene:load") {
        (async () => {
            try {
                const path = await SelectSceneOpenFile();
                if (!path) return;
                const json = await LoadSceneFile(path);
                await deserializeScene(JSON.parse(json));
                setStatus("✓ 场景已加载", true);
            } catch (err) {
                setStatus("✗ 加载失败", false);
                console.error("Load scene error:", err);
            }
        })();
        return;
    }
}

export async function showSceneMenu(): Promise<void> {
    closeAllOverlays();
    dom.sceneOverlay.classList.add("visible");

    if (!sceneStack) {
        sceneStack = new MenuStack({
            parentEl: dom.sceneOverlay,
            onClose: () => dom.sceneOverlay.classList.remove("visible"),
            onItemClick: (row) => handleSceneAction(row),
            onFolderEnter: (row) => {
                switch (row.target) {
                    case "scene:camera": return buildCameraLevel();
                    case "scene:light": return buildLightLevel();
                    default: return null;
                }
            },
            onAfterRender: () => {},
        });
    }

    sceneStack.reset(buildSceneRoot());
}

// Wire up events
dom.btnScene.addEventListener("click", showSceneMenu);
