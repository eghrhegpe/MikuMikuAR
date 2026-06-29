// [doc:architecture] Env Menu — 环境弹窗（天空/地面/粒子/风/云/道具/预设）
// 从 scene-menu.ts 抽离

import { envState, EnvState, PopupLevel, PopupRow, escapeHtml, cardContainer, propRegistry, dom, closeAllOverlays } from "../core/config";
import { SlideMenu } from "./menu";
import { createIconifyIcon } from "../core/icons";
import { slideRow, addToggleRow, addSliderRow, addColorSliderRow, addModeSlider } from "../core/ui-helpers";
import { setEnvState, loadProp, removeProp, setPropTransform, getPropList, getEnvAutoLink, setEnvAutoLink, getEnvSunAngle, setEnvSunAngle, redoEnvAutoLink, applyEnvPreset, setLightState, setRenderState } from "../scene/scene";
import { ENV_PRESETS as ENV_LIGHTING_PRESETS, WATER_PRESETS } from "../scene/env-lighting";
import { SelectEnvTextureFile, SelectPMXFile } from "../../wailsjs/go/main/App";

// ======== Environment Level ========

let envMenu: SlideMenu | null = null;
export function getEnvMenu(): SlideMenu | null { return envMenu; }

export function buildEnvLightingLevel(): PopupLevel {
    const autoLink = getEnvAutoLink();
    const sunAngle = getEnvSunAngle();
    return {
        label: "环境光照",
        dir: "",
        items: [
            { kind: "divider" as const, label: "", icon: "", target: "" } as PopupRow,
        ],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addToggleRow(c, "自动联动", autoLink, (v) => setEnvAutoLink(v));
                const presetRow = document.createElement("div");
                presetRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;padding:0 14px 10px;";
                for (const [key, p] of Object.entries(ENV_LIGHTING_PRESETS)) {
                    const btn = document.createElement("button");
                    btn.textContent = p.label;
                    btn.className = "mode-btn mode-btn-sm";
                    btn.addEventListener("click", () => { applyEnvPreset(key); envMenu?.reRender(); });
                    presetRow.appendChild(btn);
                }
                c.appendChild(presetRow);
                addSliderRow(c, "太阳角度", sunAngle, -15, 90, 1, (v) => { setEnvSunAngle(v); redoEnvAutoLink(); }, "lucide:sun");
            });
        },
    };
}

export function buildEnvLevel(): PopupLevel {
    return {
        label: "环境",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            cardContainer(container, (c) => {
                slideRow(c, "lucide:sun", "环境光照", true, () => envMenu?.push(buildEnvLightingLevel()));
                slideRow(c, "lucide:sun", "天空", true, () => envMenu?.push(buildSkyLevel()));
                slideRow(c, "lucide:waves", "水面", true, () => envMenu?.push(buildWaterLevel()));
                slideRow(c, "lucide:wind", "粒子", true, () => envMenu?.push(buildParticleLevel()));
                slideRow(c, "lucide:wind", "风", true, () => envMenu?.push(buildWindLevel()));
                slideRow(c, "lucide:cloud", "云", true, () => envMenu?.push(buildCloudLevel()));
                slideRow(c, "lucide:box", "道具", true, () => envMenu?.push(buildPropLevel()));
            });
            cardContainer(container, (c) => {
                slideRow(c, "lucide:bookmark", "系统预设", true, () => envMenu?.push(buildPresetLevel()));
            });
        },
    };
}

interface EnvPresetConfig {
    env: Partial<EnvState>;
    lights?: Partial<import("../scene/scene").LightState>;
    render?: Partial<import("../scene/scene").RenderState>;
}

const ENV_PRESETS: Record<string, EnvPresetConfig> = {
    "舞台-A 打光": {
        env: { skyMode: "procedural", skyColorTop: [0.05, 0.05, 0.15], skyColorBot: [0.1, 0.05, 0.15], envIntensity: 0.5, groundMode: "solid", groundColor: [0.05, 0.05, 0.08], particleEnabled: false },
        lights: { hemiIntensity: 0.4, dirIntensity: 0.6, dirColor: [1, 0.85, 0.7], shadowEnabled: true, shadowType: "soft" },
        render: { vignetteEnabled: true, vignetteDarkness: 0.3, exposure: 1.2 },
    },
    "户外晴天": {
        env: { skyMode: "procedural", skyColorTop: [0.3, 0.6, 1], skyColorBot: [0.6, 0.8, 1], skyBrightness: 2, envIntensity: 1.5, groundMode: "grid", groundColor: [0.3, 0.35, 0.3] },
        lights: { hemiIntensity: 1, dirIntensity: 1.2, dirColor: [1, 0.95, 0.85], shadowEnabled: true, shadowType: "pcf" },
        render: { exposure: 1.4, toneMapping: 1 },
    },
    "演唱会蓝紫": {
        env: { skyMode: "procedural", skyColorTop: [0.4, 0.1, 0.6], skyColorMid: [0.2, 0.05, 0.4], skyColorBot: [0.1, 0.02, 0.2], envIntensity: 0.3, groundMode: "solid", groundColor: [0.05, 0.02, 0.1], particleEnabled: true, particleType: "fireworks" },
        lights: { hemiIntensity: 0.3, dirIntensity: 0.5, dirColor: [0.6, 0.3, 0.8], hemiColor: [0.3, 0.1, 0.5], shadowEnabled: false },
        render: { vignetteEnabled: true, vignetteDarkness: 0.5, exposure: 0.9, toneMapping: 3 },
    },
};

export function buildPresetLevel(): PopupLevel {
    const entries = Object.entries(ENV_PRESETS);
    return {
        label: "系统预设",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            cardContainer(container, (c) => {
                for (const [name, preset] of entries) {
                    slideRow(c, "lucide:bookmark", name, false, () => {
                        setEnvState({ ...preset.env });
                        if (preset.lights) setLightState(preset.lights);
                        if (preset.render) setRenderState(preset.render);
                        envMenu?.reRender();
                    });
                }
            });
        },
    };
}

export function buildSkyLevel(): PopupLevel {
    return {
        label: "天空",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addModeSlider(c, "天空模式", [
                    { value: "color", label: "纯色" }, { value: "texture", label: "贴图" }, { value: "procedural", label: "程序化" },
                ], s.skyMode, (v) => { setEnvState({ skyMode: v }); envMenu?.reRender(); }, "lucide:sun");

                if (s.skyMode === "color") addColorSliderRow(c, "天空色", s.skyColorTop, (v) => setEnvState({ skyColorTop: v }));
                else if (s.skyMode === "procedural") {
                    addColorSliderRow(c, "天顶色", s.skyColorTop, (v) => setEnvState({ skyColorTop: v }));
                    addColorSliderRow(c, "地平色", s.skyColorBot, (v) => setEnvState({ skyColorBot: v }));
                    addToggleRow(c, "星空 ✨", s.starsEnabled ?? false, (v) => setEnvState({ starsEnabled: v }));
                }

                if (s.skyMode === "texture") {
                    const hint = document.createElement("div");
                    hint.style.cssText = "font-size:11px;color:var(--text-dim);padding:4px 14px 0;";
                    hint.textContent = "支持 .hdr / .dds / .exr 格式的环境贴图";
                    c.appendChild(hint);
                    const texRow = document.createElement("div");
                    texRow.className = "slide-item";
                    const fileName = s.skyTexture ? s.skyTexture.split(/[/\\]/).pop() : "未选择";
                    const ti = document.createElement("span"); ti.className = "slide-icon";
                    const te = createIconifyIcon("lucide:image"); if (te) ti.appendChild(te);
                    texRow.appendChild(ti);
                    const tl = document.createElement("span"); tl.className = "slide-label"; tl.textContent = "环境贴图";
                    texRow.appendChild(tl);
                    const ts = document.createElement("span"); ts.className = "slide-sublabel"; ts.textContent = fileName;
                    texRow.appendChild(ts);
                    texRow.addEventListener("click", async () => {
                        const path = await SelectEnvTextureFile().catch(() => "");
                        if (path) setEnvState({ skyTexture: path });
                    });
                    c.appendChild(texRow);
                    addSliderRow(c, "旋 Y", s.skyRotationY, 0, 360, 1, (v) => setEnvState({ skyRotationY: v }), "lucide:refresh-cw");
                    addSliderRow(c, "环境光强度", s.envIntensity, 0, 3, 0.05, (v) => setEnvState({ envIntensity: v }), "lucide:sun");
                }
                if (s.skyMode === "procedural") addSliderRow(c, "亮度", s.skyBrightness, 0.1, 5, 0.1, (v) => setEnvState({ skyBrightness: v }), "lucide:brightness");
                addSliderRow(c, "天空旋转速度", s.skyRotationSpeed ?? 0, 0, 5, 0.1, (v) => setEnvState({ skyRotationSpeed: v }), "lucide:rotate-cw");
            });
        },
    };
}

export function buildGroundLevel(): PopupLevel {
    return {
        label: "地面",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(c, "显示地面", s.groundVisible, (v) => setEnvState({ groundVisible: v }));
                addModeSlider(c, "地面模式", [
                    { value: "solid", label: "纯色" }, { value: "grid", label: "网格" }, { value: "checker", label: "棋盘格" },
                ], s.groundMode, (v) => { setEnvState({ groundMode: v }); envMenu?.reRender(); }, "lucide:square");
                addColorSliderRow(c, "地面色", s.groundColor, (v) => setEnvState({ groundColor: v }));
                if (s.groundMode === "solid" || s.groundMode === "checker") addSliderRow(c, "透明度", s.groundAlpha, 0, 1, 0.05, (v) => setEnvState({ groundAlpha: v }), "lucide:eye");
            });
        },
    };
}

export function buildPropLevel(): PopupLevel {
    return {
        label: "道具",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            container.style.padding = "0";
            cardContainer(container, (c) => {
                slideRow(c, "lucide:plus", "添加道具文件", false, () => {
                    SelectPMXFile().then(path => { if (path) loadProp(path).then(() => envMenu?.reRender()).catch(() => {}); });
                });
            });
            const props = getPropList();
            if (props.length > 0) {
                cardContainer(container, (c) => {
                    for (const p of props) {
                        const row = document.createElement("div");
                        row.className = "slide-item";
                        row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:box"></iconify-icon></span><span class="slide-label">${escapeHtml(p.name)}</span><span class="slide-arrow">&gt;</span>`;
                        row.addEventListener("click", () => envMenu?.push(buildPropDetailLevel(p.id)));
                        const delBtn = document.createElement("span");
                        delBtn.className = "slide-del-btn";
                        delBtn.textContent = "×";
                        delBtn.title = "删除道具";
                        delBtn.addEventListener("click", (e) => { e.stopPropagation(); removeProp(p.id); envMenu?.reRender(); });
                        row.appendChild(delBtn);
                        c.appendChild(row);
                    }
                });
            } else {
                cardContainer(container, (c) => {
                    const empty = document.createElement("div");
                    empty.style.cssText = "font-size:11px;color:var(--text-dim);padding:8px 4px;text-align:center;";
                    empty.textContent = "暂无道具，点击上方添加";
                    c.appendChild(empty);
                });
            }
        },
    };
}

export function buildPropDetailLevel(propId: string): PopupLevel {
    return {
        label: "道具变换",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const p = propRegistry.get(propId);
            if (!p) {
                const empty = document.createElement("div");
                empty.style.cssText = "font-size:11px;color:var(--text-dim);padding:8px 4px;";
                empty.textContent = "道具不存在（可能已被删除）";
                container.appendChild(empty);
                return;
            }
            cardContainer(container, (c) => {
                const title = document.createElement("div");
                title.style.cssText = "font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;";
                title.textContent = p.name;
                c.appendChild(title);
                addSliderRow(c, "位置 X", p.position[0], -50, 50, 0.5, (v) => { setPropTransform(propId, { position: [v, p.position[1], p.position[2]] }); p.position[0] = v; }, "lucide:move-horizontal");
                addSliderRow(c, "位置 Y", p.position[1], -50, 50, 0.5, (v) => { setPropTransform(propId, { position: [p.position[0], v, p.position[2]] }); p.position[1] = v; }, "lucide:move-vertical");
                addSliderRow(c, "位置 Z", p.position[2], -50, 50, 0.5, (v) => { setPropTransform(propId, { position: [p.position[0], p.position[1], v] }); p.position[2] = v; }, "lucide:move");
                addSliderRow(c, "旋转 Y", p.rotationY, -Math.PI, Math.PI, 0.1, (v) => { setPropTransform(propId, { rotationY: v }); p.rotationY = v; }, "lucide:rotate-cw");
                addSliderRow(c, "缩放", p.scaling, 0.1, 10, 0.1, (v) => { setPropTransform(propId, { scaling: v }); p.scaling = v; }, "lucide:maximize");
                addToggleRow(c, "可见", p.visible, (v) => { setPropTransform(propId, { visible: v }); p.visible = v; });
                const delBtn = document.createElement("button");
                delBtn.textContent = "删除道具";
                delBtn.className = "btn btn-sm btn-danger";
                delBtn.style.cssText = "width:calc(100% - 28px);margin:10px 14px 6px;";
                delBtn.addEventListener("click", () => { removeProp(propId); envMenu?.pop(); envMenu?.reRender(); });
                c.appendChild(delBtn);
            });
        },
    };
}

export function buildParticleLevel(): PopupLevel {
    return {
        label: "粒子",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(c, "启用粒子", s.particleEnabled, (v) => setEnvState({ particleEnabled: v }));
                addModeSlider(c, "粒子类型", [
                    { value: "none", label: "无" }, { value: "sakura", label: "🌸 樱花" }, { value: "rain", label: "🌧 雨" }, { value: "snow", label: "❄ 雪" }, { value: "fireworks", label: "🎆 烟花" }, { value: "fireflies", label: "✨ 萤火虫" }, { value: "leaves", label: "🍂 落叶" },
                ], s.particleType, (v) => { setEnvState({ particleType: v }); envMenu?.reRender(); }, "lucide:sparkles");
                addSliderRow(c, "密度", s.particleEmitRate, 0, 3, 0.1, (v) => setEnvState({ particleEmitRate: v }), "lucide:layers");
                addSliderRow(c, "大小", s.particleSize, 0.1, 3, 0.1, (v) => setEnvState({ particleSize: v }), "lucide:maximize");
                addSliderRow(c, "速度", s.particleSpeed, 0.1, 5, 0.1, (v) => setEnvState({ particleSpeed: v }), "lucide:gauge");
            });
        },
    };
}

export function buildWaterLevel(): PopupLevel {
    return {
        label: "水面",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(c, "启用水面", s.waterEnabled, (v) => setEnvState({ waterEnabled: v }));
                const waterPresetRow = document.createElement("div");
                waterPresetRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;padding:0 14px 10px;";
                for (const [key, wp] of Object.entries(WATER_PRESETS)) {
                    const btn = document.createElement("button");
                    btn.textContent = wp.label;
                    btn.className = "mode-btn mode-btn-sm";
                    btn.addEventListener("click", () => {
                        setEnvState({
                            waterColor: wp.waterColor,
                            waterTransparency: wp.waterTransparency,
                            waterWaveHeight: wp.waterWaveHeight,
                            waterAnimSpeed: wp.waterAnimSpeed,
                        });
                        envMenu?.reRender();
                    });
                    waterPresetRow.appendChild(btn);
                }
                c.appendChild(waterPresetRow);
                addSliderRow(c, "高度", s.waterLevel, -10, 10, 0.1, (v) => setEnvState({ waterLevel: v }), "lucide:arrow-up");
                addColorSliderRow(c, "水色", s.waterColor, (v) => setEnvState({ waterColor: v }));
                addSliderRow(c, "透明度", s.waterTransparency, 0, 1, 0.05, (v) => setEnvState({ waterTransparency: v }), "lucide:eye");
                addSliderRow(c, "波高", s.waterWaveHeight, 0, 3, 0.1, (v) => setEnvState({ waterWaveHeight: v }), "lucide:waves");
                addSliderRow(c, "动画速度", s.waterAnimSpeed ?? 1, 0.1, 5, 0.1, (v) => setEnvState({ waterAnimSpeed: v }), "lucide:fast-forward");
                addSliderRow(c, "范围", s.waterSize, 10, 200, 5, (v) => setEnvState({ waterSize: v }), "lucide:maximize");
            });
        },
    };
}

export function buildWindLevel(): PopupLevel {
    return {
        label: "风",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(c, "启用风", s.windEnabled, (v) => setEnvState({ windEnabled: v }));
                addSliderRow(c, "风向 X", s.windDirection[0], -1, 1, 0.05, (v) => { const d: [number, number, number] = [...s.windDirection]; d[0] = v; setEnvState({ windDirection: d }); }, "lucide:compass");
                addSliderRow(c, "风向 Y", s.windDirection[1], -1, 1, 0.05, (v) => { const d: [number, number, number] = [...s.windDirection]; d[1] = v; setEnvState({ windDirection: d }); }, "lucide:compass");
                addSliderRow(c, "风向 Z", s.windDirection[2], -1, 1, 0.05, (v) => { const d: [number, number, number] = [...s.windDirection]; d[2] = v; setEnvState({ windDirection: d }); }, "lucide:compass");
                addSliderRow(c, "风速", s.windSpeed, 0, 10, 0.1, (v) => setEnvState({ windSpeed: v }), "lucide:gauge");
            });
        },
    };
}

export function buildCloudLevel(): PopupLevel {
    return {
        label: "云",
        dir: "",
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(c, "启用云", s.cloudsEnabled, (v) => setEnvState({ cloudsEnabled: v }));
                addSliderRow(c, "云量", s.cloudCover, 0, 1, 0.05, (v) => setEnvState({ cloudCover: v }), "lucide:cloud");
                addSliderRow(c, "高度", s.cloudHeight, 10, 200, 5, (v) => setEnvState({ cloudHeight: v }), "lucide:arrow-up");
                addSliderRow(c, "缩放", s.cloudScale, 0.5, 3, 0.1, (v) => setEnvState({ cloudScale: v }), "lucide:maximize");
            });
        },
    };
}

// ======== Env Stack onFolderEnter ========

function envOnFolderEnter(row: PopupRow): PopupLevel | null {
    switch (row.target) {
        case "env:lighting": return buildEnvLightingLevel();
        case "env:sky": return buildSkyLevel();
        case "env:ground": return buildGroundLevel();
        case "env:water": return buildWaterLevel();
        case "env:particle": return buildParticleLevel();
        case "env:wind": return buildWindLevel();
        case "env:cloud": return buildCloudLevel();
        case "env:prop": return buildPropLevel();
        case "env:presets": return buildPresetLevel();
        default: return null;
    }
}

// ======== Show Env Menu ========

export function showEnvMenu(): void {
    dom.sceneOverlay.innerHTML = "";
    dom.sceneOverlay.classList.remove("sceneOverlay-model", "sceneOverlay-motion", "sceneOverlay-settings");
    dom.sceneOverlay.dataset.popupType = "env";

    // 每次都重建 SlideMenu，避免 innerHTML 清空后旧实例持有已销毁的 DOM 引用
    envMenu = new SlideMenu({
        container: dom.sceneOverlay,
        onClose: () => closeAllOverlays(),
        onItemClick: () => {},
        onFolderEnter: envOnFolderEnter,
        onAfterRender: () => {},
    });

    envMenu.reset(buildEnvLevel());
}
