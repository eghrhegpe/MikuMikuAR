// [doc:architecture] Scene Menu — 场景弹窗（相机/灯光/渲染预设）
// 规范文档: docs/architecture.md §渲染环节
// 职责: MenuStack 场景弹窗、相机/灯光/渲染参数面板、渲染预设
// Scene menu — consolidated camera + lighting controls (MenuStack-based).

import {
    dom, closeAllOverlays, setStatus, formatTime, escapeHtml,
    PopupRow, PopupLevel, envState, EnvState,
} from "./config";
import { SlideMenu } from "./menu";
import { createIconifyIcon } from "./icons";
import {
    switchCameraMode, getCameraMode, hasCameraVmd, getCameraVmdName, clearCameraVmd, getCurrentCamera,
    getOrbitParams, setOrbitParams,
    getFreeflyParams, setFreeflyParams,
    getConcertParams, setConcertParams,
    type CameraMode,
} from "./camera";
import { getLightState, setLightState, triggerAutoSave, serializeScene, deserializeScene, getRenderState, setRenderState, loadCameraVmdFromPath, setEnvState } from "./scene";
import type { RenderState } from "./scene";
import { SelectSceneSaveFile, SelectSceneOpenFile, SaveSceneFile, LoadSceneFile, SaveRenderPreset, DeleteRenderPreset, GetRenderPresets, SelectVMDMotion, SelectDir, SaveScreenshot,
    GetPresetScenes, GetPresetScenesDir, SaveScenePreset, DeletePresetScene } from "../wailsjs/go/main/App";
import { focusModel, setGravityStrength, getGravityStrength, setProcMotionMode, setProcMotionIntensity, setProcMotionSpeed, setProcMotionAutoSwitch, getProcMotionState, regenerateProcMotion } from "./scene";
import { modelRegistry, focusedModelId, setFocusedModelId } from "./config";
import type { ProcMotionMode } from "./procedural-motion";

// ======== Scene Menu (SlideMenu) ========

let sceneStack: SlideMenu | null = null;

function buildSceneRoot(): PopupLevel {
    return {
        label: "场景",
        dir: "",
        items: [
            { kind: "folder", label: "预设场景", icon: "bookmark", target: "scene:presets" },
            { kind: "folder", label: "相机模式", icon: "camera", target: "scene:camera" },
            { kind: "folder", label: "灯光", icon: "sun", target: "scene:light" },
            { kind: "folder", label: "渲染", icon: "sparkles", target: "scene:render" },
            { kind: "folder", label: "物理", icon: "toggle-left", target: "scene:physics" },
            { kind: "folder", label: "程序化动作", icon: "wind", target: "scene:procmotion" },
            { kind: "folder", label: "截图", icon: "camera", target: "scene:screenshot" },
            { kind: "action", label: "保存场景", icon: "save", target: "scene:save" },
            { kind: "action", label: "加载场景", icon: "upload", target: "scene:load" },
        ],
    };
}

function buildProcMotionLevel(): PopupLevel {
    const st = getProcMotionState();
    const modeLabel: Record<string, string> = {
        off: "关闭", idle: "待机呼吸", autodance: "自动舞蹈",
    };
    return {
        label: "程序化动作",
        dir: "",
        items: [
            { kind: "folder", label: "模式", icon: "wind", target: "procmotion:mode", sublabel: modeLabel[st.mode] },
            { kind: "action", label: "自动切换", icon: "repeat", target: "procmotion:autoswitch", sublabel: st.autoSwitch ? "开" : "关" },
        ],
        renderCustom: (container) => {
            container.style.padding = "8px 6px";
            addSliderRow(container, "动作强度", st.intensity, 0, 1, 0.05, (v) => {
                setProcMotionIntensity(v);
                regenerateProcMotion();
            }, "lucide:activity");
            addSliderRow(container, "速度", st.speed, 0.5, 2, 0.05, (v) => {
                setProcMotionSpeed(v);
                regenerateProcMotion();
            }, "lucide:fast-forward");
        },
    };
}

function buildProcMotionModeLevel(): PopupLevel {
    const st = getProcMotionState();
    const modes: { mode: ProcMotionMode; label: string; icon: string }[] = [
        { mode: "off", label: "关闭", icon: st.mode === "off" ? "check" : "circle" },
        { mode: "idle", label: "待机呼吸", icon: st.mode === "idle" ? "check" : "circle" },
        { mode: "autodance", label: "自动舞蹈", icon: st.mode === "autodance" ? "check" : "circle" },
    ];
    return {
        label: "程序化动作模式",
        dir: "",
        items: modes.map(m => ({
            kind: "action" as const,
            label: m.label,
            icon: m.icon,
            target: `procmotion:set-mode:${m.mode}`,
        })),
    };
}

let currentPresetIndex = -1;

function buildPresetScenesLevel(): PopupLevel {
    return {
        label: "预设场景",
        dir: "",
        items: [],
        renderCustom: async (container) => {
            container.style.padding = "12px 14px";
            const scenes = await GetPresetScenes() || [];
            if (scenes.length === 0) {
                const empty = document.createElement("div");
                empty.style.cssText = "font-size:12px;color:var(--text-dim);text-align:center;padding:20px;";
                empty.textContent = "暂无预设场景，保存场景时自动生成";
                container.appendChild(empty);
                return;
            }

            // Navigation row
            const navRow = document.createElement("div");
            navRow.style.cssText = "display:flex;gap:6px;margin-bottom:10px;";
            const prevBtn = document.createElement("button");
            prevBtn.style.cssText = "flex:1;padding:6px;border:1px solid var(--white-08);border-radius:6px;background:transparent;color:var(--text-bright);cursor:pointer;font-size:11px;";
            prevBtn.innerHTML = '<iconify-icon icon="lucide:skip-back"></iconify-icon> 上一个';
            prevBtn.addEventListener("click", async () => {
                if (scenes.length === 0) return;
                if (currentPresetIndex < 0) currentPresetIndex = 0;
                currentPresetIndex = (currentPresetIndex - 1 + scenes.length) % scenes.length;
                const name = scenes[currentPresetIndex];
                const dir = await GetPresetScenesDir();
                const json = await LoadSceneFile(dir + "/" + name);
                await deserializeScene(JSON.parse(json));
                setStatus(`✓ 预设场景: ${name} (${currentPresetIndex + 1}/${scenes.length})`, true);
            });
            const nextBtn = document.createElement("button");
            nextBtn.style.cssText = "flex:1;padding:6px;border:1px solid var(--white-08);border-radius:6px;background:transparent;color:var(--text-bright);cursor:pointer;font-size:11px;";
            nextBtn.innerHTML = '下一个 <iconify-icon icon="lucide:skip-forward"></iconify-icon>';
            nextBtn.addEventListener("click", async () => {
                if (scenes.length === 0) return;
                if (currentPresetIndex < 0) currentPresetIndex = 0;
                currentPresetIndex = (currentPresetIndex + 1) % scenes.length;
                const name = scenes[currentPresetIndex];
                const dir = await GetPresetScenesDir();
                const json = await LoadSceneFile(dir + "/" + name);
                await deserializeScene(JSON.parse(json));
                setStatus(`✓ 预设场景: ${name} (${currentPresetIndex + 1}/${scenes.length})`, true);
            });
            navRow.appendChild(prevBtn);
            navRow.appendChild(nextBtn);
            container.appendChild(navRow);

            for (let i = 0; i < scenes.length; i++) {
                const name = scenes[i];
                const isActive = i === currentPresetIndex;
                const row = document.createElement("div");
                row.className = "menu-item";
                row.innerHTML = `<span class="menu-icon"><iconify-icon icon="${isActive ? "play-circle" : "bookmark"}"></iconify-icon></span><span class="menu-label">${escapeHtml(name)}</span>`;
                row.addEventListener("click", async () => {
                    currentPresetIndex = i;
                    const dir = await GetPresetScenesDir();
                    const json = await LoadSceneFile(dir + "/" + name);
                    await deserializeScene(JSON.parse(json));
                    sceneStack?.reRender();
                    setStatus(`✓ 已加载: ${name}`, true);
                });
                container.appendChild(row);

                // Delete button
                const delBtn = document.createElement("span");
                delBtn.style.cssText = "font-size:10px;color:var(--text-dim);cursor:pointer;margin-left:auto;padding:2px 4px;";
                delBtn.textContent = "✕";
                delBtn.title = "删除此预设场景";
                delBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!confirm(`确定删除「${name}」？`)) return;
                    try {
                        await DeletePresetScene(name);
                        if (currentPresetIndex === i) currentPresetIndex = -1;
                        else if (currentPresetIndex > i) currentPresetIndex--;
                        sceneStack?.reRender();
                        setStatus(`✓ 已删除: ${name}`, true);
                    } catch (err) {
                        setStatus("✗ 删除失败", false);
                    }
                });
                row.appendChild(delBtn);
            }
        },
    };
}

function buildScreenshotLevel(): PopupLevel {
    return {
        label: "截图",
        dir: "",
        items: [
            { kind: "action", label: "截图当前模型", icon: "camera", target: "screenshot:current", sublabel: "保存焦点模型截图" },
            { kind: "action", label: "批量截图", icon: "images", target: "screenshot:batch", sublabel: "逐个模型截图到指定目录" },
        ],
    };
}

function buildCameraLevel(): PopupLevel {
    const currentMode = getCameraMode();
    const vmdLoaded = hasCameraVmd();
    const vmdName = getCameraVmdName();
    return {
        label: "相机模式",
        dir: "",
        items: [
            { kind: "action", label: "轨道", icon: currentMode === "orbit" ? "check" : "circle", target: "camera:orbit", sublabel: "默认轨道相机" },
            { kind: "action", label: "自由飞行", icon: currentMode === "freefly" ? "check" : "circle", target: "camera:freefly", sublabel: "WASD 自由移动" },
            { kind: "action", label: "演唱会", icon: currentMode === "concert" ? "check" : "circle", target: "camera:concert", sublabel: "环绕角色旋转" },
            ...((vmdLoaded ? [
                { kind: "divider" } as PopupRow,
                { kind: "action" as const, label: "VMD 相机", icon: currentMode === "vmd" ? "check" : "circle", target: "camera:vmd", sublabel: vmdName || "相机轨道" } as PopupRow,
                { kind: "action" as const, label: "清除相机 VMD", icon: "trash-2", target: "camera:clear-vmd" } as PopupRow,
            ] : []) as PopupRow[]),
            { kind: "divider" } as PopupRow,
            { kind: "action" as const, label: "加载相机 VMD", icon: "upload", target: "camera:load-vmd", sublabel: "从 .vmd 文件加载相机轨道" } as PopupRow,
            { kind: "divider" } as PopupRow,
            { kind: "folder" as const, label: "轨道设置", icon: "settings", target: "camera:params:orbit" } as PopupRow,
            { kind: "folder" as const, label: "自由飞行设置", icon: "settings", target: "camera:params:freefly" } as PopupRow,
            { kind: "folder" as const, label: "演唱会设置", icon: "settings", target: "camera:params:concert" } as PopupRow,
        ],
    };
}

/** Build a parameter editing submenu for the given camera mode. */
function buildCameraParamsLevel(mode: CameraMode): PopupLevel {
    return {
        label: mode === "orbit" ? "轨道设置" :
               mode === "freefly" ? "自由飞行设置" :
               mode === "concert" ? "演唱会设置" : "相机设置",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            if (mode === "orbit") renderOrbitParams(container);
            else if (mode === "freefly") renderFreeflyParams(container);
            else if (mode === "concert") renderConcertParams(container);
        },
    };
}

function renderOrbitParams(container: HTMLElement): void {
    const p = getOrbitParams();
    addSliderRow(container, "目标高度", p.targetHeight, 0, 30, 0.5, (v) => {
        setOrbitParams({ targetHeight: v });
        triggerAutoSave();
    }, "lucide:maximize");
    addSliderRow(container, "距离", p.distance, 2, 50, 0.5, (v) => {
        setOrbitParams({ distance: v });
        if (getCameraMode() === "orbit") {
            const cam = getCurrentCamera() as any;
            if (cam?.radius !== undefined) cam.radius = v;
        }
        triggerAutoSave();
    }, "lucide:zoom-in");
    addSliderRow(container, "俯仰角", p.beta, 0.1, Math.PI - 0.1, 0.05, (v) => {
        setOrbitParams({ beta: v });
        if (getCameraMode() === "orbit") {
            const cam = getCurrentCamera() as any;
            if (cam?.beta !== undefined) cam.beta = v;
        }
        triggerAutoSave();
    }, "lucide:arrow-up-down");
}

function renderFreeflyParams(container: HTMLElement): void {
    const p = getFreeflyParams();
    addSliderRow(container, "移动速度", p.speed, 0.1, 5, 0.1, (v) => {
        setFreeflyParams({ speed: v });
        triggerAutoSave();
    }, "lucide:move");
    addSliderRow(container, "鼠标灵敏度", p.angularSensibility, 500, 5000, 100, (v) => {
        setFreeflyParams({ angularSensibility: v });
        triggerAutoSave();
    }, "lucide:mouse-pointer");
}

function renderConcertParams(container: HTMLElement): void {
    const p = getConcertParams();
    addSliderRow(container, "轨道半径", p.radius, 2, 50, 0.5, (v) => {
        setConcertParams({ radius: v });
        triggerAutoSave();
    }, "lucide:circle");
    addSliderRow(container, "目标高度", p.height, 0, 30, 0.5, (v) => {
        setConcertParams({ height: v });
        triggerAutoSave();
    }, "lucide:maximize");
    addSliderRow(container, "旋转速度", p.speed, 0, 5, 0.1, (v) => {
        setConcertParams({ speed: v });
        triggerAutoSave();
    }, "lucide:rotate-cw");
}

function buildLightLevel(): PopupLevel {
    return {
        label: "灯光",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const lightState = getLightState();
            container.style.padding = "12px 14px";
            const fields: Array<{ label: string; key: "hemiIntensity" | "dirIntensity" | "dirX" | "dirY" | "dirZ"; min: number; max: number; step: number; icon: string }> = [
                { label: "环境光强度", key: "hemiIntensity", min: 0, max: 2, step: 0.05, icon: "lucide:sun" },
                { label: "方向光强度", key: "dirIntensity", min: 0, max: 2, step: 0.05, icon: "lucide:sun" },
                { label: "方向光角度 X", key: "dirX", min: -1, max: 1, step: 0.05, icon: "lucide:move" },
                { label: "方向光角度 Y", key: "dirY", min: -1, max: 1, step: 0.05, icon: "lucide:arrow-up-down" },
                { label: "方向光角度 Z", key: "dirZ", min: -1, max: 1, step: 0.05, icon: "lucide:arrow-up-down" },
            ];
            for (const f of fields) {
                addSliderRow(container, f.label, lightState[f.key], f.min, f.max, f.step, (v) => {
                    setLightState({ [f.key]: v } as any);
                }, f.icon);
            }

            // Separator
            const sep = document.createElement("div");
            sep.style.cssText = "height:1px;background:var(--white-08);margin:12px 0;";
            container.appendChild(sep);

            // Directional light color
            addColorSliderRow(container, "方向光色", lightState.dirColor, (v) => setLightState({ dirColor: v }));

            // Hemisphere light color
            addColorSliderRow(container, "环境光色", lightState.hemiColor, (v) => setLightState({ hemiColor: v }));

            // Ground color
            addColorSliderRow(container, "地面光色", lightState.groundColor, (v) => setLightState({ groundColor: v }));

            // Shadow controls
            const sep2 = document.createElement("div");
            sep2.style.cssText = "height:1px;background:var(--white-08);margin:12px 0;";
            container.appendChild(sep2);

            addToggleRow(container, "启用阴影", lightState.shadowEnabled, (v) => setLightState({ shadowEnabled: v }));

            const typeRow = document.createElement("div");
            typeRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;";
            const typeLabel = document.createElement("span");
            typeLabel.style.cssText = "font-size:11px;color:var(--text-dim);width:60px;";
            typeLabel.textContent = "阴影类型";
            typeRow.appendChild(typeLabel);
            const types: Array<{ value: "hard" | "soft" | "pcf"; label: string }> = [
                { value: "hard", label: "硬" },
                { value: "soft", label: "软" },
                { value: "pcf", label: "柔和阴影" },
            ];
            for (const t of types) {
                const btn = document.createElement("button");
                btn.textContent = t.label;
                btn.className = "mode-btn" + (lightState.shadowType === t.value ? " active" : "");
                btn.addEventListener("click", () => {
                    setLightState({ shadowType: t.value });
                    sceneStack?.reRender();
                });
                typeRow.appendChild(btn);
            }
            container.appendChild(typeRow);
        },
    };
}

function buildEnvLevel(): PopupLevel {
    return {
        label: "环境",
        dir: "",
        items: [
            { kind: "folder", label: "天空", icon: "sun", target: "scene:env:sky" },
            { kind: "folder", label: "地面", icon: "grid", target: "scene:env:ground" },
            { kind: "folder", label: "粒子", icon: "wind", target: "scene:env:particle" },
            { kind: "folder", label: "风", icon: "wind", target: "scene:env:wind" },
            { kind: "folder", label: "云", icon: "cloud", target: "scene:env:cloud" },
            { kind: "divider" } as any,
            { kind: "folder", label: "系统预设", icon: "bookmark", target: "scene:env:presets" },
        ],
    };
}

interface EnvPresetConfig {
    env: Partial<EnvState>;
    lights?: Partial<import("./scene").LightState>;
    render?: Partial<import("./scene").RenderState>;
}

const ENV_PRESETS: Record<string, EnvPresetConfig> = {
    "舞台-A 打光": {
        env: {
            skyMode: "procedural",
            skyColorTop: [0.05, 0.05, 0.15],
            skyColorBot: [0.1, 0.05, 0.15],
            envIntensity: 0.5,
            groundMode: "solid",
            groundColor: [0.05, 0.05, 0.08],
            particleEnabled: false,
        },
        lights: {
            hemiIntensity: 0.4,
            dirIntensity: 0.6,
            dirColor: [1, 0.85, 0.7],
            shadowEnabled: true,
            shadowType: "soft",
        },
        render: {
            vignetteEnabled: true,
            vignetteDarkness: 0.3,
            exposure: 1.2,
        },
    },
    "户外晴天": {
        env: {
            skyMode: "procedural",
            skyColorTop: [0.3, 0.6, 1],
            skyColorBot: [0.6, 0.8, 1],
            skyBrightness: 2,
            envIntensity: 1.5,
            groundMode: "grid",
            groundColor: [0.3, 0.35, 0.3],
        },
        lights: {
            hemiIntensity: 1,
            dirIntensity: 1.2,
            dirColor: [1, 0.95, 0.85],
            shadowEnabled: true,
            shadowType: "pcf",
        },
        render: {
            exposure: 1.4,
            toneMapping: 1,
        },
    },
    "演唱会蓝紫": {
        env: {
            skyMode: "procedural",
            skyColorTop: [0.4, 0.1, 0.6],
            skyColorMid: [0.2, 0.05, 0.4],
            skyColorBot: [0.1, 0.02, 0.2],
            envIntensity: 0.3,
            groundMode: "solid",
            groundColor: [0.05, 0.02, 0.1],
            particleEnabled: true,
            particleType: "fireworks",
        },
        lights: {
            hemiIntensity: 0.3,
            dirIntensity: 0.5,
            dirColor: [0.6, 0.3, 0.8],
            hemiColor: [0.3, 0.1, 0.5],
            shadowEnabled: false,
        },
        render: {
            vignetteEnabled: true,
            vignetteDarkness: 0.5,
            exposure: 0.9,
            toneMapping: 3,
        },
    },
};

function buildPresetLevel(): PopupLevel {
    return {
        label: "系统预设",
        dir: "",
        items: Object.entries(ENV_PRESETS).map(([name, preset]) => ({
            kind: "action" as const,
            label: name,
            icon: "bookmark",
            target: "",
            sublabel: "",
            onClick: () => {
                setEnvState({ ...preset.env });
                if (preset.lights) setLightState(preset.lights);
                if (preset.render) setRenderState(preset.render);
            },
        })),
    };
}

function buildSkyLevel(): PopupLevel {
    return {
        label: "天空",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            const s = envState;

            const modeRow = document.createElement("div");
            modeRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;";
            const modeLabel = document.createElement("span");
            modeLabel.style.cssText = "font-size:11px;color:var(--text-dim);width:60px;";
            modeLabel.textContent = "模式";
            modeRow.appendChild(modeLabel);
            const modes: Array<{ value: EnvState["skyMode"]; label: string }> = [
                { value: "color", label: "纯色" },
                { value: "texture", label: "贴图" },
                { value: "procedural", label: "程序化" },
            ];
            for (const m of modes) {
                const btn = document.createElement("button");
                btn.textContent = m.label;
                btn.className = "mode-btn" + (s.skyMode === m.value ? " active" : "");
                btn.addEventListener("click", () => {
                    setEnvState({ skyMode: m.value });
                    sceneStack?.reRender();
                });
                modeRow.appendChild(btn);
            }
            container.appendChild(modeRow);

            if (s.skyMode === "color") {
                addColorSliderRow(container, "天空色", s.skyColorTop, (v) => setEnvState({ skyColorTop: v }));
            } else if (s.skyMode === "procedural") {
                addColorSliderRow(container, "天顶色", s.skyColorTop, (v) => setEnvState({ skyColorTop: v }));
                addColorSliderRow(container, "地平色", s.skyColorBot, (v) => setEnvState({ skyColorBot: v }));
            }

            if (s.skyMode === "texture") {
                const texRow = document.createElement("div");
                texRow.innerHTML = `<span class="menu-label">环境贴图</span><span class="menu-sublabel">${s.skyTexture || "未选择"}</span>`;
                texRow.className = "menu-item";
                texRow.addEventListener("click", () => {
                    const path = prompt("输入环境贴图路径：");
                    if (path) setEnvState({ skyTexture: path });
                });
                container.appendChild(texRow);

                addSliderRow(container, "旋 Y", s.skyRotationY, 0, 360, 1, (v) => setEnvState({ skyRotationY: v }), "lucide:refresh-cw");
                addSliderRow(container, "环境光强度", s.envIntensity, 0, 3, 0.05, (v) => setEnvState({ envIntensity: v }), "lucide:sun");
            }

            if (s.skyMode === "procedural") {
                addSliderRow(container, "亮度", s.skyBrightness, 0.1, 5, 0.1, (v) => setEnvState({ skyBrightness: v }), "lucide:brightness");
            }
        },
    };
}

function buildGroundLevel(): PopupLevel {
    return {
        label: "地面",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            const s = envState;

            addToggleRow(container, "显示地面", s.groundVisible, (v) => setEnvState({ groundVisible: v }));

            const modeRow = document.createElement("div");
            modeRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;";
            const modeLabel = document.createElement("span");
            modeLabel.style.cssText = "font-size:11px;color:var(--text-dim);width:60px;";
            modeLabel.textContent = "模式";
            modeRow.appendChild(modeLabel);
            const modes: Array<{ value: EnvState["groundMode"]; label: string }> = [
                { value: "solid", label: "纯色" },
                { value: "grid", label: "网格" },
                { value: "checker", label: "棋盘格" },
            ];
            for (const m of modes) {
                const btn = document.createElement("button");
                btn.textContent = m.label;
                btn.className = "mode-btn" + (s.groundMode === m.value ? " active" : "");
                btn.addEventListener("click", () => {
                    setEnvState({ groundMode: m.value });
                    sceneStack?.reRender();
                });
                modeRow.appendChild(btn);
            }
            container.appendChild(modeRow);

            addColorSliderRow(container, "地面色", s.groundColor, (v) => setEnvState({ groundColor: v }));
            if (s.groundMode === "solid") {
                addSliderRow(container, "透明度", s.groundAlpha, 0, 1, 0.05, (v) => setEnvState({ groundAlpha: v }), "lucide:eye");
            }
        },
    };
}

function buildParticleLevel(): PopupLevel {
    return {
        label: "粒子",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            const s = envState;

            addToggleRow(container, "启用粒子", s.particleEnabled, (v) => setEnvState({ particleEnabled: v }));

            const typeRow = document.createElement("div");
            typeRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;";
            const typeLabel = document.createElement("span");
            typeLabel.style.cssText = "font-size:11px;color:var(--text-dim);width:60px;";
            typeLabel.textContent = "类型";
            typeRow.appendChild(typeLabel);
            const types: Array<{ value: EnvState["particleType"]; label: string }> = [
                { value: "none", label: "无" },
                { value: "sakura", label: "🌸 樱花" },
                { value: "rain", label: "🌧 雨" },
                { value: "snow", label: "❄ 雪" },
                { value: "fireworks", label: "🎆 烟花" },
            ];
            for (const t of types) {
                const btn = document.createElement("button");
                btn.textContent = t.label;
                btn.className = "mode-btn" + (s.particleType === t.value ? " active" : "");
                btn.addEventListener("click", () => {
                    setEnvState({ particleType: t.value });
                    sceneStack?.reRender();
                });
                typeRow.appendChild(btn);
            }
            container.appendChild(typeRow);
        },
    };
}

function buildWindLevel(): PopupLevel {
    return {
        label: "风",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            const s = envState;

            addToggleRow(container, "启用风", s.windEnabled, (v) => setEnvState({ windEnabled: v }));

            addSliderRow(container, "风向 X", s.windDirection[0], -1, 1, 0.05, (v) => {
                const d: [number, number, number] = [...s.windDirection];
                d[0] = v;
                setEnvState({ windDirection: d });
            }, "lucide:compass");
            addSliderRow(container, "风向 Y", s.windDirection[1], -1, 1, 0.05, (v) => {
                const d: [number, number, number] = [...s.windDirection];
                d[1] = v;
                setEnvState({ windDirection: d });
            }, "lucide:compass");
            addSliderRow(container, "风向 Z", s.windDirection[2], -1, 1, 0.05, (v) => {
                const d: [number, number, number] = [...s.windDirection];
                d[2] = v;
                setEnvState({ windDirection: d });
            }, "lucide:compass");
            addSliderRow(container, "风速", s.windSpeed, 0, 10, 0.1, (v) => setEnvState({ windSpeed: v }), "lucide:gauge");
        },
    };
}

function buildCloudLevel(): PopupLevel {
    return {
        label: "云",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            const s = envState;

            addToggleRow(container, "启用云", s.cloudsEnabled, (v) => setEnvState({ cloudsEnabled: v }));

            addSliderRow(container, "云量", s.cloudCover, 0, 1, 0.05, (v) => setEnvState({ cloudCover: v }), "lucide:cloud");
            addSliderRow(container, "高度", s.cloudHeight, 10, 200, 5, (v) => setEnvState({ cloudHeight: v }), "lucide:arrow-up");
            addSliderRow(container, "缩放", s.cloudScale, 0.5, 3, 0.1, (v) => setEnvState({ cloudScale: v }), "lucide:maximize");
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
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = value;
    toggle.addEventListener("change", () => onChange(toggle.checked));
    const slider = document.createElement("span");
    slider.className = "slider";
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(slider);
    row.appendChild(lbl);
    row.appendChild(toggleLabel);
    container.appendChild(row);
}

function addSliderRow(container: HTMLElement, label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, icon?: string): void {
    let currentValue = value;
    const range = max - min;

    const row = document.createElement("div");
    row.className = "cs-row";

    const top = document.createElement("div");
    top.className = "cs-top";

    if (icon) {
        const iconBox = document.createElement("span");
        iconBox.className = "cs-icon";
        const iconEl = createIconifyIcon(icon);
        if (iconEl) iconBox.appendChild(iconEl);
        top.appendChild(iconBox);
    }

    const lbl = document.createElement("span");
    lbl.className = "cs-label";
    lbl.textContent = label;

    const val = document.createElement("span");
    val.className = "cs-value";
    val.textContent = step < 1 ? currentValue.toFixed(2) : String(Math.round(currentValue));

    top.appendChild(lbl);
    top.appendChild(val);

    const bar = document.createElement("div");
    bar.className = "cs-bar";

    const fill = document.createElement("div");
    fill.className = "cs-fill";
    const pct = ((currentValue - min) / range) * 100;
    fill.style.width = Math.max(0, Math.min(100, pct)) + "%";

    bar.appendChild(fill);

    function updateDisplay(v: number): void {
        currentValue = v;
        val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
        const newPct = ((v - min) / range) * 100;
        fill.style.width = Math.max(0, Math.min(100, newPct)) + "%";
    }

    row.addEventListener("click", (e) => {
        const rect = row.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;

        let delta: number;
        if (x < 0.25) delta = -0.5;
        else if (x < 0.5) delta = -0.1;
        else if (x < 0.75) delta = 0.1;
        else delta = 0.5;

        let newVal = currentValue + delta;
        newVal = Math.round(newVal / step) * step;
        newVal = Math.max(min, Math.min(max, newVal));

        updateDisplay(newVal);
        onChange(newVal);
    });

    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);
}

function addColorSliderRow(container: HTMLElement, label: string, color: [number, number, number], onChange: (v: [number, number, number]) => void): void {
    const block = document.createElement("div");
    block.style.cssText = "margin-bottom:10px;";

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px;";

    const title = document.createElement("span");
    title.style.cssText = "font-size:14px;color:var(--text);";
    title.textContent = label;
    header.appendChild(title);

    const swatch = document.createElement("span");
    swatch.style.cssText = `display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid var(--white-08);background:rgb(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)});flex-shrink:0;`;
    header.appendChild(swatch);

    block.appendChild(header);

    const channels = [
        { label: "R", icon: "lucide:droplet" },
        { label: "G", icon: "lucide:droplet" },
        { label: "B", icon: "lucide:droplet" },
    ];
    const current: [number, number, number] = [color[0], color[1], color[2]];

    for (let ci = 0; ci < 3; ci++) {
        const sub = document.createElement("div");
        sub.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:2px;";
        const ch = document.createElement("span");
        ch.style.cssText = `font-size:11px;font-weight:600;width:14px;text-align:center;flex-shrink:0;color:${["#f66","#6f6","#66f"][ci]};`;
        ch.textContent = channels[ci].label;
        sub.appendChild(ch);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "1";
        slider.step = "0.01";
        slider.value = String(color[ci]);
        slider.dataset.channel = channels[ci].label.toLowerCase();
        slider.style.cssText = "flex:1;height:4px;";
        const val = document.createElement("span");
        val.style.cssText = "font-size:11px;color:var(--text-bright);width:28px;text-align:right;font-variant-numeric:tabular-nums;";
        val.textContent = color[ci].toFixed(2);
        slider.addEventListener("input", () => {
            const v = parseFloat(slider.value);
            val.textContent = v.toFixed(2);
            current[ci] = v;
            swatch.style.background = `rgb(${Math.round(current[0]*255)},${Math.round(current[1]*255)},${Math.round(current[2]*255)})`;
            onChange([current[0], current[1], current[2]]);
        });
        sub.appendChild(slider);
        sub.appendChild(val);
        block.appendChild(sub);
    }
    container.appendChild(block);
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

function buildPhysicsLevel(): PopupLevel {
    return {
        label: "物理",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            const gravity = getGravityStrength();
            addSliderRow(container, "物理重力", gravity, 0, 2, 0.05, (v) => {
                setGravityStrength(v);
            }, "lucide:arrow-down");
        },
    };
}

function buildPostProcessLevel(): PopupLevel {
    return {
        label: "后处理",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const state = getRenderState();
            container.style.padding = "12px 14px";

            // Bloom section
            addToggleRow(container, "泛光", state.bloomEnabled, (v) => {
                setRenderState({ bloomEnabled: v });
                triggerAutoSave();
            });
            const bloomFields = [
                { label: "泛光强度", key: "bloomWeight" as const, min: 0, max: 1, step: 0.05, icon: "lucide:sun" },
                { label: "泛光阈值", key: "bloomThreshold" as const, min: 0, max: 1, step: 0.05, icon: "lucide:sliders" },
                { label: "泛光核大小", key: "bloomKernel" as const, min: 0, max: 512, step: 1, icon: "lucide:circle" },
            ];
            for (const f of bloomFields) {
                addSliderRow(container, f.label, state[f.key], f.min, f.max, f.step, (v) => {
                    setRenderState({ [f.key]: v });
                    triggerAutoSave();
                }, (f as any).icon);
            }

            // FXAA toggle
            addToggleRow(container, "抗锯齿 (FXAA)", state.fxaaEnabled, (v) => {
                setRenderState({ fxaaEnabled: v });
                triggerAutoSave();
            });

            // Outline toggle (edge highlighting)
            addToggleRow(container, "边缘高亮", state.outlineEnabled, (v) => {
                setRenderState({ outlineEnabled: v });
                triggerAutoSave();
            });

            // Separator
            const sep1 = document.createElement("div");
            sep1.style.cssText = "height:1px;background:var(--white-08);margin:12px 0;";
            container.appendChild(sep1);

            // DOF section
            addToggleRow(container, "景深", state.dofEnabled, (v) => {
                setRenderState({ dofEnabled: v });
                triggerAutoSave();
            });
            addSliderRow(container, "光圈", state.dofAperture, 0, 10, 0.1, (v) => {
                setRenderState({ dofAperture: v });
                triggerAutoSave();
            }, "lucide:camera");
            addSliderRow(container, "暗化", state.dofDarken, 0, 1, 0.05, (v) => {
                setRenderState({ dofDarken: v });
                triggerAutoSave();
            }, "lucide:moon");

            // Vignette section
            addToggleRow(container, "暗角", state.vignetteEnabled, (v) => {
                setRenderState({ vignetteEnabled: v });
                triggerAutoSave();
            });
            addSliderRow(container, "暗角强度", state.vignetteDarkness, 0, 1, 0.05, (v) => {
                setRenderState({ vignetteDarkness: v });
                triggerAutoSave();
            }, "lucide:circle-dot");
        },
    };
}

function buildStageLevel(): PopupLevel {
    return {
        label: "舞台",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const state = getRenderState();
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
                btn.className = "mode-btn" + (state.toneMapping === i ? " active" : "");
                btn.addEventListener("click", () => {
                    setRenderState({ toneMapping: i });
                    triggerAutoSave();
                    sceneStack?.reRender();
                });
                tmRow.appendChild(btn);
            }
            container.appendChild(tmRow);

            // Exposure
            addSliderRow(container, "曝光", state.exposure, 0, 4, 0.05, (v) => {
                setRenderState({ exposure: v });
                triggerAutoSave();
            }, "lucide:lightbulb");
            // Contrast
            addSliderRow(container, "对比度", state.contrast, 0, 4, 0.05, (v) => {
                setRenderState({ contrast: v });
                triggerAutoSave();
            }, "lucide:contrast");
            // FOV
            addSliderRow(container, "视场角 (FOV)", state.fov, 0.1, 3, 0.05, (v) => {
                setRenderState({ fov: v });
                triggerAutoSave();
            }, "lucide:maximize-2");
            // Background color
            const bgLabel = document.createElement("div");
            bgLabel.style.cssText = "font-size:11px;color:var(--text-dim);margin:8px 0 4px;";
            bgLabel.textContent = "背景色 RGB";
            container.appendChild(bgLabel);
            const bgFields: Array<{ label: string; key: 0 | 1 | 2; icon: string }> = [
                { label: "R", key: 0, icon: "lucide:droplet" },
                { label: "G", key: 1, icon: "lucide:droplet" },
                { label: "B", key: 2, icon: "lucide:droplet" },
            ];
            for (const f of bgFields) {
                addSliderRow(container, f.label, state.bgColor[f.key], 0, 1, 0.01, (v) => {
                    const bg = [...getRenderState().bgColor] as [number, number, number];
                    bg[f.key] = v;
                    setRenderState({ bgColor: bg });
                    triggerAutoSave();
                }, f.icon);
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
        if (presets) {
            for (const p of presets) {
                userPresets[p.name] = p.params as unknown as Partial<RenderState>;
            }
        }
    } catch (err) {
        console.warn("loadUserPresets:", err);
    }
}

function refreshCameraLevel(): void {
    if (sceneStack) {
        sceneStack.setLevel(sceneStack.levelCount - 1, buildCameraLevel());
        sceneStack.reRender();
    }
}

function handleSceneAction(row: PopupRow): void {
    // Camera VMD actions
    if (row.target === "camera:load-vmd") {
        (async () => {
            try {
                const path = await SelectVMDMotion();
                if (!path) return;
                await loadCameraVmdFromPath(path);
                refreshCameraLevel();
            } catch (err) {
                console.error("Load camera VMD failed:", err);
                setStatus("✗ 相机 VMD 加载失败", false);
            }
        })();
        return;
    }
    if (row.target === "camera:clear-vmd") {
        clearCameraVmd();
        refreshCameraLevel();
        setStatus("✓ 已清除相机 VMD", true);
        return;
    }
    // Camera mode switching
    if (row.target && row.target.startsWith("camera:") && !row.target.includes(":params:")) {
        const mode = row.target.replace("camera:", "") as CameraMode;
        if (mode === "vmd" && !hasCameraVmd()) {
            setStatus("✗ 请先加载相机 VMD", false);
            return;
        }
        switchCameraMode(mode);
        refreshCameraLevel();
        const labels: Record<string, string> = {
            orbit: "轨道", freefly: "自由飞行",
            concert: "演唱会", vmd: "VMD 相机",
        };
        setStatus(`✓ 相机: ${labels[mode] || mode}`, true);
        return;
    }
    // Screenshot current focused model
    if (row.target === "screenshot:current") {
        (async () => {
            const id = focusedModelId;
            if (!id) { setStatus("✗ 无焦点模型", false); return; }
            const inst = modelRegistry.get(id);
            if (!inst) { setStatus("✗ 模型不存在", false); return; }
            try {
                const dir = await SelectDir();
                if (!dir) return;
                // Wait for render
                await new Promise(r => requestAnimationFrame(r));
                await new Promise(r => requestAnimationFrame(r));
                const base64 = dom.canvas.toDataURL("image/png", 0.9).replace(/^data:image\/png;base64,/, "");
                const ts = Date.now();
                const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, "_")}_${ts}.png`;
                await SaveScreenshot(dir, filename, base64);
                setStatus(`✓ 截图已保存: ${filename}`, true);
            } catch (err) {
                setStatus("✗ 截图失败", false);
                console.error("Screenshot error:", err);
            }
        })();
        return;
    }
    // Batch screenshot all loaded models
    if (row.target === "screenshot:batch") {
        if (modelRegistry.size === 0) { setStatus("✗ 场景中无模型", false); return; }
        (async () => {
            const dir = await SelectDir();
            if (!dir) return;
            let saved = 0;
            const prevFocused = focusedModelId;
            try {
                for (const [id, inst] of modelRegistry) {
                    setFocusedModelId(id);
                    focusModel(id);
                    // Wait for camera to settle (3 frames)
                    await new Promise(r => requestAnimationFrame(r));
                    await new Promise(r => requestAnimationFrame(r));
                    await new Promise(r => requestAnimationFrame(r));
                    const base64 = dom.canvas.toDataURL("image/png", 0.9).replace(/^data:image\/png;base64,/, "");
                    const ts = Date.now();
                    const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, "_")}_${ts}.png`;
                    await SaveScreenshot(dir, filename, base64);
                    saved++;
                    setStatus(`截图中… ${saved}/${modelRegistry.size}`, true);
                }
                if (prevFocused) {
                    setFocusedModelId(prevFocused);
                    focusModel(prevFocused);
                }
                setStatus(`✓ 批量截图完成: ${saved} 张`, true);
            } catch (err) {
                setStatus("✗ 批量截图失败", false);
                console.error("Batch screenshot error:", err);
            }
        })();
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
                await SaveScenePreset(json);
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
    // Procedural Motion actions
    if (row.target && row.target.startsWith("procmotion:set-mode:")) {
        const mode = row.target.replace("procmotion:set-mode:", "") as ProcMotionMode;
        setProcMotionMode(mode);
        regenerateProcMotion();
        sceneStack?.pop();
        sceneStack?.reRender();
        return;
    }
    if (row.target === "procmotion:autoswitch") {
        const cur = getProcMotionState();
        setProcMotionAutoSwitch(!cur.autoSwitch);
        sceneStack?.reRender();
        return;
    }
    if (row.target === "procmotion:mode") {
        sceneStack?.push(buildProcMotionModeLevel());
        return;
    }
}

export async function showSceneMenu(): Promise<void> {
    closeAllOverlays();
    dom.sceneOverlay.classList.add("visible");

    // Load user presets from backend
    await loadUserPresets();

    if (!sceneStack) {
        sceneStack = new SlideMenu({
            container: dom.sceneOverlay,
            onClose: () => closeAllOverlays(),
            onItemClick: (row) => handleSceneAction(row),
            onFolderEnter: (row) => {
                switch (row.target) {
                    case "scene:presets": return buildPresetScenesLevel();
                    case "scene:env": return buildEnvLevel();
                    case "scene:env:sky": return buildSkyLevel();
                    case "scene:env:ground": return buildGroundLevel();
                    case "scene:env:particle": return buildParticleLevel();
                    case "scene:env:wind": return buildWindLevel();
                    case "scene:env:cloud": return buildCloudLevel();
                    case "scene:env:post": return buildPostProcessLevel();
                    case "scene:env:light": return buildLightLevel();
                    case "scene:env:presets": return buildPresetLevel();
                    case "scene:camera": return buildCameraLevel();
                    case "scene:light": return buildLightLevel();
                    case "scene:render": return buildRenderLevel();
                    case "scene:physics": return buildPhysicsLevel();
                    case "scene:procmotion": return buildProcMotionLevel();
                    case "procmotion:mode": return buildProcMotionModeLevel();
                    case "scene:screenshot": return buildScreenshotLevel();
                    case "camera:params:orbit": return buildCameraParamsLevel("orbit");
                    case "camera:params:freefly": return buildCameraParamsLevel("freefly");
                    case "camera:params:concert": return buildCameraParamsLevel("concert");
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

/** Open scene overlay and jump directly into environment level. */
export async function showEnvMenu(): Promise<void> {
    closeAllOverlays();
    dom.sceneOverlay.classList.add("visible");

    await loadUserPresets();

    if (!sceneStack) {
        sceneStack = new SlideMenu({
            container: dom.sceneOverlay,
            onClose: () => closeAllOverlays(),
            onItemClick: (row) => handleSceneAction(row),
            onFolderEnter: (row) => {
                switch (row.target) {
                    case "scene:presets": return buildPresetScenesLevel();
                    case "scene:env": return buildEnvLevel();
                    case "scene:env:sky": return buildSkyLevel();
                    case "scene:env:ground": return buildGroundLevel();
                    case "scene:env:particle": return buildParticleLevel();
                    case "scene:env:wind": return buildWindLevel();
                    case "scene:env:cloud": return buildCloudLevel();
                    case "scene:env:post": return buildPostProcessLevel();
                    case "scene:env:light": return buildLightLevel();
                    case "scene:env:presets": return buildPresetLevel();
                    default: return null;
                }
            },
            onAfterRender: () => {},
        });
    }

    sceneStack.reset(buildEnvLevel());
}

// Wire up events
dom.btnScene.addEventListener("click", showSceneMenu);
dom.btnEnv.addEventListener("click", showEnvMenu);
