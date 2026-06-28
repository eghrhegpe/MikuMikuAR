// MikuMikuAR — entry point
// Initializes scene, wires up event handlers, starts render loop.

import "../app.css";

import { dom, setStatus, isPlaying, setIsPlaying, autoLoop, setAutoLoop, seekDragging, setSeekDragging, mmdRuntime, closeAllOverlays, showHint, hideHint, initHints } from "./config";
import { GetConfig } from "../../wailsjs/go/main/App";
import { initScene, engine, scene, focusedMmdModel, focusedModel, updatePlaybackUI, seekFromEvent, tryRestoreLastScene, setEnvState } from "../scene/scene";
import { freeflyInput, getCameraMode } from "../scene/camera";
import { initLibrary, showModelPopup, showMotionPopup } from "../library";
import { ImportZip } from "../../wailsjs/go/main/App";
import { OnFileDrop, EventsOn } from "../../wailsjs/runtime/runtime";
import { loadPMXFile, loadVMDFromPath } from "../scene/scene";
import { refreshLibrary } from "../library";
import "iconify-icon";

// ======== Initialize hover hints for static [data-hint] elements ========
initHints();

// ======== Event Handlers ========

// Play/Pause — only toggles play state, does NOT touch autoLoop
dom.btnPlayPause.addEventListener("click", async () => {
    if (!mmdRuntime) return;
    if (isPlaying) {
        mmdRuntime.pauseAnimation();
        setIsPlaying(false);
    } else {
        await mmdRuntime.playAnimation();
        setIsPlaying(true);
    }
    updatePlaybackUI();
});

// Loop toggle
dom.btnLoopToggle.addEventListener("click", () => {
    setAutoLoop(!autoLoop);
    updatePlaybackUI();
    setStatus(`循环: ${autoLoop ? "开" : "关"}`, true);
});

// ======== Ctrl shortcuts hint ========
window.addEventListener("keydown", (e) => {
    if (e.key === "Control" && !e.repeat) document.body.classList.add("shortcuts-visible");
});
window.addEventListener("keyup", (e) => {
    if (e.key === "Control") document.body.classList.remove("shortcuts-visible");
});
window.addEventListener("blur", () => document.body.classList.remove("shortcuts-visible"));

// ======== Declarative nav shortcut routing: Ctrl+N → toggle nav button ========
function syncNavAriaExpanded(): void {
    document.querySelectorAll<HTMLElement>("[aria-controls]").forEach(btn => {
        const targetId = btn.getAttribute("aria-controls");
        const target = targetId ? document.getElementById(targetId) : null;
        btn.setAttribute("aria-expanded", target?.classList.contains("visible") ? "true" : "false");
    });
}
// Track which show function last opened each overlay, so toggling the same button
// closes the overlay while clicking a different button (sharing the same overlay)
// switches content with a cross-fade animation instead of wrongly closing it.
const _lastOverlayFn = new Map<string, () => void>();

/** Wait for the CSS transition on `el` to complete (with a safety timeout). */
function waitForTransition(el: HTMLElement): Promise<void> {
    return new Promise(resolve => {
        const dur = parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;
        if (dur <= 0) { resolve(); return; }
        const done = () => { el.removeEventListener("transitionend", done); resolve(); };
        el.addEventListener("transitionend", done);
        setTimeout(resolve, dur + 50);
    });
}

async function toggleOverlay(id: string, showFn: () => void): Promise<void> {
    const el = document.getElementById(id);
    if (!el) return;
    const last = _lastOverlayFn.get(id);
    if (el.classList.contains("visible")) {
        if (last === showFn) {
            // Same button clicked again → toggle close
            el.classList.remove("visible");
        } else {
            // Different button targeting the same overlay → cross-fade switch
            // Phase 1: fade out current content
            el.classList.add("overlay-fade-out");
            await waitForTransition(el);
            // Phase 2: swap content (closeAllOverlays + showFn), then fade in
            el.classList.remove("overlay-fade-out", "visible");
            closeAllOverlays();
            showFn();
            el.classList.add("visible");
            // Phase 3: fade-in plays automatically via CSS transition on .visible
        }
    } else {
        closeAllOverlays();
        showFn();
    }
    _lastOverlayFn.set(id, showFn);
    syncNavAriaExpanded();
}
const navActions: Record<number, () => void | Promise<void>> = {
    1: () => toggleOverlay("modelPopup", showModelPopup),
    2: () => toggleOverlay("motionPopup", showMotionPopup),
    3: async () => { const m = await import("../scene-menu"); toggleOverlay("sceneOverlay", m.showSceneMenu); },
    4: async () => { const m = await import("../scene-menu"); toggleOverlay("sceneOverlay", m.showEnvMenu); },
    5: async () => { const m = await import("../settings"); toggleOverlay("settingsOverlay", m.showSettings); },
};
const navLabels: Record<number, string> = {};
function buildNavMaps(): void {
    document.querySelectorAll<HTMLElement>("[data-shortcut]").forEach(el => {
        const key = el.dataset.shortcut || "";
        const k = parseInt(key, 10);
        if (k >= 1 && k <= 9) navLabels[k] = el.title || "";
        // Sync badge text from data-shortcut
        const badge = el.querySelector<HTMLElement>(".shortcut-badge");
        if (badge) badge.textContent = key;
        // Sync data-hint shortcut suffix from data-shortcut
        const hint = el.getAttribute("data-hint");
        if (hint) {
            const clean = hint.replace(/\s*·\s*Ctrl\+\d+$/, "");
            el.setAttribute("data-hint", `${clean} · Ctrl+${key}`);
        }
    });
}

// Keyboard shortcuts
window.addEventListener("keydown", async (e) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    // Ctrl+1/2/3/4/5: toggle nav overlays
    if (e.ctrlKey && !e.repeat && /^Digit\d$/.test(e.code)) {
        e.preventDefault();
        const num = parseInt(e.code.slice(-1), 10);
        if (navActions[num]) {
            await navActions[num]();
            setStatus(navLabels[num] || "", false);
        }
        return;
    }

    // Freefly WASD (only respond in freefly mode)
    if (getCameraMode() === "freefly") {
        if (e.code === "KeyW") { freeflyInput.forward = true; e.preventDefault(); }
        else if (e.code === "KeyS") { freeflyInput.backward = true; e.preventDefault(); }
        else if (e.code === "KeyA") { freeflyInput.left = true; e.preventDefault(); }
        else if (e.code === "KeyD") { freeflyInput.right = true; e.preventDefault(); }
        else if (e.code === "KeyQ") { freeflyInput.up = true; e.preventDefault(); }
        else if (e.code === "KeyE") { freeflyInput.down = true; e.preventDefault(); }
    }

    if (e.code === "Space" && !e.repeat && mmdRuntime && focusedMmdModel()) {
        e.preventDefault();
        dom.btnPlayPause.click();
    } else if (e.code === "Escape") {
        closeAllOverlays();
    } else if (e.code === "ArrowLeft" && mmdRuntime) {
        const foc = focusedModel();
        const dur = foc?.animationDuration ?? mmdRuntime.animationDuration;
        if (dur <= 0) return;
        e.preventDefault();
        mmdRuntime.seekAnimation(Math.max(0, mmdRuntime.currentTime - 5), true);
        updatePlaybackUI();
    } else if (e.code === "ArrowRight" && mmdRuntime) {
        const foc = focusedModel();
        const dur = foc?.animationDuration ?? mmdRuntime.animationDuration;
        if (dur <= 0) return;
        e.preventDefault();
        mmdRuntime.seekAnimation(Math.min(dur, mmdRuntime.currentTime + 5), true);
        updatePlaybackUI();
    }
});

// Freefly WASD release
window.addEventListener("keyup", (e) => {
    if (getCameraMode() !== "freefly") return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.code === "KeyW") { freeflyInput.forward = false; e.preventDefault(); }
    else if (e.code === "KeyS") { freeflyInput.backward = false; e.preventDefault(); }
    else if (e.code === "KeyA") { freeflyInput.left = false; e.preventDefault(); }
    else if (e.code === "KeyD") { freeflyInput.right = false; e.preventDefault(); }
    else if (e.code === "KeyQ") { freeflyInput.up = false; e.preventDefault(); }
    else if (e.code === "KeyE") { freeflyInput.down = false; e.preventDefault(); }
});

// Seek bar
let seekWasPlaying = false;
dom.seekBar.addEventListener("pointerdown", (e) => {
    setSeekDragging(true);
    seekWasPlaying = isPlaying;
    if (isPlaying && mmdRuntime) { mmdRuntime.pauseAnimation(); setIsPlaying(false); }
    seekFromEvent(e);
    dom.seekBar.setPointerCapture(e.pointerId);
});
window.addEventListener("pointermove", (e) => {
    if (seekDragging) seekFromEvent(e);
});
window.addEventListener("pointerup", async () => {
    if (!seekDragging) return;
    setSeekDragging(false);
    if (seekWasPlaying && mmdRuntime && focusedMmdModel()) {
        await mmdRuntime.playAnimation();
        setIsPlaying(true);
        updatePlaybackUI();
    }
});

// ======== Click canvas to toggle overlays ========
// Only clicks on the 3D canvas trigger toggle — all other UI is ignored.
let _overlaysHiddenByClick = false;
let _lastHidden: string[] = [];
let _pointerDownPos = { x: 0, y: 0 };

function _getAllOverlays(): HTMLElement[] {
    const overlays: HTMLElement[] = [];
    document.querySelectorAll<HTMLElement>("[aria-controls]").forEach(btn => {
        const id = btn.getAttribute("aria-controls");
        if (id) {
            const el = document.getElementById(id);
            if (el) overlays.push(el);
        }
    });
    return overlays;
}

function _toggleOverlays(): void {
    const all = _getAllOverlays();
    if (!_overlaysHiddenByClick) {
        _lastHidden = all.filter(el => el.classList.contains("visible")).map(el => el.id);
        all.forEach(el => el.classList.remove("visible"));
        _overlaysHiddenByClick = true;
    } else {
        const toShow = _lastHidden.filter(id =>
            all.some(el => el.id === id && !el.classList.contains("visible"))
        );
        all.forEach(el => {
            if (toShow.includes(el.id)) el.classList.add("visible");
        });
        _lastHidden = [];
        _overlaysHiddenByClick = false;
    }
}

window.addEventListener("pointerdown", (e) => {
    _pointerDownPos = { x: e.clientX, y: e.clientY };
});

window.addEventListener("pointerup", (e) => {
    const dx = e.clientX - _pointerDownPos.x;
    const dy = e.clientY - _pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;

    // Only toggle when clicking on the 3D canvas
    if (!dom.canvas.contains(e.target as Node)) return;

    _toggleOverlays();
});

// Nav buttons reset toggle state (dynamic via data-shortcut)
document.querySelectorAll<HTMLElement>("[data-shortcut]").forEach(btn => {
    btn.addEventListener("click", () => { _overlaysHiddenByClick = false; _lastHidden = []; });
});

// ======== Init ========
async function init(): Promise<void> {
    try {
        buildNavMaps();
        setStatus("正在初始化...", false);
        await initScene();
        initDropHandler();
        // Register nav button event listeners (ensured DOM ready)
        dom.btnMainAction?.addEventListener("click", () => toggleOverlay("modelPopup", showModelPopup));
        dom.btnMotionPopup?.addEventListener("click", showMotionPopup);
        dom.btnScene?.addEventListener("click", async () => { const m = await import("../scene-menu"); toggleOverlay("sceneOverlay", m.showSceneMenu); });
        dom.btnEnv?.addEventListener("click", async () => { const m = await import("../scene-menu"); toggleOverlay("sceneOverlay", m.showEnvMenu); });
        dom.btnSettings?.addEventListener("click", async () => { const m = await import("../settings"); toggleOverlay("settingsOverlay", m.showSettings); });
        console.log("MikuMikuAR initialized");
        initLibrary().catch(err => console.warn("Library init:", err));
        // Restore env state from config (authoritative — scene restore skips env)
        await restoreEnvState();
        // Apply persisted UI state
        await restoreUIState();
        // Auto-restore last scene after library + scene init (env already restored above)
        tryRestoreLastScene().catch(err => console.warn("Auto-restore:", err));
    } catch (err) {
        console.error("Init failed:", err);
        setStatus("✗ 初始化失败", false);
    }
}

async function restoreEnvState(): Promise<void> {
    const cfg = await GetConfig();
    if (cfg.env) {
        setEnvState(cfg.env as any);
    }
}

const FONT_RESTORE: Record<string, string> = {
    system: "'Segoe UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK SC', system-ui, sans-serif",
    noto: "'Source Han Sans SC', 'Noto Sans CJK SC', system-ui, sans-serif",
    yahei: "'Microsoft YaHei', 'Microsoft YaHei UI', system-ui, sans-serif",
};

async function restoreUIState(): Promise<void> {
    const cfg = await GetConfig();
    if (!cfg.ui_state) return;
    const s = cfg.ui_state as any;
    const root = document.documentElement;
    if (s.scale) root.style.setProperty("--ui-scale", String(s.scale));
    if (s.popupWidth) root.style.setProperty("--popup-width", s.popupWidth + "px");
    if (s.accent) {
        root.style.setProperty("--accent", s.accent);
        root.style.setProperty("--accent-dim", s.accent + "33");
    }
    if (s.fontFamily && FONT_RESTORE[s.fontFamily]) {
        root.style.setProperty("--font", FONT_RESTORE[s.fontFamily]);
    }
    root.style.setProperty("--ui-animations", s.animations === false ? "0" : "1");
    root.style.setProperty("--ui-blur", s.blurBg ? "1" : "0");
    document.querySelectorAll<HTMLElement>(".overlay").forEach(el => el.classList.toggle("blur-bg", !!s.blurBg));
}

// ======== Drag & Drop Import ========

function initDropHandler(): void {
    // Wails native file drop — receives OS-level file paths
    OnFileDrop(async (_x: number, _y: number, paths: string[]) => {
        hideDropOverlay();
        for (const path of paths) {
            await handleDropFile(path);
        }
    }, false // false = full-window drop target, no specific element needed
    );

    // Visual feedback: show overlay when files are dragged over the window
    let dragCounter = 0;
    window.addEventListener("dragenter", (e) => {
        e.preventDefault();
        dragCounter++;
        if (dragCounter === 1) {
            document.getElementById("dropOverlay")!.classList.add("visible");
        }
    });
    window.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            hideDropOverlay();
        }
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", hideDropOverlay);
}

function hideDropOverlay(): void {
    document.getElementById("dropOverlay")!.classList.remove("visible");
}

async function handleDropFile(path: string): Promise<void> {
    const lower = path.toLowerCase();
    if (lower.endsWith(".zip")) {
        setStatus("⏳ 导入压缩包...", false);
        try {
            await ImportZip(path);
            setStatus("✓ 压缩包已导入", true);
            await refreshLibrary().catch(err => console.warn("refresh after drop:", err));
        } catch (err) {
            setStatus("✗ 导入失败: " + err, false);
            console.error("ImportZip failed:", err);
        }
    } else if (lower.endsWith(".pmx")) {
        setStatus("⏳ 加载模型...", false);
        try {
            await loadPMXFile(path);
        } catch (err) {
            setStatus("✗ 模型加载失败", false);
            console.error("loadPMXFile failed:", err);
        }
    } else if (lower.endsWith(".vmd")) {
        setStatus("⏳ 加载动作...", false);
        try {
            await loadVMDFromPath(path);
        } catch (err) {
            setStatus("✗ VMD 加载失败", false);
            console.error("loadVMDFromPath failed:", err);
        }
    }
}

engine.runRenderLoop(() => { scene.render(); });
window.addEventListener("resize", () => { engine.resize(); });

// ======== Download Watch Notification ========
let importToastTimer: ReturnType<typeof setTimeout> | null = null;

EventsOn("watch:newfile", (payload: {path: string, name: string, type: string}) => {
    if (importToastTimer) {
        clearTimeout(importToastTimer);
    }
    const toast = document.getElementById("importToast");
    if (!toast) return;
    const nameEl = toast.querySelector(".toast-file");
    if (nameEl) nameEl.textContent = payload.name || payload.path;
    toast.classList.add("visible");

    // Wire up import button
    const importBtn = toast.querySelector(".toast-import-btn") as HTMLButtonElement | null;
    if (importBtn) {
        importBtn.onclick = async () => {
            importBtn.disabled = true;
            importBtn.textContent = "导入中...";
            try {
                const { ImportLocalFile } = await import("../../wailsjs/go/main/App");
                await ImportLocalFile(payload.path);
                setStatus("✓ 已导入: " + (payload.name || payload.path), true);
                const { refreshLibrary } = await import("../library");
                refreshLibrary().catch(console.warn);
            } catch (err: any) {
                setStatus("✗ 导入失败: " + (err.message || err), false);
            }
            toast.classList.remove("visible");
            importBtn.disabled = false;
            importBtn.textContent = "导入";
        };
    }

    // Wire up ignore button
    const ignoreBtn = toast.querySelector(".toast-ignore-btn") as HTMLButtonElement | null;
    if (ignoreBtn) {
        ignoreBtn.onclick = () => {
            toast.classList.remove("visible");
        };
    }

    // Auto-hide after 10 seconds
    importToastTimer = setTimeout(() => {
        toast.classList.remove("visible");
    }, 10000);
});

init().catch(console.error);

// ======== E2E Capture Helper (exposed for Playwright tests) ========
(window as any).__capture = async (): Promise<string> => {
    const { scene, engine } = await import("../scene/scene");
    const { CreateScreenshotAsync } = await import("@babylonjs/core/Misc/screenshotTools");
    // Force a render frame so Babylon writes to the backbuffer
    scene.render();
    return CreateScreenshotAsync(engine, scene.activeCamera!, 512);
};
