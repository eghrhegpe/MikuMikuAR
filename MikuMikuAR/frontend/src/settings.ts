// Settings page + external library management (MenuStack-based).

import { SetDisplayNamePriority,
         SelectDir, AddExternalPath, RemoveExternalPath,
         ClearExtractCache } from "../wailsjs/go/main/App";
import {
    dom, closeAllOverlays, setStatus,
    libraryRoot, externalPaths,
    displayNamePriority, setDisplayNamePriority, DisplayNamePriority,
    PopupRow, PopupLevel, escapeHtml,
} from "./config";
import { MenuStack } from "./menu";
import { showPopup, rescanAndSync, reloadConfig } from "./library";

// ======== Helpers re-exported ========
export { refreshLibrary } from "./library";

// ======== External Library Management ========

export function renderExternalList(): void {
    dom.externalList.innerHTML = "";
    if (externalPaths.length === 0) {
        dom.externalList.innerHTML = '<div class="overlay-empty">暂无外部库，点击下方添加</div>';
        return;
    }
    for (const ep of externalPaths) {
        const row = document.createElement("div");
        row.className = "overlay-row";
        row.innerHTML = `
            <span class="eo-name">${escapeHtml(ep.name)}</span>
            <span class="eo-path">${escapeHtml(ep.path)}</span>
            <button class="overlay-del" data-path="${escapeHtml(ep.path)}">✕</button>
        `;
        const delBtn = row.querySelector(".overlay-del") as HTMLButtonElement;
        delBtn.addEventListener("click", async () => {
            try {
                await RemoveExternalPath(ep.path);
                await reloadConfig();
                if (libraryRoot) await rescanAndSync();
                renderExternalList();
                showPopup();
            } catch (err) {
                console.error("RemoveExternalPath error:", err);
            }
        });
        dom.externalList.appendChild(row);
    }
}

async function addExternalPath(): Promise<void> {
    try {
        const dir = await SelectDir();
        if (!dir) return;
        await AddExternalPath(dir);
        await reloadConfig();
        if (libraryRoot) await rescanAndSync();
        renderExternalList();
    } catch (err) {
        console.error("AddExternalPath error:", err);
    }
}

// ======== Settings (MenuStack) ========

let settingsStack: MenuStack | null = null;

function buildSettingsRoot(): PopupLevel {
    return {
        label: "设置",
        dir: "",
        items: [
            { kind: "folder", label: "显示", icon: "palette", target: "settings:display" },
            { kind: "folder", label: "系统", icon: "settings", target: "settings:system" },
            { kind: "action", label: "外部库", icon: "plug", target: "set:external" },
        ],
    };
}

function buildSettingsDisplayLevel(): PopupLevel {
    const items: PopupRow[] = [
        { kind: "action", label: "日文名（name_jp）", icon: displayNamePriority === "name_jp" ? "check" : "circle", target: "set:name_jp" },
        { kind: "action", label: "英文名（name_en）", icon: displayNamePriority === "name_en" ? "check" : "circle", target: "set:name_en" },
        { kind: "action", label: "文件名（filename）", icon: displayNamePriority === "filename" ? "check" : "circle", target: "set:filename" },
    ];
    return { label: "显示", dir: "", items };
}

function buildSettingsSystemLevel(): PopupLevel {
    return {
        label: "系统",
        dir: "",
        items: [
            { kind: "action", label: "清除提取缓存", icon: "trash-2", target: "set:clearcache" },
        ],
    };
}

function handleSettingsAction(row: PopupRow): void {
    switch (row.target) {
        case "set:name_jp":
        case "set:name_en": {
            const priority = row.target.replace("set:", "") as DisplayNamePriority;
            setDisplayNamePriority(priority);
            SetDisplayNamePriority(priority).catch(console.warn);
            break;
        }
        case "set:filename":
            setDisplayNamePriority("filename");
            SetDisplayNamePriority("filename").catch(console.warn);
            break;
        case "set:clearcache":
            ClearExtractCache().then(() => setStatus("✓ 缓存已清除", true)).catch(console.warn);
            break;
        case "set:external":
            closeAllOverlays();
            renderExternalList();
            dom.externalOverlay.classList.add("visible");
            break;
    }
}

export async function showSettings(): Promise<void> {
    closeAllOverlays();
    dom.settingsOverlay.classList.add("visible");

    if (!settingsStack) {
        settingsStack = new MenuStack({
            parentEl: dom.settingsOverlay,
            extraButtonFactory: () => {
                const closeBtn = dom.btnCloseSettings.cloneNode(true) as HTMLButtonElement;
                closeBtn.addEventListener("click", () => dom.settingsOverlay.classList.remove("visible"));
                return [closeBtn];
            },
            onItemClick: (row) => handleSettingsAction(row),
            onFolderEnter: (row) => {
                switch (row.target) {
                    case "settings:display": return buildSettingsDisplayLevel();
                    case "settings:system": return buildSettingsSystemLevel();
                    default: return null;
                }
            },
            onAfterRender: () => {},
        });
    }

    settingsStack.reset(buildSettingsRoot());
}

// Wire up events
dom.btnSettings.addEventListener("click", showSettings);
dom.btnCloseSettings.addEventListener("click", () => {
    dom.settingsOverlay.classList.remove("visible");
});
dom.btnManageExternal.addEventListener("click", () => {
    closeAllOverlays();
    renderExternalList();
    dom.externalOverlay.classList.add("visible");
});
dom.btnCloseExternal.addEventListener("click", () => {
    dom.externalOverlay.classList.remove("visible");
});
dom.btnAddExternal.addEventListener("click", addExternalPath);
