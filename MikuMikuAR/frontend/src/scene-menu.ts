// [doc:architecture] Scene Menu — 场景弹窗（相机/灯光/渲染预设）
// 规范文档: docs/architecture.md §渲染环节
// 职责: MenuStack 场景弹窗、相机/灯光/渲染参数面板、渲染预设
// Scene menu — consolidated camera + lighting controls (MenuStack-based).

import {
    dom, closeAllOverlays, setStatus, escapeHtml,
    PopupRow, PopupLevel, cardContainer,
} from "./config";
import { SlideMenu } from "./menu";
import { createIconifyIcon } from "./icons";
import { slideRow, addToggleRow, addSliderRow, addColorSliderRow, addModeSlider } from "./ui-helpers";
import {
    switchCameraMode, getCameraMode, hasCameraVmd, getCameraVmdName, clearCameraVmd, getCurrentCamera,
    getOrbitParams, setOrbitParams,
    getFreeflyParams, setFreeflyParams,
    getConcertParams, setConcertParams,
    type CameraMode,
} from "./camera";
import { getLightState, setLightState, triggerAutoSave, serializeScene, deserializeScene, getRenderState, setRenderState, loadCameraVmdFromPath } from "./scene";
import type { RenderState } from "./scene";
import { SelectSceneSaveFile, SelectSceneOpenFile, SaveSceneFile, LoadSceneFile, SaveRenderPreset, DeleteRenderPreset, GetRenderPresets, SelectVMDMotion, SelectDir, SaveScreenshot,
    GetPresetScenes, GetPresetScenesDir, SaveScenePreset, DeletePresetScene } from "../wailsjs/go/main/App";
import { focusModel, setGravityStrength, getGravityStrength, setProcMotionMode, setProcMotionIntensity, setProcMotionSpeed, setProcMotionAutoSwitch, getProcMotionState, regenerateProcMotion, getLipSyncState, setLipSyncEnabled, setLipSyncSensitivity, setLipSyncIntensity } from "./scene";
import { modelRegistry, focusedModelId, setFocusedModelId } from "./config";
import type { ProcMotionMode } from "./procedural-motion";
import { buildEnvLevel, buildSkyLevel, buildGroundLevel, buildParticleLevel, buildWindLevel, buildCloudLevel, buildEnvLightingLevel, buildPresetLevel, setEnvMenuStack } from "./env-menu";

// ======== Scene Menu (SlideMenu) ========

let sceneStack: SlideMenu | null = null;
export function getSceneStack(): SlideMenu | null { return sceneStack; }

function buildSceneRoot(): PopupLevel {
    return {
        label: "场景",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            container.style.padding = "0";
            // Card 1: 场景管理
            cardContainer(container, (c) => {
                slideRow(c, "lucide:bookmark", "预设场景", true, () => sceneStack?.push(buildPresetScenesLevel()));
                slideRow(c, "lucide:save", "保存场景", false, () => {
                    SelectSceneSaveFile().then(path => {
                        if (!path) return;
                        const json = JSON.stringify(serializeScene(), null, 2);
                        SaveSceneFile(json, path).then(() => SaveScenePreset(json)).then(() => setStatus("✓ 场景已保存", true)).catch(() => setStatus("✗ 保存失败", false));
                    });
                });
                slideRow(c, "lucide:upload", "加载场景", false, () => {
                    SelectSceneOpenFile().then(path => {
                        if (!path) return;
                        LoadSceneFile(path).then(json => deserializeScene(JSON.parse(json))).then(() => setStatus("✓ 场景已加载", true)).catch(() => setStatus("✗ 加载失败", false));
                    });
                });
            });
            // Card 2: 渲染与相机
            cardContainer(container, (c) => {
                slideRow(c, "lucide:camera", "相机模式", true, () => sceneStack?.push(buildCameraLevel()));
                slideRow(c, "lucide:sun", "灯光", true, () => sceneStack?.push(buildLightLevel()));
                slideRow(c, "lucide:sparkles", "渲染", true, () => sceneStack?.push(buildRenderLevel()));
                slideRow(c, "lucide:toggle-left", "物理", true, () => sceneStack?.push(buildPhysicsLevel()));
            });
            // Card 3: 程序化动作
            cardContainer(container, (c) => {
                slideRow(c, "lucide:wind", "程序化动作", true, () => sceneStack?.push(buildProcMotionLevel()));
            });
            // Card 4: 工具
            cardContainer(container, (c) => {
                slideRow(c, "lucide:camera", "截图", true, () => sceneStack?.push(buildScreenshotLevel()));
            });
        },
    };
}

function buildProcMotionLevel(): PopupLevel {
    const st = getProcMotionState();
    const lipSt = getLipSyncState();
    const modeLabel: Record<string, string> = {
        off: "关闭", idle: "待机呼吸", autodance: "自动舞蹈",
    };
    return {
        label: "程序化动作",
        dir: "",
        items: [
            { kind: "folder", label: "模式", icon: "wind", target: "procmotion:mode", sublabel: modeLabel[st.mode] },
            { kind: "action", label: "自动切换", icon: "repeat", target: "procmotion:autoswitch", sublabel: st.autoSwitch ? "开" : "关" },
            { kind: "folder", label: "LipSync", icon: "mic", target: "lipsync:menu", sublabel: lipSt.enabled ? "开" : "关" },
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

function buildLipSyncLevel(): PopupLevel {
    const st = getLipSyncState();
    return {
        label: "LipSync",
        dir: "",
        items: [
            { kind: "action", label: "启用", icon: st.enabled ? "check" : "circle", target: "lipsync:toggle", sublabel: st.enabled ? "开" : "关" },
        ],
        renderCustom: (container) => {
            container.style.padding = "8px 6px";
            // 灵敏度：UI 上「越大越灵敏」= sensitivity 越小，故反转显示
            addSliderRow(container, "灵敏度", 1 - st.sensitivity, 0, 1, 0.05, (v) => {
                setLipSyncSensitivity(1 - v);
            }, "lucide:volume-2");
            addSliderRow(container, "强度", st.intensity, 0, 1, 0.05, (v) => {
                setLipSyncIntensity(v);
            }, "lucide:activity");
        },
    };
}

let currentPresetIndex = -1;
let _presetScenes: string[] = []; // cached for nav buttons, refreshed on re-render

async function _loadPresetScene(name: string): Promise<boolean> {
    try {
        const dir = await GetPresetScenesDir();
        const json = await LoadSceneFile(dir + "/" + name);
        await deserializeScene(JSON.parse(json));
        return true;
    } catch (err) {
        console.error("Load preset scene failed:", err);
        setStatus("✗ 加载预设场景失败", false);
        return false;
    }
}

function buildPresetScenesLevel(): PopupLevel {
    return {
        label: "预设场景",
        dir: "",
        items: [],
        renderCustom: async (container) => {
            container.classList.remove("render-card");
            _presetScenes = await GetPresetScenes() || [];
            const scenes = _presetScenes;
            if (scenes.length === 0) {
                const empty = document.createElement("div");
                empty.style.cssText = "font-size:12px;color:var(--text-dim);text-align:center;padding:24px;";
                empty.textContent = "暂无预设场景，保存场景时自动生成";
                container.appendChild(empty);
                return;
            }

            cardContainer(container, (c) => {
                const navRow = document.createElement("div");
                navRow.style.cssText = "display:flex;gap:6px;padding:8px 14px;";
                const prevBtn = document.createElement("button");
                prevBtn.className = "mode-btn";
                prevBtn.innerHTML = '<iconify-icon icon="lucide:skip-back"></iconify-icon> 上一个';
                prevBtn.style.flex = "1";
                prevBtn.addEventListener("click", async () => {
                    if (scenes.length === 0) return;
                    if (currentPresetIndex < 0) currentPresetIndex = 0;
                    currentPresetIndex = (currentPresetIndex - 1 + scenes.length) % scenes.length;
                    if (await _loadPresetScene(scenes[currentPresetIndex])) {
                        setStatus(`✓ 预设场景: ${scenes[currentPresetIndex]} (${currentPresetIndex + 1}/${scenes.length})`, true);
                    }
                });
                const nextBtn = document.createElement("button");
                nextBtn.className = "mode-btn";
                nextBtn.innerHTML = '下一个 <iconify-icon icon="lucide:skip-forward"></iconify-icon>';
                nextBtn.style.flex = "1";
                nextBtn.addEventListener("click", async () => {
                    if (scenes.length === 0) return;
                    if (currentPresetIndex < 0) currentPresetIndex = 0;
                    currentPresetIndex = (currentPresetIndex + 1) % scenes.length;
                    if (await _loadPresetScene(scenes[currentPresetIndex])) {
                        setStatus(`✓ 预设场景: ${scenes[currentPresetIndex]} (${currentPresetIndex + 1}/${scenes.length})`, true);
                    }
                });
                navRow.appendChild(prevBtn);
                navRow.appendChild(nextBtn);
                c.appendChild(navRow);
            });

            cardContainer(container, (c) => {
                for (let i = 0; i < scenes.length; i++) {
                    const name = scenes[i];
                    const isActive = i === currentPresetIndex;
                    const row = document.createElement("div"); row.className = "slide-item";
                    const is = document.createElement("span"); is.className = "slide-icon";
                    const ie = createIconifyIcon(isActive ? "lucide:play-circle" : "lucide:bookmark"); if (ie) is.appendChild(ie);
                    row.appendChild(is);
                    const ls = document.createElement("span"); ls.className = "slide-label"; ls.textContent = name;
                    row.appendChild(ls);
                    const delBtn = document.createElement("span");
                    delBtn.textContent = "✕";
                    delBtn.title = "删除此预设场景";
                    delBtn.style.cssText = "font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 4px;";
                    delBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        if (!confirm(`确定删除「${name}」？`)) return;
                        try {
                            await DeletePresetScene(name);
                            if (currentPresetIndex === i) currentPresetIndex = -1;
                            else if (currentPresetIndex > i) currentPresetIndex--;
                            sceneStack?.reRender();
                            setStatus(`✓ 已删除: ${name}`, true);
                        } catch { setStatus("✗ 删除失败", false); }
                    });
                    row.appendChild(delBtn);
                    row.addEventListener("click", async () => {
                        currentPresetIndex = i;
                        if (await _loadPresetScene(name)) {
                            sceneStack?.reRender();
                            setStatus(`✓ 已加载: ${name}`, true);
                        }
                    });
                    c.appendChild(row);
                }
            });
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
            container.classList.remove("render-card");
            const lightState = getLightState();
            container.style.padding = "6px 0";

            // Card 1: light sliders
            cardContainer(container, (c) => {
                const fields: Array<{ label: string; key: "hemiIntensity" | "dirIntensity" | "dirX" | "dirY" | "dirZ"; min: number; max: number; step: number; icon: string }> = [
                    { label: "环境光强度", key: "hemiIntensity", min: 0, max: 2, step: 0.05, icon: "lucide:sun" },
                    { label: "方向光强度", key: "dirIntensity", min: 0, max: 2, step: 0.05, icon: "lucide:sun" },
                    { label: "方向光角度 X", key: "dirX", min: -1, max: 1, step: 0.05, icon: "lucide:move" },
                    { label: "方向光角度 Y", key: "dirY", min: -1, max: 1, step: 0.05, icon: "lucide:arrow-up-down" },
                    { label: "方向光角度 Z", key: "dirZ", min: -1, max: 1, step: 0.05, icon: "lucide:arrow-up-down" },
                ];
                for (const f of fields) {
                    addSliderRow(c, f.label, lightState[f.key], f.min, f.max, f.step, (v) => {
                        setLightState({ [f.key]: v } as any);
                    }, f.icon);
                }
            });

            // Card 2-4: color pickers
            cardContainer(container, (c) => addColorSliderRow(c, "方向光色", lightState.dirColor, (v) => setLightState({ dirColor: v })));
            cardContainer(container, (c) => addColorSliderRow(c, "环境光色", lightState.hemiColor, (v) => setLightState({ hemiColor: v })));
            cardContainer(container, (c) => addColorSliderRow(c, "地面光色", lightState.groundColor, (v) => setLightState({ groundColor: v })));

            // Card 5: shadow controls
            cardContainer(container, (c) => {
                c.style.padding = "10px";
                addToggleRow(c, "启用阴影", lightState.shadowEnabled, (v) => setLightState({ shadowEnabled: v }));
                addModeSlider(c, "阴影类型", [
                    { value: "hard", label: "硬" },
                    { value: "soft", label: "软" },
                    { value: "pcf", label: "柔和阴影" },
                ], lightState.shadowType, (v) => { setLightState({ shadowType: v }); sceneStack?.reRender(); }, "lucide:shadow");
            });
        },
    };
}

// ======== Environment Lighting Panel (Unified) ========


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

            // DOF section
            addToggleRow(container, "景深", state.dofEnabled, (v) => {
                setRenderState({ dofEnabled: v });
                triggerAutoSave();
            });
            addSliderRow(container, "光圈", state.dofAperture, 0, 10, 0.1, (v) => {
                setRenderState({ dofAperture: v });
                triggerAutoSave();
            }, "lucide:camera");

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
            addModeSlider(container, "色调映射", [
                { value: 0, label: "关闭" },
                { value: 1, label: "ACES" },
                { value: 2, label: "Reinhard" },
                { value: 3, label: "Cineon" },
                { value: 4, label: "Neutral" },
            ], state.toneMapping, (v) => { setRenderState({ toneMapping: v }); triggerAutoSave(); sceneStack?.reRender(); }, "lucide:palette");

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
    return {
        label: "渲染预设",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            // Card 1: built-in presets
            cardContainer(container, (c) => {
                for (const [key] of Object.entries(builtinPresets)) {
                    const row = document.createElement("div");
                    row.className = "slide-item";
                    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:palette"></iconify-icon></span><span class="slide-label">${PRESET_LABELS[key] || key}</span>`;
                    row.addEventListener("click", () => {
                        const preset = getBuiltinPreset(key);
                        if (preset) setRenderState(preset);
                        setStatus(`✓ 预设: ${PRESET_LABELS[key]}`, true);
                    });
                    c.appendChild(row);
                }
            });
            // Save
            const saveRow = document.createElement("div");
            saveRow.className = "slide-item";
            saveRow.innerHTML = '<span class="slide-icon"><iconify-icon icon="lucide:save"></iconify-icon></span><span class="slide-label">保存当前为预设</span>';
            saveRow.addEventListener("click", showPresetSaveDialog);
            container.appendChild(saveRow);
            // Card 2: user presets
            if (Object.keys(userPresets).length > 0) {
                cardContainer(container, (c) => {
                    for (const [name] of Object.entries(userPresets)) {
                        const row = document.createElement("div");
                        row.className = "slide-item";
                        row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:palette"></iconify-icon></span><span class="slide-label">${escapeHtml(name)}</span>`;
                        row.addEventListener("click", () => {
                            setRenderState(userPresets[name]);
                            setStatus(`✓ 预设: ${name}`, true);
                        });
                        c.appendChild(row);
                        const delRow = document.createElement("div");
                        delRow.className = "slide-item";
                        delRow.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:trash-2"></iconify-icon></span><span class="slide-label" style="color:var(--text-dim);">删除: ${escapeHtml(name)}</span>`;
                        delRow.addEventListener("click", () => {
                            DeleteRenderPreset(name).then(() => {
                                delete userPresets[name];
                                if (sceneStack) { sceneStack.setLevel(sceneStack.levelCount - 1, buildPresetsLevel()); sceneStack.reRender(); }
                                setStatus(`✓ 预设已删除: ${name}`, true);
                            }).catch(() => setStatus("✗ 删除失败", false));
                        });
                        c.appendChild(delRow);
                    }
                });
            }
        },
    };
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
    // LipSync actions
    if (row.target === "lipsync:menu") {
        sceneStack?.push(buildLipSyncLevel());
        return;
    }
    if (row.target === "lipsync:toggle") {
        const cur = getLipSyncState();
        setLipSyncEnabled(!cur.enabled);
        sceneStack?.reRender();
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
                    case "scene:env:lighting": return buildEnvLightingLevel();
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
        setEnvMenuStack(sceneStack);
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
                    case "scene:env:lighting": return buildEnvLightingLevel();
                    case "scene:env:post": return buildPostProcessLevel();
                    case "scene:env:light": return buildLightLevel();
                    case "scene:env:presets": return buildPresetLevel();
                    default: return null;
                }
            },
            onAfterRender: () => {},
        });
        setEnvMenuStack(sceneStack);
    }

    sceneStack.reset(buildEnvLevel());
}

// Wire up events
dom.btnScene?.addEventListener("click", showSceneMenu);
dom.btnEnv?.addEventListener("click", showEnvMenu);