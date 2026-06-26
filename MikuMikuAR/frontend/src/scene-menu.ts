// [doc:architecture] Scene Menu — 场景弹窗（相机/灯光/渲染预设）
// 规范文档: docs/architecture.md §渲染环节
// 职责: MenuStack 场景弹窗、相机/灯光/渲染参数面板、渲染预设
// Scene menu — consolidated camera + lighting controls (MenuStack-based).

import {
    dom, closeAllOverlays, setStatus,
    PopupRow, PopupLevel,
} from "./config";
import { MenuStack } from "./menu";
import { switchCameraMode, getCameraMode } from "./camera";
import { getLightState, setLightState, triggerAutoSave, serializeScene, deserializeScene, getRenderState, setRenderState } from "./scene";
import type { RenderState } from "./scene";
import { SelectSceneSaveFile, SelectSceneOpenFile, SaveSceneFile, LoadSceneFile, SaveRenderPreset, DeleteRenderPreset, GetRenderPresets } from "../wailsjs/go/main/App";

// ======== Scene Menu (MenuStack) ========

let sceneStack: MenuStack | null = null;

function buildSceneRoot(): PopupLevel {
    return {
        label: "场景",
        dir: "",
        items: [
            { kind: "folder", label: "相机模式", icon: "camera", target: "scene:camera" },
            { kind: "folder", label: "灯光", icon: "sun", target: "scene:light" },
            { kind: "folder", label: "渲染", icon: "sparkles", target: "scene:render" },
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

// ======== UI Helpers (render sliders/toggles) ========

function addToggleRow(container: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): void {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;justify-content:space-between;";
    const lbl = document.createElement("span");
    lbl.style.cssText = "font-size:11px;color:var(--text-dim);";
    lbl.textContent = label;
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = value;
    toggle.style.cssText = "accent-color:var(--accent);cursor:pointer;";
    toggle.addEventListener("change", () => onChange(toggle.checked));
    row.appendChild(lbl);
    row.appendChild(toggle);
    container.appendChild(row);
}

function addSliderRow(container: HTMLElement, label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): void {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
    const lbl = document.createElement("label");
    lbl.style.cssText = "font-size:11px;color:var(--text-dim);width:80px;flex-shrink:0;";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.style.cssText = "font-size:11px;color:var(--text-bright);width:36px;text-align:right;";
    val.textContent = step < 1 ? value.toFixed(2) : String(Math.round(value));
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.style.cssText = "flex:1;accent-color:var(--accent);height:4px;";
    slider.addEventListener("input", () => {
        const v = parseFloat(slider.value);
        val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
        onChange(v);
    });
    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    container.appendChild(row);
}

// ======== Render Menu Levels ========

function buildRenderLevel(): PopupLevel {
    return {
        label: "渲染",
        dir: "",
        items: [
            { kind: "folder", label: "后处理", icon: "sparkles", target: "scene:render:postprocess" },
            { kind: "folder", label: "舞台", icon: "monitor", target: "scene:render:stage" },
            { kind: "folder", label: "渲染预设", icon: "palette", target: "scene:render:presets" },
        ],
    };
}

function buildPostProcessLevel(): PopupLevel {
    const state = getRenderState();
    return {
        label: "后处理",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";

            // Bloom section
            addToggleRow(container, "Bloom 泛光", state.bloomEnabled, (v) => {
                setRenderState({ bloomEnabled: v });
                triggerAutoSave();
            });
            const bloomFields = [
                { label: "Bloom 强度", key: "bloomWeight" as const, min: 0, max: 1, step: 0.05 },
                { label: "Bloom 阈值", key: "bloomThreshold" as const, min: 0, max: 1, step: 0.05 },
                { label: "Bloom 核大小", key: "bloomKernel" as const, min: 0, max: 512, step: 1 },
            ];
            for (const f of bloomFields) {
                addSliderRow(container, f.label, state[f.key], f.min, f.max, f.step, (v) => {
                    setRenderState({ [f.key]: v });
                    triggerAutoSave();
                });
            }

            // FXAA toggle
            addToggleRow(container, "FXAA 抗锯齿", state.fxaaEnabled, (v) => {
                setRenderState({ fxaaEnabled: v });
                triggerAutoSave();
            });

            // Outline toggle (edge highlighting)
            addToggleRow(container, "边缘高亮", state.outlineEnabled, (v) => {
                setRenderState({ outlineEnabled: v });
                triggerAutoSave();
            });
        },
    };
}

function buildStageLevel(): PopupLevel {
    const state = getRenderState();
    return {
        label: "舞台",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";

            // Tone-mapping selector
            const tmLabel = document.createElement("div");
            tmLabel.style.cssText = "font-size:11px;color:var(--text-dim);margin-bottom:6px;";
            tmLabel.textContent = "色调映射";
            container.appendChild(tmLabel);

            const tmNames = ["关闭", "ACES", "Reinhard", "Cineon", "Neutral"];
            const tmRow = document.createElement("div");
            tmRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;";
            for (let i = 0; i < tmNames.length; i++) {
                const btn = document.createElement("button");
                btn.textContent = tmNames[i];
                btn.style.cssText = `padding:4px 10px;border:1px solid var(--white-08);border-radius:4px;background:${state.toneMapping === i ? "var(--accent)" : "transparent"};color:var(--text-bright);cursor:pointer;font-size:11px;`;
                btn.addEventListener("click", () => {
                    setRenderState({ toneMapping: i });
                    triggerAutoSave();
                    // Re-render to update button highlights
                    sceneStack?.reRender();
                });
                tmRow.appendChild(btn);
            }
            container.appendChild(tmRow);

            // Exposure
            addSliderRow(container, "曝光", state.exposure, 0, 4, 0.05, (v) => {
                setRenderState({ exposure: v });
                triggerAutoSave();
            });
            // Contrast
            addSliderRow(container, "对比度", state.contrast, 0, 4, 0.05, (v) => {
                setRenderState({ contrast: v });
                triggerAutoSave();
            });
            // FOV
            addSliderRow(container, "视场角 (FOV)", state.fov, 0.1, 3, 0.05, (v) => {
                setRenderState({ fov: v });
                triggerAutoSave();
            });
            // Background color
            const bgLabel = document.createElement("div");
            bgLabel.style.cssText = "font-size:11px;color:var(--text-dim);margin:8px 0 4px;";
            bgLabel.textContent = "背景色 RGB";
            container.appendChild(bgLabel);
            const bgFields: Array<{ label: string; key: 0 | 1 | 2 }> = [
                { label: "R", key: 0 }, { label: "G", key: 1 }, { label: "B", key: 2 },
            ];
            for (const f of bgFields) {
                addSliderRow(container, f.label, state.bgColor[f.key], 0, 1, 0.01, (v) => {
                    const bg = [...getRenderState().bgColor] as [number, number, number];
                    bg[f.key] = v;
                    setRenderState({ bgColor: bg });
                    triggerAutoSave();
                });
            }
        },
    };
}

/** Built-in render presets. */
const builtinPresets: Record<string, Partial<RenderState>> = {
    standard: {
        bloomEnabled: false, bloomWeight: 0.3, bloomThreshold: 0.5, bloomKernel: 64,
        fxaaEnabled: false, outlineEnabled: false,
        toneMapping: 0, exposure: 1, contrast: 1, fov: 0.8,
        bgColor: [0.12, 0.12, 0.16],
    },
    cartoon: {
        bloomEnabled: true, bloomWeight: 0.6, bloomThreshold: 0.3, bloomKernel: 128,
        fxaaEnabled: true, outlineEnabled: true, outlineColor: [0, 0, 0],
        toneMapping: 2, exposure: 1.2, contrast: 1.3, fov: 0.8,
        bgColor: [0.15, 0.15, 0.2],
    },
    realistic: {
        bloomEnabled: false, bloomWeight: 0.3, bloomThreshold: 0.5, bloomKernel: 64,
        fxaaEnabled: true, outlineEnabled: false,
        toneMapping: 1, exposure: 1, contrast: 1, fov: 0.7,
        bgColor: [0.08, 0.08, 0.12],
    },
    warm: {
        bloomEnabled: true, bloomWeight: 0.4, bloomThreshold: 0.4, bloomKernel: 64,
        fxaaEnabled: false, outlineEnabled: false,
        toneMapping: 2, exposure: 1.1, contrast: 0.9, fov: 0.8,
        bgColor: [0.18, 0.14, 0.1],
    },
    cyberpunk: {
        bloomEnabled: true, bloomWeight: 0.8, bloomThreshold: 0.2, bloomKernel: 256,
        fxaaEnabled: true, outlineEnabled: true, outlineColor: [1, 0, 1],
        toneMapping: 4, exposure: 1.3, contrast: 1.5, fov: 0.9,
        bgColor: [0.02, 0.02, 0.06],
    },
};

/** Chinese labels for built-in presets. */
const PRESET_LABELS: Record<string, string> = {
    standard: "标准", cartoon: "卡通", realistic: "写实", warm: "暖光", cyberpunk: "赛博朋克",
};

function getBuiltinPreset(name: string): Partial<RenderState> | undefined {
    return builtinPresets[name];
}

function buildPresetsLevel(): PopupLevel {
    const items: PopupRow[] = [];
    // Built-in presets
    for (const [key] of Object.entries(builtinPresets)) {
        items.push({ kind: "action", label: PRESET_LABELS[key] || key, icon: "palette", target: `scene:preset:${key}` });
    }
    items.push({ kind: "divider", label: "", icon: "", target: "" });
    // Save current as preset
    items.push({ kind: "action", label: "保存当前为预设", icon: "save", target: "scene:preset:save" });
    // User presets (each with a delete button)
    if (Object.keys(userPresets).length > 0) {
        items.push({ kind: "divider", label: "", icon: "", target: "" });
        for (const [name] of Object.entries(userPresets)) {
            items.push({ kind: "action", label: name, icon: "palette", target: `scene:preset:user:${name}` });
            items.push({ kind: "action", label: `${name}`, icon: "trash", target: `scene:preset:delete:${name}` });
        }
    }
    return { label: "渲染预设", dir: "", items };
}

function getPresetName(name: string): string {
    return PRESET_LABELS[name] || name;
}

/** Show a prompt to save the current render state as a named preset. */
function showPresetSaveDialog(): void {
    const name = prompt("输入预设名称：");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    // Persist via Go backend first, then update in-memory on success
    const state = getRenderState();
    SaveRenderPreset(trimmed, JSON.stringify(state)).then(() => {
        userPresets[trimmed] = state;
        setStatus(`✓ 预设已保存: ${trimmed}`, true);
        if (sceneStack) {
            sceneStack.setLevel(sceneStack.levelCount - 1, buildPresetsLevel());
            sceneStack.reRender();
        }
    }).catch((err: any) => {
        console.warn("SaveRenderPreset failed:", err);
        setStatus("✗ 保存预设失败", false);
    });
}

/** In-memory user-defined render presets (loaded from backend on show). */
const userPresets: Record<string, Partial<RenderState>> = {};

let _presetsLoaded = false;

/** Load user presets from the Go backend and merge into userPresets. */
async function loadUserPresets(): Promise<void> {
    if (_presetsLoaded) return;
    _presetsLoaded = true;
    try {
        const presets = await GetRenderPresets();
        for (const p of presets) {
            userPresets[p.name] = p.params as unknown as Partial<RenderState>;
        }
    } catch (err) {
        console.warn("loadUserPresets:", err);
    }
}

function handleSceneAction(row: PopupRow): void {
    // Camera mode switching
    if (row.target && row.target.startsWith("camera:")) {
        const mode = row.target.replace("camera:", "") as "orbit" | "freefly" | "oneshot" | "concert";
        switchCameraMode(mode);
        // reattachPipeline() is now handled inside switchCameraMode (camera.ts:182)
        // Replace the camera level with fresh data so the checkmark icon updates
        if (sceneStack) {
            sceneStack.setLevel(sceneStack.levelCount - 1, buildCameraLevel());
            sceneStack.reRender();
        }
        const labels: Record<string, string> = {
            orbit: "轨道", freefly: "自由飞行",
            oneshot: "镜头预设", concert: "演唱会",
        };
        setStatus(`✓ 相机: ${labels[mode] || mode}`, true);
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
    // Render preset handling
    if (row.target && row.target.startsWith("scene:preset:")) {
        const action = row.target.replace("scene:preset:", "");

        if (action === "save") {
            showPresetSaveDialog();
            return;
        }

        // Delete user preset
        if (action.startsWith("delete:")) {
            const name = action.replace("delete:", "");
            (async () => {
                try {
                    await DeleteRenderPreset(name);
                    delete userPresets[name];
                    if (sceneStack) {
                        sceneStack.setLevel(sceneStack.levelCount - 1, buildPresetsLevel());
                        sceneStack.reRender();
                    }
                    setStatus(`✓ 预设已删除: ${name}`, true);
                } catch (err) {
                    console.warn("DeleteRenderPreset failed:", err);
                    setStatus("✗ 删除预设失败", false);
                }
            })();
            return;
        }

        // Apply preset
        let preset: Partial<RenderState> | undefined;
        if (action.startsWith("user:")) {
            const userName = action.substring(5);
            preset = userPresets[userName];
        } else {
            preset = getBuiltinPreset(action);
        }
        if (preset) {
            setRenderState(preset);
            triggerAutoSave();
            setStatus(`✓ 预设: ${getPresetName(action)}`, true);
        }
        return;
    }
}

export async function showSceneMenu(): Promise<void> {
    closeAllOverlays();
    dom.sceneOverlay.classList.add("visible");

    // Load user presets from backend
    await loadUserPresets();

    if (!sceneStack) {
        sceneStack = new MenuStack({
            parentEl: dom.sceneOverlay,
            onClose: () => dom.sceneOverlay.classList.remove("visible"),
            onItemClick: (row) => handleSceneAction(row),
            onFolderEnter: (row) => {
                switch (row.target) {
                    case "scene:camera": return buildCameraLevel();
                    case "scene:light": return buildLightLevel();
                    case "scene:render": return buildRenderLevel();
                    case "scene:render:postprocess": return buildPostProcessLevel();
                    case "scene:render:stage": return buildStageLevel();
                    case "scene:render:presets": return buildPresetsLevel();
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
