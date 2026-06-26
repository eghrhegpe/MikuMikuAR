// [doc:architecture] Scene Menu — 场景弹窗（相机/灯光/渲染预设）
// 规范文档: docs/architecture.md §渲染环节
// 职责: MenuStack 场景弹窗、相机/灯光/渲染参数面板、渲染预设
// Scene menu — consolidated camera + lighting controls (MenuStack-based).

import {
    dom, closeAllOverlays, setStatus, formatTime, escapeHtml,
    PopupRow, PopupLevel,
} from "./config";
import { MenuStack } from "./menu";
import { switchCameraMode, getCameraMode, hasCameraVmd, getCameraVmdName, clearCameraVmd } from "./camera";
import { getLightState, setLightState, triggerAutoSave, serializeScene, deserializeScene, getRenderState, setRenderState, loadCameraVmdFromPath } from "./scene";
import type { RenderState } from "./scene";
import { SelectSceneSaveFile, SelectSceneOpenFile, SaveSceneFile, LoadSceneFile, SaveRenderPreset, DeleteRenderPreset, GetRenderPresets, SelectAudioFile, SelectVMDMotion, SelectDir, SaveScreenshot } from "../wailsjs/go/main/App";
import {
    loadAudioFile, pauseAudio, resumeAudio, stopAudio, clearAudio,
    setVolume, getVolume, setAudioOffset, getAudioOffset,
    getCurrentTime, getDuration, isAudioPlaying, getAudioName,
} from "./audio";
import { focusModel, engine, scene, setModelWireframe, setModelVisibility, setModelOpacity, resetModelTransform, getMatCatGroups, getMatCatParams, setMatCatParams, resetMatCatParams, getMatDetailList, getMatParams, setMatParams, resetSingleMatParams, resetAllMatParams, setGravityStrength, getGravityStrength } from "./scene";
import type { MaterialCategoryParams } from "./scene";
import type { Material } from "@babylonjs/core/Materials/material";
import { modelRegistry, focusedModelId, setFocusedModelId } from "./config";
import { playPlaylistNext, playPlaylistPrev } from "./library";

// ======== Scene Menu (MenuStack) ========

let sceneStack: MenuStack | null = null;

function buildSceneRoot(): PopupLevel {
    return {
        label: "场景",
        dir: "",
        items: [
            { kind: "folder", label: "模型", icon: "box", target: "scene:models" },
            { kind: "folder", label: "相机模式", icon: "camera", target: "scene:camera" },
            { kind: "folder", label: "灯光", icon: "sun", target: "scene:light" },
            { kind: "folder", label: "渲染", icon: "sparkles", target: "scene:render" },
            { kind: "folder", label: "物理", icon: "toggle-left", target: "scene:physics" },
            { kind: "folder", label: "音乐", icon: "music", target: "scene:music" },
            { kind: "folder", label: "截图", icon: "camera", target: "scene:screenshot" },
            { kind: "action", label: "保存场景", icon: "save", target: "scene:save" },
            { kind: "action", label: "加载场景", icon: "upload", target: "scene:load" },
        ],
    };
}

function buildModelsLevel(): PopupLevel {
    return {
        label: "模型",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";

            if (modelRegistry.size === 0) {
                const empty = document.createElement("div");
                empty.style.cssText = "font-size:12px;color:var(--text-dim);text-align:center;padding:20px;";
                empty.textContent = "场景中无模型";
                container.appendChild(empty);
                return;
            }

            // Playlist navigation row
            const navRow = document.createElement("div");
            navRow.style.cssText = "display:flex;gap:6px;margin-bottom:10px;";
            const prevBtn = document.createElement("button");
            prevBtn.style.cssText = "flex:1;padding:6px;border:1px solid var(--white-08);border-radius:6px;background:transparent;color:var(--text-bright);cursor:pointer;font-size:11px;";
            prevBtn.innerHTML = '<iconify-icon icon="skip-back"></iconify-icon> 上一个';
            prevBtn.addEventListener("click", async () => { await playPlaylistPrev(); });
            const nextBtn = document.createElement("button");
            nextBtn.style.cssText = "flex:1;padding:6px;border:1px solid var(--white-08);border-radius:6px;background:transparent;color:var(--text-bright);cursor:pointer;font-size:11px;";
            nextBtn.innerHTML = '下一个 <iconify-icon icon="skip-forward"></iconify-icon>';
            nextBtn.addEventListener("click", async () => { await playPlaylistNext(); });
            navRow.appendChild(prevBtn);
            navRow.appendChild(nextBtn);
            container.appendChild(navRow);

            for (const [id, inst] of modelRegistry) {
                const card = document.createElement("div");
                card.style.cssText = "border:1px solid var(--white-08);border-radius:6px;padding:8px;margin-bottom:8px;";

                const nameEl = document.createElement("div");
                nameEl.style.cssText = "font-size:12px;color:var(--text-bright);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                nameEl.textContent = inst.name;
                card.appendChild(nameEl);

                addToggleRow(card, "可见", inst.visible ?? true, (v) => {
                    setModelVisibility(id, v);
                });

                addToggleRow(card, "线框", inst.wireframe ?? false, (v) => {
                    setModelWireframe(id, v);
                });

                addSliderRow(card, "透明度", inst.opacity ?? 1.0, 0, 1, 0.05, (v) => {
                    setModelOpacity(id, v);
                });

                const matBtn = document.createElement("div");
                matBtn.className = "menu-item";
                matBtn.style.marginTop = "4px";
                matBtn.innerHTML = '<span class="menu-icon"><iconify-icon icon="palette"></iconify-icon></span><span class="menu-label">材质</span><span class="menu-sublabel" style="font-size:10px;color:var(--text-dim);">漫反射 / 高光</span>';
                matBtn.addEventListener("click", () => {
                    sceneStack?.push(buildMaterialCategoryLevel(id, inst.name));
                });
                card.appendChild(matBtn);

                container.appendChild(card);
            }

            const divider = document.createElement("div");
            divider.className = "menu-divider";
            container.appendChild(divider);

            const resetRow = document.createElement("div");
            resetRow.className = "menu-item";
            resetRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="rotate-ccw"></iconify-icon></span><span class="menu-label">重置全部变换</span>';
            resetRow.addEventListener("click", () => {
                for (const [id] of modelRegistry) {
                    resetModelTransform(id);
                }
                sceneStack?.reRender();
                setStatus("✓ 所有模型变换已重置", true);
            });
            container.appendChild(resetRow);
        },
    };
}

function buildMaterialCategoryLevel(id: string, modelName: string): PopupLevel {
    const label = "材质 — " + modelName;
    return {
        label,
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            const groups = getMatCatGroups(id);
            const detailList = getMatDetailList(id);
            const detailMap = new Map(detailList.map(d => [d.name, d]));

            const CATEGORY_ICONS: Record<string, string> = {
                "皮肤": "droplet", "头发": "feather", "眼睛": "eye", "服装": "shirt",
            };

            for (const [cat, mats] of groups) {
                const params = getMatCatParams(id, cat);
                const catModified = mats.some(m => detailMap.get(m.name)?.modified);
                const card = document.createElement("div");
                card.style.cssText = "border:1px solid var(--white-08);border-radius:6px;padding:8px;margin-bottom:10px;";

                const header = document.createElement("div");
                header.style.cssText = "font-size:12px;color:var(--text-bright);margin-bottom:6px;display:flex;align-items:center;gap:4px;";
                header.innerHTML = `<iconify-icon icon="${CATEGORY_ICONS[cat] || "box"}"></iconify-icon> ${cat} <span style="font-size:10px;color:var(--text-dim);">(${mats.length} 个材质)</span>`;
                if (catModified) {
                    header.innerHTML += ' <span style="font-size:10px;color:var(--accent);margin-left:auto;">已修改</span>';
                }
                card.appendChild(header);

                // Per-material list
                for (const mat of mats) {
                    const detail = detailMap.get(mat.name);
                    const isModified = detail?.modified ?? false;
                    const matRow = document.createElement("div");
                    matRow.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 6px;margin:2px 0;border-radius:4px;cursor:pointer;font-size:11px;${isModified ? "color:var(--accent);background:var(--white-04);" : "color:var(--text-dim);"}`;
                    matRow.innerHTML = `<iconify-icon icon="${isModified ? "check-circle" : "circle"}"></iconify-icon><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(mat.name)}</span>`;
                    matRow.addEventListener("mouseenter", () => { matRow.style.background = "var(--white-08)"; });
                    matRow.addEventListener("mouseleave", () => { matRow.style.background = isModified ? "var(--white-04)" : ""; });
                    matRow.addEventListener("click", () => {
                        sceneStack?.push(buildPerMatLevel(id, modelName, mat.name, mat.mat, detail?.index ?? 0));
                    });
                    card.appendChild(matRow);
                }

                // Category-level sliders
                const sliderGroup = document.createElement("div");
                sliderGroup.style.cssText = "margin-top:4px;padding-top:4px;border-top:1px solid var(--white-04);";
                addSliderRow(sliderGroup, "漫反射倍率", params.diffuseMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { diffuseMul: v }));
                addSliderRow(sliderGroup, "高光倍率", params.specularMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { specularMul: v }));
                addSliderRow(sliderGroup, "高光指数", params.shininess, 0, 200, 1, (v) => setMatCatParams(id, cat, { shininess: v }));
                addSliderRow(sliderGroup, "环境光倍率", params.ambientMul, 0, 2, 0.05, (v) => setMatCatParams(id, cat, { ambientMul: v }));
                card.appendChild(sliderGroup);

                container.appendChild(card);
            }

            const divider = document.createElement("div");
            divider.className = "menu-divider";
            container.appendChild(divider);

            // Reset per-material overrides
            const hasOverrides = detailList.some(d => d.modified);
            if (hasOverrides) {
                const resetAllRow = document.createElement("div");
                resetAllRow.className = "menu-item";
                resetAllRow.style.color = "var(--warn)";
                resetAllRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="rotate-ccw"></iconify-icon></span><span class="menu-label">重置所有单独调整</span>';
                resetAllRow.addEventListener("click", () => {
                    resetAllMatParams(id);
                    sceneStack?.reRender();
                    setStatus("✓ 所有单独材质调整已重置", true);
                });
                container.appendChild(resetAllRow);
            }

            const resetRow = document.createElement("div");
            resetRow.className = "menu-item";
            resetRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="rotate-ccw"></iconify-icon></span><span class="menu-label">重置全部材质参数</span>';
            resetRow.addEventListener("click", () => {
                resetMatCatParams(id);
                resetAllMatParams(id);
                sceneStack?.reRender();
                setStatus("✓ 全部材质参数已重置", true);
            });
            container.appendChild(resetRow);
        },
    };
}

function buildPerMatLevel(id: string, modelName: string, matName: string, mat: Material, matIndex: number): PopupLevel {
    const shortName = matName.length > 24 ? matName.slice(0, 24) + "…" : matName;
    return {
        label: shortName,
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";

            const nameEl = document.createElement("div");
            nameEl.style.cssText = "font-size:11px;color:var(--text-dim);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
            nameEl.textContent = modelName + " > " + matName;
            container.appendChild(nameEl);

            const current = getMatParams(id, matIndex);
            const params = current ?? { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 };
            const isModified = current !== null;

            addSliderRow(container, "漫反射倍率", params.diffuseMul, 0, 2, 0.05, (v) => {
                setMatParams(id, matIndex, { diffuseMul: v });
            });
            addSliderRow(container, "高光倍率", params.specularMul, 0, 2, 0.05, (v) => {
                setMatParams(id, matIndex, { specularMul: v });
            });
            addSliderRow(container, "高光指数", params.shininess, 0, 200, 1, (v) => {
                setMatParams(id, matIndex, { shininess: v });
            });
            addSliderRow(container, "环境光倍率", params.ambientMul, 0, 2, 0.05, (v) => {
                setMatParams(id, matIndex, { ambientMul: v });
            });

            const divider = document.createElement("div");
            divider.className = "menu-divider";
            container.appendChild(divider);

            if (isModified) {
                const resetRow = document.createElement("div");
                resetRow.className = "menu-item";
                resetRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="rotate-ccw"></iconify-icon></span><span class="menu-label">重置此材质</span>';
                resetRow.addEventListener("click", () => {
                    resetSingleMatParams(id, matIndex);
                    sceneStack?.reRender();
                    setStatus(`✓ 已重置: ${matName}`, true);
                });
                container.appendChild(resetRow);
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
    const items: PopupRow[] = [
        { kind: "action", label: "轨道", icon: currentMode === "orbit" ? "check" : "circle", target: "camera:orbit", sublabel: "默认轨道相机" },
        { kind: "action", label: "自由飞行", icon: currentMode === "freefly" ? "check" : "circle", target: "camera:freefly", sublabel: "WASD 自由移动" },
        { kind: "action", label: "镜头预设", icon: currentMode === "oneshot" ? "check" : "circle", target: "camera:oneshot", sublabel: "预设关键帧" },
        { kind: "action", label: "演唱会", icon: currentMode === "concert" ? "check" : "circle", target: "camera:concert", sublabel: "自动切换视角" },
    ];
    if (vmdLoaded) {
        items.push(
            { kind: "divider" } as any,
            { kind: "action", label: "VMD 相机", icon: currentMode === "vmd" ? "check" : "circle", target: "camera:vmd", sublabel: vmdName || "相机轨道" },
            { kind: "action", label: "清除相机 VMD", icon: "trash-2", target: "camera:clear-vmd" },
        );
    }
    items.push(
        { kind: "divider" } as any,
        { kind: "action", label: "加载相机 VMD", icon: "upload", target: "camera:load-vmd", sublabel: "从 .vmd 文件加载相机轨道" },
    );
    return {
        label: "相机模式",
        dir: "",
        items,
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

// ======== Music Menu Level ========

function buildMusicLevel(): PopupLevel {
    const name = getAudioName();
    const playing = isAudioPlaying();
    const vol = getVolume();
    const offset = getAudioOffset();
    const cur = getCurrentTime();
    const dur = getDuration();

    return {
        label: "音乐",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";

            // Current music name
            const nameRow = document.createElement("div");
            nameRow.style.cssText = "font-size:12px;color:var(--text-dim);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
            nameRow.textContent = name ? `当前: ${name}` : "未加载音乐";
            container.appendChild(nameRow);

            // Progress display
            if (dur > 0) {
                const progRow = document.createElement("div");
                progRow.style.cssText = "font-size:11px;color:var(--text-bright);margin-bottom:12px;text-align:right;";
                progRow.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
                container.appendChild(progRow);
            } else {
                const spacer = document.createElement("div");
                spacer.style.cssText = "height:12px;";
                container.appendChild(spacer);
            }

            // Load music button
            const loadRow = document.createElement("div");
            loadRow.className = "menu-item";
            loadRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="folder-open"></iconify-icon></span><span class="menu-label">加载音乐</span>';
            loadRow.addEventListener("click", async () => {
                try {
                    const path = await SelectAudioFile();
                    if (!path) return;
                    await loadAudioFile(path);
                    setStatus(`✓ 音乐: ${getAudioName()}`, true);
                    sceneStack?.reRender();
                } catch (err) {
                    console.warn("Load audio failed:", err);
                    setStatus("✗ 音乐加载失败", false);
                }
            });
            container.appendChild(loadRow);

            // Play/Pause toggle
            const playRow = document.createElement("div");
            playRow.className = "menu-item";
            playRow.innerHTML = `<span class="menu-icon">${playing ? "⏸" : "▶"}</span><span class="menu-label">${playing ? "暂停" : "播放"}</span>`;
            playRow.addEventListener("click", () => {
                if (playing) {
                    pauseAudio();
                } else {
                    resumeAudio();
                }
                sceneStack?.reRender();
            });
            container.appendChild(playRow);

            // Volume slider
            addSliderRow(container, "音量", vol, 0, 1, 0.05, (v) => {
                setVolume(v);
            });

            // Audio offset slider
            addSliderRow(container, "音频偏移", offset, -5, 5, 0.1, (v) => {
                setAudioOffset(v);
            });

            const offsetHint = document.createElement("div");
            offsetHint.style.cssText = "font-size:10px;color:var(--text-dark);margin:-4px 0 10px 88px;";
            offsetHint.textContent = "正=音频先播，负=音频后播";
            container.appendChild(offsetHint);

            // Divider
            const divider = document.createElement("div");
            divider.className = "menu-divider";
            container.appendChild(divider);

            // Stop button
            const stopRow = document.createElement("div");
            stopRow.className = "menu-item";
            stopRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="square"></iconify-icon></span><span class="menu-label">停止</span>';
            stopRow.addEventListener("click", () => {
                stopAudio();
                sceneStack?.reRender();
            });
            container.appendChild(stopRow);

            // Clear button
            const clearRow = document.createElement("div");
            clearRow.className = "menu-item";
            clearRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="trash-2"></iconify-icon></span><span class="menu-label">清除音乐</span>';
            clearRow.addEventListener("click", () => {
                clearAudio();
                setStatus("✓ 音乐已清除", true);
                sceneStack?.reRender();
            });
            container.appendChild(clearRow);
        },
    };
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
            });
            const helper = document.createElement("div");
            helper.style.cssText = "font-size:11px;color:var(--text-dim);text-align:center;margin-top:6px;";
            helper.textContent = "0 = 无重力 · 1 = 默认 · 2 = 二倍重力";
            container.appendChild(helper);
        },
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
    // Camera VMD actions
    if (row.target === "camera:load-vmd") {
        (async () => {
            try {
                const path = await SelectVMDMotion();
                if (!path) return;
                await loadCameraVmdFromPath(path);
                if (sceneStack) {
                    sceneStack.setLevel(sceneStack.levelCount - 1, buildCameraLevel());
                    sceneStack.reRender();
                }
            } catch (err) {
                console.error("Load camera VMD failed:", err);
                setStatus("✗ 相机 VMD 加载失败", false);
            }
        })();
        return;
    }
    if (row.target === "camera:clear-vmd") {
        clearCameraVmd();
        if (sceneStack) {
            sceneStack.setLevel(sceneStack.levelCount - 1, buildCameraLevel());
            sceneStack.reRender();
        }
        setStatus("✓ 已清除相机 VMD", true);
        return;
    }
    // Camera mode switching
    if (row.target && row.target.startsWith("camera:")) {
        const mode = row.target.replace("camera:", "") as "orbit" | "freefly" | "oneshot" | "concert" | "vmd";
        if (mode === "vmd" && !hasCameraVmd()) {
            setStatus("✗ 请先加载相机 VMD", false);
            return;
        }
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
            vmd: "VMD 相机",
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
                    case "scene:models": return buildModelsLevel();
                    case "scene:camera": return buildCameraLevel();
                    case "scene:light": return buildLightLevel();
                    case "scene:render": return buildRenderLevel();
                    case "scene:physics": return buildPhysicsLevel();
                    case "scene:music": return buildMusicLevel();
                    case "scene:screenshot": return buildScreenshotLevel();
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
