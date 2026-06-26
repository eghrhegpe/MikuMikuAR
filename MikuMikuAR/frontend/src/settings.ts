// [doc:architecture] Settings — 设置页 + 外部库管理
// 规范文档: docs/architecture.md §模型库管理
// 职责: 配置读写、外部库挂载、软件目录扫描、MenuStack 设置页
// Settings page + external library management (MenuStack-based).

import { SetDisplayNamePriority,
         SelectDir, AddExternalPath, RemoveExternalPath,
         RenameExternalPath,
         ClearExtractCache,
         ScanSoftwareDir, LaunchSoftware, OpenSoftwareDir,
         AutoDetectMMD,
         SetBlenderPath,
         SetMMDPath,
         SelectExeFile,
         SetDownloadWatchDir,
         SetDownloadAutoImport,
         GetDownloadWatchStatus,
         StartWatchDir,
         StopWatchDir } from "../wailsjs/go/main/App";
import {
    dom, closeAllOverlays, setStatus,
    libraryRoot, externalPaths,
    displayNamePriority, setDisplayNamePriority, DisplayNamePriority,
    PopupRow, PopupLevel, escapeHtml,
} from "./config";
import { SlideMenu } from "./menu";
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
            <button class="overlay-rename" data-path="${escapeHtml(ep.path)}"><iconify-icon icon="edit-3"></iconify-icon></button>
            <button class="overlay-del" data-path="${escapeHtml(ep.path)}">✕</button>
        `;
        const renameBtn = row.querySelector(".overlay-rename") as HTMLButtonElement;
        renameBtn.addEventListener("click", () => {
            const newName = prompt("输入新的显示名称：", ep.name);
            if (newName && newName.trim() && newName.trim() !== ep.name) {
                RenameExternalPath(ep.path, newName.trim()).then(async () => {
                    await reloadConfig();
                    renderExternalList();
                    setStatus(`✓ 已重命名: ${newName.trim()}`, true);
                }).catch((err) => {
                    setStatus("✗ 重命名失败", false);
                    console.error("RenameExternalPath error:", err);
                });
            }
        });
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

// ======== Software Management ========

let cachedSoftwareEntries: import("../wailsjs/go/models").main.SoftwareEntry[] | null = null;

async function scanSoftwareDir(): Promise<void> {
    try {
        cachedSoftwareEntries = await ScanSoftwareDir();
    } catch (err) {
        console.error("ScanSoftwareDir error:", err);
        cachedSoftwareEntries = [];
    }
}

function buildSettingsSoftwareLevel(): PopupLevel {
    const items: PopupRow[] = (cachedSoftwareEntries || []).map(entry => ({
        kind: "action" as const,
        label: entry.name,
        icon: "app-window",
        target: "launch:" + entry.path,
    }));
    items.push(
        { kind: "divider", label: "", icon: "", target: "" },
        { kind: "action", label: "自动检测 MMD", icon: "external-link", target: "set:detectmmd" },
        { kind: "action", label: "设置 MMD 路径", icon: "folder", target: "set:mmdpath" },
        { kind: "action", label: "设置 Blender 路径", icon: "edit-3", target: "set:blenderpath" },
        { kind: "divider", label: "", icon: "", target: "" },
        { kind: "action", label: "打开目录", icon: "folder-open", target: "set:opensoftwaredir" },
    );
    return { label: "软件管理", dir: "", items };
}

// ======== Settings (SlideMenu) ========

let settingsStack: SlideMenu | null = null;

function buildSettingsRoot(): PopupLevel {
    return {
        label: "设置",
        dir: "",
        items: [
            { kind: "folder", label: "显示", icon: "palette", target: "settings:display" },
            { kind: "folder", label: "下载", icon: "download", target: "settings:download" },
            { kind: "folder", label: "系统", icon: "settings", target: "settings:system" },
            { kind: "folder", label: "软件管理", icon: "package", target: "settings:software" },
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

function buildSettingsClearCacheLevel(): PopupLevel {
    return {
        label: "清除缓存",
        dir: "",
        items: [
            { kind: "action", label: "提取缓存", icon: "trash-2", target: "set:clearextractcache" },
            { kind: "action", label: "缩略图缓存", icon: "image", target: "set:clearthumbnail", sublabel: "即将推出" },
        ],
    };
}

function buildSettingsSystemLevel(): PopupLevel {
    return {
        label: "系统",
        dir: "",
        items: [
            { kind: "folder", label: "外部库管理", icon: "plug", target: "settings:external" },
            { kind: "folder", label: "清除缓存", icon: "trash-2", target: "settings:clearcache" },
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
        case "set:clearextractcache":
            ClearExtractCache().then(() => setStatus("✓ 提取缓存已清除", true)).catch(console.warn);
            break;
        case "set:addexternal":
            (async () => {
                try {
                    const dir = await SelectDir();
                    if (!dir) return;
                    await AddExternalPath(dir);
                    await reloadConfig();
                    if (libraryRoot) await rescanAndSync();
                    setStatus("✓ 外部库已添加", true);
                } catch (err) {
                    console.error("AddExternalPath error:", err);
                }
            })();
            break;
        case "set:detectmmd":
            (async () => {
                try {
                    const path = await AutoDetectMMD();
                    setStatus(`✓ MMD 已检测: ${path}`, true);
                } catch (err: any) {
                    setStatus("✗ 未找到 MMD，请在「软件管理」中手动添加", false);
                }
            })();
            break;
        case "set:blenderpath":
            (async () => {
                try {
                    const path = await SelectExeFile();
                    if (!path) return;
                    await SetBlenderPath(path);
                    setStatus(`✓ Blender 路径已设置`, true);
                } catch (err: any) {
                    setStatus("✗ 设置失败: " + (err.message || err), false);
                }
            })();
            break;
        case "set:mmdpath":
            (async () => {
                try {
                    const path = await SelectExeFile();
                    if (!path) return;
                    await SetMMDPath(path);
                    setStatus(`✓ MMD 路径已设置`, true);
                } catch (err: any) {
                    setStatus("✗ 设置失败: " + (err.message || err), false);
                }
            })();
            break;
        case "set:opensoftwaredir":
            OpenSoftwareDir().catch(console.warn);
            break;
        default:
            if (row.target && row.target.startsWith("launch:")) {
                LaunchSoftware(row.target.slice(7)).catch(console.warn);
            }
            break;
    }
}

// ======== Download Settings ========

function buildSettingsExternalLevel(): PopupLevel {
    return {
        label: "外部库管理",
        dir: "",
        items: [],
        renderCustom: async (container) => {
            container.style.padding = "12px 14px";

            const listEl = document.createElement("div");
            listEl.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:12px;";
            container.appendChild(listEl);

            async function refreshList(): Promise<void> {
                listEl.innerHTML = "";
                if (externalPaths.length === 0) {
                    listEl.innerHTML = '<div style="font-size:11px;color:var(--text-dim);">暂无外部库</div>';
                    return;
                }
                for (const ep of externalPaths) {
                    const row = document.createElement("div");
                    row.style.cssText = "display:flex;align-items:center;gap:6px;background:var(--white-08);border-radius:4px;padding:6px 8px;";
                    row.innerHTML = `
                        <span style="flex:1;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ep.name)}</span>
                        <span style="flex:1;font-size:10px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ep.path)}</span>
                        <button class="ext-rename" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:2px 4px;">✎</button>
                        <button class="ext-del" style="background:none;border:none;color:var(--danger,#e74c3c);cursor:pointer;font-size:12px;padding:2px 4px;">✕</button>
                    `;
                    row.querySelector(".ext-rename")!.addEventListener("click", () => {
                        const newName = prompt("输入新的显示名称：", ep.name);
                        if (newName && newName.trim() && newName.trim() !== ep.name) {
                            RenameExternalPath(ep.path, newName.trim()).then(async () => {
                                await reloadConfig();
                                refreshList();
                                setStatus(`✓ 已重命名`, true);
                            }).catch(() => setStatus("✗ 重命名失败", false));
                        }
                    });
                    row.querySelector(".ext-del")!.addEventListener("click", async () => {
                        try {
                            await RemoveExternalPath(ep.path);
                            await reloadConfig();
                            if (libraryRoot) await rescanAndSync();
                            refreshList();
                        } catch (err) {
                            console.error("RemoveExternalPath error:", err);
                        }
                    });
                    listEl.appendChild(row);
                }
            }

            const addBtn = document.createElement("button");
            addBtn.textContent = "＋ 添加外部库";
            addBtn.style.cssText = "width:100%;background:var(--accent,#7c3aed);color:#fff;border:none;border-radius:4px;padding:8px 12px;font-size:12px;cursor:pointer;";
            addBtn.addEventListener("click", async () => {
                try {
                    const dir = await SelectDir();
                    if (!dir) return;
                    await AddExternalPath(dir);
                    await reloadConfig();
                    if (libraryRoot) await rescanAndSync();
                    refreshList();
                    setStatus("✓ 外部库已添加", true);
                } catch (err) {
                    console.error("AddExternalPath error:", err);
                }
            });
            container.appendChild(addBtn);

            refreshList();
        },
    };
}

function buildSettingsDownloadLevel(): PopupLevel {
    return {
        label: "下载",
        dir: "",
        items: [],
        renderCustom: async (container) => {
            container.style.padding = "12px 14px";

            // Current status
            const statusEl = document.createElement("div");
            statusEl.style.cssText = "font-size:11px;color:var(--text-dim);margin-bottom:10px;";
            container.appendChild(statusEl);

            async function refreshStatus(): Promise<void> {
                try {
                    const dir = await GetDownloadWatchStatus();
                    statusEl.textContent = dir ? `监听中: ${dir}` : "监听已停止";
                } catch {
                    statusEl.textContent = "监听已停止";
                }
            }
            refreshStatus();

            // Directory input row
            const dirRow = document.createElement("div");
            dirRow.style.cssText = "display:flex;gap:6px;margin-bottom:10px;";
            const dirInput = document.createElement("input");
            dirInput.type = "text";
            dirInput.placeholder = "选择监听目录...";
            dirInput.readOnly = true;
            dirInput.style.cssText = "flex:1;background:var(--white-08);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px 8px;font-size:12px;";
            const selectBtn = document.createElement("button");
            selectBtn.textContent = "📁";
            selectBtn.style.cssText = "background:var(--white-08);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px 10px;cursor:pointer;font-size:14px;";
            selectBtn.addEventListener("click", async () => {
                try {
                    const dir = await SelectDir();
                    if (!dir) return;
                    dirInput.value = dir;
                    await SetDownloadWatchDir(dir);
                    refreshStatus();
                    setStatus(`✓ 监听目录已设置: ${dir}`, true);
                } catch (err: any) {
                    setStatus("✗ 设置监听目录失败", false);
                }
            });
            dirRow.appendChild(dirInput);
            dirRow.appendChild(selectBtn);
            container.appendChild(dirRow);

            // Get current watch dir to populate input
            GetDownloadWatchStatus().then(dir => {
                if (dir) dirInput.value = dir;
            }).catch(() => {});

            // Auto-import toggle
            const autoRow = document.createElement("div");
            autoRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;justify-content:space-between;";
            const autoLabel = document.createElement("span");
            autoLabel.style.cssText = "font-size:11px;color:var(--text-dim);";
            autoLabel.textContent = "自动导入（跳过确认）";
            const autoToggle = document.createElement("input");
            autoToggle.type = "checkbox";
            autoToggle.style.cssText = "accent-color:var(--accent);cursor:pointer;";
            autoToggle.addEventListener("change", async () => {
                try {
                    await SetDownloadAutoImport(autoToggle.checked);
                    setStatus(autoToggle.checked ? "✓ 自动导入已开启" : "✓ 自动导入已关闭", true);
                } catch {
                    setStatus("✗ 设置失败", false);
                }
            });
            autoRow.appendChild(autoLabel);
            autoRow.appendChild(autoToggle);
            container.appendChild(autoRow);

            // Stop watch button
            const stopBtn = document.createElement("button");
            stopBtn.textContent = "停止监听";
            stopBtn.style.cssText = "background:var(--danger,#e74c3c);color:#fff;border:none;border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer;";
            stopBtn.addEventListener("click", async () => {
                try {
                    await StopWatchDir();
                    dirInput.value = "";
                    refreshStatus();
                    setStatus("✓ 已停止监听", true);
                } catch {
                    setStatus("✗ 停止监听失败", false);
                }
            });
            container.appendChild(stopBtn);
        },
    };
}

export async function showSettings(): Promise<void> {
    closeAllOverlays();
    dom.settingsOverlay.classList.add("visible");

    if (!settingsStack) {
        settingsStack = new SlideMenu({
            container: dom.settingsOverlay,
            onClose: () => dom.settingsOverlay.classList.remove("visible"),
            onItemClick: (row) => handleSettingsAction(row),
            onFolderEnter: (row) => {
                switch (row.target) {
                    case "settings:display": return buildSettingsDisplayLevel();
                    case "settings:download": return buildSettingsDownloadLevel();
                    case "settings:system": return buildSettingsSystemLevel();
                    case "settings:external": return buildSettingsExternalLevel();
                    case "settings:clearcache": return buildSettingsClearCacheLevel();
                    case "settings:software":
                        if (!cachedSoftwareEntries) {
                            // First time: scan then re-render to show results
                            scanSoftwareDir().then(() => settingsStack?.reRender());
                        } else {
                            scanSoftwareDir().then(() => settingsStack?.reRender());
                        }
                        return buildSettingsSoftwareLevel();
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
