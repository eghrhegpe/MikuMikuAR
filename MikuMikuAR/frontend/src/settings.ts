// [doc:architecture] Settings — 设置页 + 外部库管理
// 规范文档: docs/architecture.md §模型库管理
// 职责: 配置读写、外部库挂载、软件目录扫描、MenuStack 设置页
// Settings page + external library management (MenuStack-based).

import { SetDisplayNamePriority,
         SelectDir, AddExternalPath, RemoveExternalPath,
         RenameExternalPath,
         ClearExtractCache,
         ScanSoftwareDir, LaunchSoftware, OpenSoftwareDir,
         AddCustomSoftware, RemoveCustomSoftware, UpdateCustomSoftware,
         AutoDetectMMD,
         SetBlenderPath,
         SetMMDPath,
         SelectExeFile,
         SetDownloadWatchDir,
         SetDownloadAutoImport,
         GetDownloadWatchStatus,
         StartWatchDir,
         StopWatchDir,
         SetUIScale, SetUIPopupWidth, SetUIAccent, SetUIFontFamily, SetUIAnimations, SetUIBlurBg } from "../wailsjs/go/main/App";
import {
    dom, closeAllOverlays, setStatus,
    libraryRoot, externalPaths,
    displayNamePriority, setDisplayNamePriority, DisplayNamePriority,
    PopupRow, PopupLevel, escapeHtml, cardContainer,
} from "./config";
import { SlideMenu } from "./menu";
import { showPopup, rescanAndSync, reloadConfig } from "./library";
import { softwareKindIcon, createIconifyIcon } from "./icons";

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
            <button class="overlay-rename" data-path="${escapeHtml(ep.path)}"><iconify-icon icon="lucide:edit-3"></iconify-icon></button>
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
    // Standard action rows (add, detect, paths, open dir) as normal MenuStack items
    const items: PopupRow[] = [
        { kind: "action", label: "添加自定义软件", icon: "plus", target: "set:addcustomsoftware" },
        { kind: "divider", label: "", icon: "", target: "" },
        { kind: "action", label: "自动检测 MMD", icon: "search", target: "set:detectmmd" },
        { kind: "action", label: "设置 MMD 路径", icon: "folder", target: "set:mmdpath" },
        { kind: "action", label: "设置 Blender 路径", icon: "cube-3d", target: "set:blenderpath" },
        { kind: "divider", label: "", icon: "", target: "" },
        { kind: "action", label: "打开目录", icon: "folder-open", target: "set:opensoftwaredir" },
    ];
    // Software list rendered inline with dual-action: click to detail, ▶ to launch
    return {
        label: "软件管理",
        dir: "",
        items,
        renderCustom: async (container) => {
            // Always fetch fresh data inside renderCustom to avoid stale flash
            await scanSoftwareDir();
            const entries = cachedSoftwareEntries;
            if (!entries || entries.length === 0) return;
            // Insert before the first standard item
            container.style.padding = "0";
            const listEl = document.createElement("div");
            listEl.style.cssText = "padding:4px 0;";
            for (const entry of entries) {
                const row = document.createElement("div");
                row.className = "menu-item";
                row.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 14px;cursor:pointer;border-radius:0;";
                // Click on the body → go to detail
                row.addEventListener("click", (e) => {
                    if ((e.target as HTMLElement).closest(".sw-play-btn")) return;
                    settingsStack?.push(buildSoftwareDetailLevel(entry.path));
                });
                row.innerHTML = `
                    <iconify-icon icon="${softwareKindIcon(entry.kind)}" style="font-size:14px;flex-shrink:0;"></iconify-icon>
                    <span style="flex:1;font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entry.name)}</span>
                    <span style="font-size:10px;color:var(--text-dim);white-space:nowrap;">${entry.kind}</span>
                    <span style="font-size:10px;color:var(--text-muted);margin-left:4px;">${entry.managed ? "自定义" : "auto"}</span>
                    <button class="sw-play-btn" style="background:none;border:none;color:var(--accent,#7c3aed);cursor:pointer;font-size:14px;padding:2px 4px;" title="直接启动">▶</button>
                `;
                row.querySelector(".sw-play-btn")!.addEventListener("click", (e) => {
                    e.stopPropagation();
                    LaunchSoftware(entry.path, entry.args || "").then(() => {
                        setStatus(`✓ 已启动: ${entry.name}`, true);
                    }).catch((err: any) => {
                        setStatus("✗ " + (err.message || err), false);
                    });
                });
                listEl.appendChild(row);
            }
            container.prepend(listEl);
        },
    };
}

function buildSoftwareDetailLevel(path: string): PopupLevel {
    const entries = cachedSoftwareEntries || [];
    const entry = entries.find(e => e.path === path);
    if (!entry) {
        return { label: "未知软件", dir: "", items: [{ kind: "action", label: "软件未找到", icon: "alert-circle", target: "" }] };
    }

    // For managed entries, show editable args input via renderCustom
    if (entry.managed) {
        return {
            label: entry.name,
            dir: "",
            items: [],
            renderCustom: async (container) => {
                container.style.padding = "12px 14px";

                const field = (label: string, value: string, readonly: boolean): HTMLDivElement => {
                    const row = document.createElement("div");
                    row.style.cssText = "margin-bottom:10px;";
                    const lbl = document.createElement("div");
                    lbl.style.cssText = "font-size:10px;color:var(--text-dim);margin-bottom:2px;";
                    lbl.textContent = label;
                    row.appendChild(lbl);
                    const val = document.createElement("div");
                    val.style.cssText = `font-size:12px;color:var(--text);word-break:break-all;${readonly ? "" : "background:var(--white-08);border:1px solid var(--border);border-radius:4px;padding:4px 6px;"}`;
                    if (readonly) {
                        val.textContent = value;
                    } else {
                        const input = document.createElement("input");
                        input.type = "text";
                        input.value = value;
                        input.style.cssText = "width:100%;background:transparent;border:none;color:var(--text);font-size:12px;outline:none;";
                        val.appendChild(input);
                        // Save on enter key
                        input.addEventListener("keydown", (e) => {
                            if (e.key === "Enter") {
                                input.blur();
                            }
                        });
                        input.addEventListener("blur", async () => {
                            try {
                                await UpdateCustomSoftware(entry.path, entry.name, input.value);
                                entry.args = input.value;
                                setStatus("✓ 参数已更新", true);
                            } catch (err) {
                                setStatus("✗ 更新失败", false);
                            }
                        });
                    }
                    row.appendChild(val);
                    return row;
                };

                container.appendChild(field("名称", entry.name, true));
                container.appendChild(field("路径", entry.path, true));
                container.appendChild(field("类型", entry.kind, true));
                container.appendChild(field("启动参数 (支持 {model} 占位符)", entry.args, false));

                const divider = document.createElement("div");
                divider.style.cssText = "height:1px;background:var(--border);margin:10px 0;";
                container.appendChild(divider);

                // Launch button
                const launchBtn = document.createElement("button");
                launchBtn.textContent = "▶ 启动";
                launchBtn.style.cssText = "width:100%;background:var(--accent,#7c3aed);color:#fff;border:none;border-radius:4px;padding:8px 12px;font-size:12px;cursor:pointer;margin-bottom:6px;";
                launchBtn.addEventListener("click", () => {
                    LaunchSoftware(entry.path, entry.args).then(() => {
                        setStatus(`✓ 已启动: ${entry.name}`, true);
                    }).catch((err: any) => {
                        setStatus("✗ " + (err.message || err), false);
                    });
                });
                container.appendChild(launchBtn);

                // Delete button (managed only)
                const delBtn = document.createElement("button");
                delBtn.textContent = "🗑 删除";
                delBtn.style.cssText = "width:100%;background:var(--danger,#e74c3c);color:#fff;border:none;border-radius:4px;padding:8px 12px;font-size:12px;cursor:pointer;";
                delBtn.addEventListener("click", async () => {
                    try {
                        await RemoveCustomSoftware(entry.path);
                        cachedSoftwareEntries = (cachedSoftwareEntries || []).filter(e => e.path !== entry.path);
                        setStatus(`✓ 已删除: ${entry.name}`, true);
                        settingsStack?.pop();
                        settingsStack?.reRender();
                    } catch (err) {
                        setStatus("✗ 删除失败", false);
                    }
                });
                container.appendChild(delBtn);
            },
        };
    }

    // Non-managed (scanned) entries: read-only summary + launch button
    return {
        label: entry.name,
        dir: "",
        items: [],
        renderCustom: async (container) => {
            container.style.padding = "12px 14px";

            const field = (label: string, value: string): HTMLDivElement => {
                const row = document.createElement("div");
                row.style.cssText = "margin-bottom:10px;";
                const lbl = document.createElement("div");
                lbl.style.cssText = "font-size:10px;color:var(--text-dim);margin-bottom:2px;";
                lbl.textContent = label;
                row.appendChild(lbl);
                const val = document.createElement("div");
                val.style.cssText = "font-size:12px;color:var(--text);word-break:break-all;";
                val.textContent = value;
                row.appendChild(val);
                return row;
            };

            container.appendChild(field("名称", entry.name));
            container.appendChild(field("路径", entry.path));
            container.appendChild(field("类型", entry.kind));

            const divider = document.createElement("div");
            divider.style.cssText = "height:1px;background:var(--border);margin:10px 0;";
            container.appendChild(divider);

            const launchBtn = document.createElement("button");
            launchBtn.textContent = "▶ 启动";
            launchBtn.style.cssText = "width:100%;background:var(--accent,#7c3aed);color:#fff;border:none;border-radius:4px;padding:8px 12px;font-size:12px;cursor:pointer;margin-bottom:6px;";
            launchBtn.addEventListener("click", () => {
                LaunchSoftware(entry.path, "").then(() => {
                    setStatus(`✓ 已启动: ${entry.name}`, true);
                }).catch((err: any) => {
                    setStatus("✗ " + (err.message || err), false);
                });
            });
            container.appendChild(launchBtn);

            // Convert to custom
            const convertBtn = document.createElement("button");
            convertBtn.textContent = "＋ 转为自定义（以便编辑参数）";
            convertBtn.style.cssText = "width:100%;background:var(--white-08);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:8px 12px;font-size:11px;cursor:pointer;";
            convertBtn.addEventListener("click", async () => {
                try {
                    const args = prompt("输入启动参数模板（支持 {model} 占位符，留空则不带参数）：", "");
                    if (args === null) return;
                    await AddCustomSoftware(entry.path, entry.name, args);
                    // Refresh local cache and re-render
                    cachedSoftwareEntries = await ScanSoftwareDir();
                    setStatus(`✓ 已转为自定义: ${entry.name}`, true);
                    settingsStack?.pop();
                    settingsStack?.reRender();
                } catch (err: any) {
                    setStatus("✗ " + (err.message || err), false);
                }
            });
            container.appendChild(convertBtn);
        },
    };
}

// ======== Settings (SlideMenu) ========

let settingsStack: SlideMenu | null = null;

function buildSettingsRoot(): PopupLevel {
    return {
        label: "设置",
        dir: "",
        items: [
            { kind: "folder", label: "显示", icon: "palette", target: "settings:display" },
            { kind: "folder", label: "界面", icon: "monitor", target: "settings:ui" },
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

function buildSettingsUILevel(): PopupLevel {
    return {
        label: "界面",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            cardContainer(container, (c) => {
                addCsRow(c, "UI 缩放", "lucide:maximize", 0.8, 1.3, 0.05, 1,
                    (v) => {
                        document.documentElement.style.setProperty("--ui-scale", String(v));
                        SetUIScale(v).catch(() => {});
                    });
                const advRow = document.createElement("div");
                advRow.className = "slide-item";
                advRow.innerHTML = '<span class="slide-icon"><iconify-icon icon="lucide:settings"></iconify-icon></span><span class="slide-label">高级设置</span><span class="slide-arrow">&gt;</span>';
                advRow.addEventListener("click", () => settingsStack?.push(buildSettingsUIAdvancedLevel()));
                c.appendChild(advRow);
            });
        },
    };
}

function buildSettingsUIAdvancedLevel(): PopupLevel {
    return {
        label: "高级设置",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            cardContainer(container, (c) => {
                addCsRow(c, "弹窗宽度", "lucide:sidebar", 220, 360, 10, 280,
                    (v) => {
                        document.documentElement.style.setProperty("--popup-width", v + "px");
                        SetUIPopupWidth(v).catch(() => {});
                    });
            addToggleRow(c, "滑动动画", "lucide:move",
                getComputedStyle(document.documentElement).getPropertyValue("--ui-animations").trim() !== "0",
                (v) => {
                    document.documentElement.style.setProperty("--ui-animations", v ? "1" : "0");
                    SetUIAnimations(v).catch(() => {});
                });
            addToggleRow(c, "背景模糊", "lucide:glass",
                getComputedStyle(document.documentElement).getPropertyValue("--ui-blur").trim() !== "0",
                (v) => {
                    document.documentElement.style.setProperty("--ui-blur", v ? "1" : "0");
                    document.querySelectorAll<HTMLElement>(".overlay").forEach(el => el.classList.toggle("blur-bg", v));
                    SetUIBlurBg(v).catch(() => {});
                });
            const themeRow = document.createElement("div");
            themeRow.className = "slide-item";
            themeRow.innerHTML = '<span class="slide-icon"><iconify-icon icon="lucide:palette"></iconify-icon></span><span class="slide-label">主题色</span><span class="slide-arrow">&gt;</span>';
            themeRow.addEventListener("click", () => settingsStack?.push(buildSettingsThemeLevel()));
            c.appendChild(themeRow);
            const fontRow = document.createElement("div");
            fontRow.className = "slide-item";
            fontRow.innerHTML = '<span class="slide-icon"><iconify-icon icon="lucide:type"></iconify-icon></span><span class="slide-label">字体</span><span class="slide-arrow">&gt;</span>';
            fontRow.addEventListener("click", () => settingsStack?.push(buildSettingsFontLevel()));
            c.appendChild(fontRow);
            const resetRow = document.createElement("div");
            resetRow.className = "slide-item";
            resetRow.innerHTML = '<span class="slide-icon"><iconify-icon icon="lucide:rotate-ccw"></iconify-icon></span><span class="slide-label">恢复默认</span>';
            resetRow.addEventListener("click", () => {
                const root = document.documentElement;
                root.style.setProperty("--ui-scale", "1");
                root.style.setProperty("--popup-width", "280px");
                root.style.setProperty("--accent", "#4a6cf7");
                root.style.setProperty("--accent-dim", "rgba(74,108,247,0.2)");
                root.style.setProperty("--font", "'Segoe UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK SC', system-ui, sans-serif");
                root.style.setProperty("--ui-animations", "1");
                root.style.setProperty("--ui-blur", "0");
                document.querySelectorAll<HTMLElement>(".overlay").forEach(el => el.classList.remove("blur-bg"));
                SetUIScale(1).catch(() => {});
                SetUIPopupWidth(280).catch(() => {});
                SetUIAccent("#4a6cf7").catch(() => {});
                SetUIFontFamily("system").catch(() => {});
                settingsStack?.reRender();
                setStatus("✓ UI 设置已恢复默认", true);
            });
            c.appendChild(resetRow);
            });
        },
    };
}

function addCsRow(container: HTMLElement, label: string, icon: string, min: number, max: number, step: number, initial: number, onChange: (v: number) => void): void {
    let currentValue = initial;
    const range = max - min;
    const row = document.createElement("div");
    row.className = "cs-row";

    const top = document.createElement("div");
    top.className = "cs-top";
    const iconBox = document.createElement("span");
    iconBox.className = "cs-icon";
    const iconEl = createIconifyIcon(icon);
    if (iconEl) iconBox.appendChild(iconEl);
    top.appendChild(iconBox);
    const lbl = document.createElement("span");
    lbl.className = "cs-label";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.className = "cs-value";
    const fmt = (v: number) => step >= 1 ? String(Math.round(v)) : v.toFixed(2);
    val.textContent = fmt(currentValue);
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
        val.textContent = fmt(v);
        fill.style.width = Math.max(0, Math.min(100, ((v - min) / range) * 100)) + "%";
    }

    row.addEventListener("click", (e) => {
        const rect = row.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        let delta: number;
        if (x < 0.25) delta = -(range * 0.15);
        else if (x < 0.5) delta = -(range * 0.05);
        else if (x < 0.75) delta = range * 0.05;
        else delta = range * 0.15;
        let newVal = Math.round((currentValue + delta) / step) * step;
        newVal = Math.max(min, Math.min(max, newVal));
        updateDisplay(newVal);
        onChange(newVal);
    });

    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);
}

const THEME_PRESETS: Array<{ label: string; color: string }> = [
    { label: "经典蓝", color: "#4a6cf7" },
    { label: "樱花粉", color: "#f74a6c" },
    { label: "薄荷绿", color: "#4af7a6" },
    { label: "日落橙", color: "#f7a64a" },
    { label: "暗夜紫", color: "#6c4af7" },
    { label: "极简灰", color: "#888888" },
];

function buildSettingsThemeLevel(): PopupLevel {
    return {
        label: "主题色",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            const currentAccent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#4a6cf7";
            cardContainer(container, (c) => {
                for (const p of THEME_PRESETS) {
                    const isActive = currentAccent.toLowerCase() === p.color.toLowerCase();
                    const row = document.createElement("div");
                    row.className = "slide-item" + (isActive ? " slide-focused" : "");
                    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:${isActive ? 'check-circle' : 'circle'}"></iconify-icon></span><span class="slide-label">${p.label}</span>`;
                    const swatch = document.createElement("span");
                    swatch.style.cssText = `width:16px;height:16px;border-radius:50%;background:${p.color};border:2px solid var(--white-12);flex-shrink:0;margin-left:auto;`;
                    row.appendChild(swatch);
                    row.addEventListener("click", () => setTheme(p.color));
                    c.appendChild(row);
                }
            });
            // Custom hex — separate card
            cardContainer(container, (c) => {
                c.style.cssText = "display:flex;gap:6px;padding:8px 14px;align-items:center;";
                const input = document.createElement("input");
                input.type = "text";
                input.placeholder = "#RRGGBB";
                input.className = "tag-input";
                input.value = currentAccent;
                const applyBtn = document.createElement("button");
                applyBtn.className = "btn btn-sm btn-primary";
                applyBtn.textContent = "应用";
                applyBtn.addEventListener("click", () => {
                    const hex = input.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(hex)) setTheme(hex);
                    else setStatus("✗ 无效的 hex 颜色", false);
                });
                c.appendChild(input);
                c.appendChild(applyBtn);
            });
        },
    };
}

function addToggleRow(container: HTMLElement, label: string, icon: string, value: boolean, onChange: (v: boolean) => void): void {
    const row = document.createElement("div");
    row.className = "slide-item";
    row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 14px;min-height:44px;cursor:pointer;";
    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:${icon}"></iconify-icon></span><span class="slide-label">${label}</span>`;
    const toggle = document.createElement("label");
    toggle.className = "toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    const slider = document.createElement("span");
    slider.className = "slider";
    toggle.appendChild(input);
    toggle.appendChild(slider);
    row.appendChild(toggle);
    row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".toggle")) return;
        input.checked = !input.checked;
        onChange(input.checked);
    });
    input.addEventListener("change", () => onChange(input.checked));
    container.appendChild(row);
}

function setTheme(hex: string): void {
    const root = document.documentElement;
    root.style.setProperty("--accent", hex);
    root.style.setProperty("--accent-dim", hex + "33");
    SetUIAccent(hex).catch(() => {});
    settingsStack?.reRender();
    setStatus(`✓ 主题色已设为 ${hex}`, true);
}

const FONT_MAP: Record<string, { label: string; css: string }> = {
    system: { label: "系统默认", css: "'Segoe UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK SC', system-ui, sans-serif" },
    noto: { label: "思源黑体", css: "'Source Han Sans SC', 'Noto Sans CJK SC', system-ui, sans-serif" },
    yahei: { label: "微软雅黑", css: "'Microsoft YaHei', 'Microsoft YaHei UI', system-ui, sans-serif" },
};

function buildSettingsFontLevel(): PopupLevel {
    return {
        label: "字体",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            const currentCss = getComputedStyle(document.documentElement).getPropertyValue("--font").trim();
            cardContainer(container, (c) => {
                for (const [key, f] of Object.entries(FONT_MAP)) {
                    const isActive = currentCss === f.css;
                    const row = document.createElement("div");
                    row.className = "slide-item" + (isActive ? " slide-focused" : "");
                    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:${isActive ? 'check' : 'circle'}"></iconify-icon></span><span class="slide-label">${f.label}</span>`;
                    row.addEventListener("click", () => {
                        document.documentElement.style.setProperty("--font", f.css);
                    SetUIFontFamily(key).catch(() => {});
                    settingsStack?.reRender();
                    setStatus(`✓ 字体已设为 ${f.label}`, true);
                });
                c.appendChild(row);
            }
        });
    },
    };
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
        case "set:addcustomsoftware":
            (async () => {
                try {
                    const path = await SelectExeFile();
                    if (!path) return;
                    const name = path.split(/[/\\]/).pop()?.replace(/\.exe$/i, "") || "未知";
                    const args = prompt("输入启动参数模板（支持 {model} 占位符，留空则不带参数）：", "");
                    if (args === null) return; // user cancelled
                    await AddCustomSoftware(path, name, args);
                    await scanSoftwareDir();
                    setStatus(`✓ 已添加: ${name}`, true);
                    settingsStack?.reRender();
                } catch (err: any) {
                    setStatus("✗ 添加失败: " + (err.message || err), false);
                }
            })();
            break;
        default:
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
            onClose: () => closeAllOverlays(),
            onItemClick: (row) => handleSettingsAction(row),
            onFolderEnter: (row) => {
                switch (row.target) {
                    case "settings:display": return buildSettingsDisplayLevel();
                    case "settings:ui": return buildSettingsUILevel();
                    case "settings:download": return buildSettingsDownloadLevel();
                    case "settings:system": return buildSettingsSystemLevel();
                    case "settings:external": return buildSettingsExternalLevel();
                    case "settings:clearcache": return buildSettingsClearCacheLevel();
                    case "settings:software":
                        return buildSettingsSoftwareLevel();
                    default:
                        if (row.target && row.target.startsWith("settings:software-detail:")) {
                            const path = row.target.slice("settings:software-detail:".length);
                            return buildSoftwareDetailLevel(path);
                        }
                        return null;
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
    closeAllOverlays();
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
