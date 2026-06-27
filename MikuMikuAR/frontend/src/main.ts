// MikuMikuAR — entry point
// Initializes scene, wires up event handlers, starts render loop.

import "./app.css";

import { dom, setStatus, isPlaying, setIsPlaying, autoLoop, setAutoLoop, seekDragging, setSeekDragging, mmdRuntime, closeAllOverlays, showHint, hideHint, initHints } from "./config";
import { GetConfig } from "../wailsjs/go/main/App";
import { initScene, engine, scene, focusedMmdModel, focusedModel, updatePlaybackUI, seekFromEvent, tryRestoreLastScene, setEnvState } from "./scene";
import { freeflyInput, getCameraMode } from "./camera";
import { initLibrary, togglePopup, showMotionPopup } from "./library";
import { ImportZip } from "../wailsjs/go/main/App";
import { OnFileDrop, EventsOn } from "../wailsjs/runtime/runtime";
import { loadPMXFile, loadVMDFromPath } from "./scene";
import { refreshLibrary } from "./library";
import { showSettings } from "./settings";
import { showSceneMenu, showEnvMenu } from "./scene-menu";
import "iconify-icon";

// ======== Initialize hover hints for static [data-hint] elements ========
initHints();

// ======== Event Handlers ========

// Play/Pause
dom.btnPlayPause.addEventListener("click", async () => {
    if (!mmdRuntime) return;
    if (isPlaying) {
        mmdRuntime.pauseAnimation();
        setIsPlaying(false);
        setAutoLoop(false);
    } else {
        setAutoLoop(true);
        await mmdRuntime.playAnimation();
        setIsPlaying(true);
    }
    updatePlaybackUI();
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
function toggleOverlay(id: string, showFn: () => void): void {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains("visible")) {
        el.classList.remove("visible");
    } else {
        closeAllOverlays();
        showFn();
    }
    syncNavAriaExpanded();
}
const navActions: Record<number, () => void> = {
    1: togglePopup,
    2: () => toggleOverlay("motionPopup", showMotionPopup),
    3: () => toggleOverlay("sceneOverlay", showSceneMenu),
    4: () => toggleOverlay("sceneOverlay", showEnvMenu),
    5: () => toggleOverlay("settingsOverlay", showSettings),
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
window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    // Ctrl+1/2/3/4/5: toggle nav overlays
    if (e.ctrlKey && !e.repeat && /^Digit\d$/.test(e.code)) {
        e.preventDefault();
        const num = parseInt(e.code.slice(-1), 10);
        if (navActions[num]) {
            navActions[num]();
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
        console.log("MikuMikuAR initialized");
        initLibrary().catch(err => console.warn("Library init:", err));
        // Restore env state from config (last scene restore may override)
        restoreEnvState().catch(err => console.warn("Env restore:", err));
        // Auto-restore last scene after library + scene init
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
                const { ImportLocalFile } = await import("../wailsjs/go/main/App");
                await ImportLocalFile(payload.path);
                setStatus("✓ 已导入: " + (payload.name || payload.path), true);
                const { refreshLibrary } = await import("./library");
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
    const { scene, engine } = await import("./scene");
    const { CreateScreenshotAsync } = await import("@babylonjs/core/Misc/screenshotTools");
    // Force a render frame so Babylon writes to the backbuffer
    scene.render();
    return CreateScreenshotAsync(engine, scene.activeCamera!, 512);
};
