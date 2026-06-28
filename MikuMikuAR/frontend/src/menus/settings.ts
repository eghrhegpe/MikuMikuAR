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
         SetUIScale, SetUIPopupWidth, SetUIAccent, SetUIFontFamily, SetUIAnimations, SetUIBlurBg } from "../../wailsjs/go/main/App";
import {
    dom, closeAllOverlays, setStatus,
    libraryRoot, externalPaths,
    displayNamePriority, setDisplayNamePriority, DisplayNamePriority,
    PopupRow, PopupLevel, escapeHtml, cardContainer,
} from "../core/config";
import { SlideMenu } from "./menu";
import { slideRow } from "../core/ui-helpers";
import { rescanAndSync, reloadConfig } from "./library";
import { softwareKindIcon, createIconifyIcon } from "../core/icons";

// ======== Helpers re-exported ========
export { refreshLibrary } from "./library";

// ======== Software Management ========

let cachedSoftwareEntries: import("../../wailsjs/go/models").main.SoftwareEntry[] | null = null;

async function scanSoftwareDir(): Promise<void> {
    try {
        cachedSoftwareEntries = await ScanSoftwareDir();
    } catch (err) {
        console.error("ScanSoftwareDir error:", err);
        cachedSoftwareEntries = [];
    }
}

function buildSettingsSoftwareLevel(): PopupLevel {
    return {
        label: "软件管理",
        dir: "",
        items: [],
        renderCustom: async (container) => {
            container.classList.remove("render-card");

            await scanSoftwareDir();
            const entries = cachedSoftwareEntries;

            if (entries && entries.length > 0) {
                cardContainer(container, (c) => {
                    for (const entry of entries) {
                        const row = document.createElement("div");
                        row.className = "slide-item";
                        row.addEventListener("click", (e) => {
                            if ((e.target as HTMLElement).closest(".sw-play-btn")) return;
                            settingsStack?.push(buildSoftwareDetailLevel(entry.path));
                        });
                        row.innerHTML = `
                            <span class="slide-icon"><iconify-icon icon="${softwareKindIcon(entry.kind)}"></iconify-icon></span>
                            <span class="slide-label">${escapeHtml(entry.name)}</span>
                            <span class="slide-sublabel" style="font-size:10px;color:var(--text-dim);white-space:nowrap;">${entry.kind}</span>
                            <span class="slide-tag" style="font-size:9px;color:var(--text-muted);">${entry.managed ? "自定义" : "auto"}</span>
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
                        c.appendChild(row);
                    }
                });
            }

            cardContainer(container, (c) => {
                slideRow(c, "lucide:plus", "添加自定义软件", false, () => handleSettingsAction({ target: "set:addcustomsoftware" } as any));
                slideRow(c, "lucide:search", "自动检测 MMD", false, () => handleSettingsAction({ target: "set:detectmmd" } as any));
                slideRow(c, "lucide:folder", "设置 MMD 路径", false, () => handleSettingsAction({ target: "set:mmdpath" } as any));
                slideRow(c, "lucide:cube-3d", "设置 Blender 路径", false, () => handleSettingsAction({ target: "set:blenderpath" } as any));
            });

            cardContainer(container, (c) => {
                slideRow(c, "lucide:folder-open", "打开目录", false, () => handleSettingsAction({ target: "set:opensoftwaredir" } as any));
            });
        },
    };
}

function buildSoftwareDetailLevel(path: string): PopupLevel {
    const entries = cachedSoftwareEntries || [];
    const entry = entries.find(e => e.path === path);
    if (!entry) {
        return { label: "未知软件", dir: "", items: [{ kind: "action", label: "软件未找到", icon: "alert-circle", target: "" }] };
    }

    if (entry.managed) {
        return {
            label: entry.name,
            dir: "",
            items: [],
            renderCustom: async (container) => {
                container.classList.remove("render-card");

                cardContainer(container, (c) => {
                    const fields: Array<{ label: string; value: string }> = [
                        { label: "名称", value: entry.name },
                        { label: "路径", value: entry.path },
                        { label: "类型", value: entry.kind },
                    ];
                    for (const f of fields) {
                        const row = document.createElement("div");
                        row.className = "slide-item";
                        row.style.cssText = "display:flex;justify-content:space-between;padding:6px 14px;min-height:auto;margin:0;";
                        row.innerHTML = `<span class="slide-label" style="color:var(--text-dim);flex:none;">${f.label}</span><span class="slide-label" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;font-size:11px;">${escapeHtml(f.value)}</span>`;
                        c.appendChild(row);
                    }
                    const argRow = document.createElement("div");
                    argRow.style.cssText = "padding:6px 14px;";
                    const argLbl = document.createElement("div");
                    argLbl.style.cssText = "font-size:10px;color:var(--text-dim);margin-bottom:2px;";
                    argLbl.textContent = "启动参数 (支持 {model} 占位符)";
                    argRow.appendChild(argLbl);
                    const val = document.createElement("div");
                    val.style.cssText = "background:var(--white-08);border:1px solid var(--border);border-radius:4px;padding:4px 6px;";
                    const input = document.createElement("input");
                    input.type = "text"; input.value = entry.args || "";
                    input.style.cssText = "width:100%;background:transparent;border:none;color:var(--text);font-size:12px;outline:none;";
                    input.addEventListener("blur", async () => {
                        try { await UpdateCustomSoftware(entry.path, entry.name, input.value); entry.args = input.value; setStatus("✓ 参数已更新", true); }
                        catch { setStatus("✗ 更新失败", false); }
                    });
                    val.appendChild(input);
                    argRow.appendChild(val);
                    c.appendChild(argRow);
                });

                cardContainer(container, (c) => {
                    const launchRow = document.createElement("div");
                    launchRow.className = "slide-item";
                    const li = document.createElement("span"); li.className = "slide-icon";
                    const le = createIconifyIcon("lucide:play"); if (le) li.appendChild(le);
                    launchRow.appendChild(li);
                    const ll = document.createElement("span"); ll.className = "slide-label"; ll.textContent = "启动";
                    launchRow.appendChild(ll);
                    launchRow.addEventListener("click", () => {
                        LaunchSoftware(entry.path, entry.args).then(() => setStatus(`✓ 已启动: ${entry.name}`, true)).catch((err: any) => setStatus("✗ " + (err.message || err), false));
                    });
                    c.appendChild(launchRow);

                    const delRow = document.createElement("div");
                    delRow.className = "slide-item";
                    const di = document.createElement("span"); di.className = "slide-icon";
                    const de = createIconifyIcon("lucide:trash-2"); if (de) di.appendChild(de);
                    delRow.appendChild(di);
                    const dl = document.createElement("span"); dl.className = "slide-label"; dl.textContent = "删除"; dl.style.color = "var(--danger,#e74c3c)";
                    delRow.appendChild(dl);
                    delRow.addEventListener("click", async () => {
                        try {
                            await RemoveCustomSoftware(entry.path);
                            cachedSoftwareEntries = (cachedSoftwareEntries || []).filter(e => e.path !== entry.path);
                            setStatus(`✓ 已删除: ${entry.name}`, true);
                            settingsStack?.pop();
                            settingsStack?.reRender();
                        } catch { setStatus("✗ 删除失败", false); }
                    });
                    c.appendChild(delRow);
                });
            },
        };
    }

    return {
        label: entry.name,
        dir: "",
        items: [],
        renderCustom: async (container) => {
            container.classList.remove("render-card");

            cardContainer(container, (c) => {
                const fields: Array<{ label: string; value: string }> = [
                    { label: "名称", value: entry.name },
                    { label: "路径", value: entry.path },
                    { label: "类型", value: entry.kind },
                ];
                for (const f of fields) {
                    const row = document.createElement("div");
                    row.className = "slide-item";
                    row.style.cssText = "display:flex;justify-content:space-between;padding:6px 14px;min-height:auto;margin:0;";
                    row.innerHTML = `<span class="slide-label" style="color:var(--text-dim);flex:none;">${f.label}</span><span class="slide-label" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;font-size:11px;">${escapeHtml(f.value)}</span>`;
                    c.appendChild(row);
                }
            });

            cardContainer(container, (c) => {
                const launchRow = document.createElement("div");
                launchRow.className = "slide-item";
                const li = document.createElement("span"); li.className = "slide-icon";
                const le = createIconifyIcon("lucide:play"); if (le) li.appendChild(le);
                launchRow.appendChild(li);
                const ll = document.createElement("span"); ll.className = "slide-label"; ll.textContent = "启动";
                launchRow.appendChild(ll);
                launchRow.addEventListener("click", () => {
                    LaunchSoftware(entry.path, "").then(() => setStatus(`✓ 已启动: ${entry.name}`, true)).catch((err: any) => setStatus("✗ " + (err.message || err), false));
                });
                c.appendChild(launchRow);

                const convertRow = document.createElement("div");
                convertRow.className = "slide-item";
                const ci = document.createElement("span"); ci.className = "slide-icon";
                const ce = createIconifyIcon("lucide:plus"); if (ce) ci.appendChild(ce);
                convertRow.appendChild(ci);
                const cl = document.createElement("span"); cl.className = "slide-label"; cl.textContent = "转为自定义（以便编辑参数）";
                convertRow.appendChild(cl);
                convertRow.addEventListener("click", async () => {
                    try {
                        const args = prompt("输入启动参数模板（支持 {model} 占位符，留空则不带参数）：", "");
                        if (args === null) return;
                        await AddCustomSoftware(entry.path, entry.name, args);
                        cachedSoftwareEntries = await ScanSoftwareDir();
                        setStatus(`✓ 已转为自定义: ${entry.name}`, true);
                        settingsStack?.pop();
                        settingsStack?.reRender();
                    } catch (err: any) { setStatus("✗ " + (err.message || err), false); }
                });
                c.appendChild(convertRow);
            });
        },
    };
}

// ======== Settings (SlideMenu) ========

let settingsStack: SlideMenu | null = null;

function buildSettingsRoot(): PopupLevel {
    return {
        label: "设置",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            cardContainer(container, (c) => {
                slideRow(c, "lucide:palette", "显示", true, () => settingsStack?.push(buildSettingsDisplayLevel()));
                slideRow(c, "lucide:monitor", "界面", true, () => settingsStack?.push(buildSettingsUILevel()));
                slideRow(c, "lucide:download", "下载", true, () => settingsStack?.push(buildSettingsDownloadLevel()));
                slideRow(c, "lucide:settings", "系统", true, () => settingsStack?.push(buildSettingsSystemLevel()));
                slideRow(c, "lucide:package", "软件管理", true, () => settingsStack?.push(buildSettingsSoftwareLevel()));
            });
        },
    };
}

function buildSettingsDisplayLevel(): PopupLevel {
    const current = displayNamePriority;
    function pick(p: DisplayNamePriority): void {
        setDisplayNamePriority(p);
        SetDisplayNamePriority(p).catch(console.warn);
        settingsStack?.reRender();
    }
    return {
        label: "显示",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.classList.remove("render-card");
            cardContainer(container, (c) => {
                slideRow(c, current === "name_jp" ? "lucide:check-circle" : "lucide:circle", "日文名（name_jp）", false, () => pick("name_jp"));
                slideRow(c, current === "name_en" ? "lucide:check-circle" : "lucide:circle", "英文名（name_en）", false, () => pick("name_en"));
                slideRow(c, current === "filename" ? "lucide:check-circle" : "lucide:circle", "文件名（filename）", false, () => pick("filename"));
            });
        },
    };
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
        renderCustom: (container) => {
            container.classList.remove("render-card");

            cardContainer(container, (c) => {
                if (externalPaths.length === 0) {
                    const empty = document.createElement("div");
                    empty.style.cssText = "font-size:11px;color:var(--text-dim);padding:8px 0;text-align:center;";
                    empty.textContent = "暂无外部库";
                    c.appendChild(empty);
                    return;
                }
                for (const ep of externalPaths) {
                    const row = document.createElement("div");
                    row.className = "slide-item";
                    row.innerHTML = `
                        <span class="slide-icon"><iconify-icon icon="lucide:plug"></iconify-icon></span>
                        <span class="slide-label" style="flex:0 0 auto;margin-right:6px;">${escapeHtml(ep.name)}</span>
                        <span class="slide-sublabel" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim);font-size:10px;">${escapeHtml(ep.path)}</span>
                        <button class="ext-rename" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:12px;padding:2px 4px;">✎</button>
                        <button class="ext-del" style="background:none;border:none;color:var(--danger,#e74c3c);cursor:pointer;font-size:12px;padding:2px 4px;">✕</button>
                    `;
                    row.querySelector(".ext-rename")!.addEventListener("click", async () => {
                        const newName = prompt("输入新的显示名称：", ep.name);
                        if (newName && newName.trim() && newName.trim() !== ep.name) {
                            try {
                                await RenameExternalPath(ep.path, newName.trim());
                                await reloadConfig();
                                settingsStack?.reRender();
                                setStatus("✓ 已重命名", true);
                            } catch { setStatus("✗ 重命名失败", false); }
                        }
                    });
                    row.querySelector(".ext-del")!.addEventListener("click", async () => {
                        try {
                            await RemoveExternalPath(ep.path);
                            await reloadConfig();
                            if (libraryRoot) await rescanAndSync();
                            settingsStack?.reRender();
                        } catch (err) {
                            console.error("RemoveExternalPath error:", err);
                        }
                    });
                    c.appendChild(row);
                }
            });

            cardContainer(container, (c) => {
                slideRow(c, "lucide:plus", "添加外部库", false, async () => {
                    try {
                        const dir = await SelectDir();
                        if (!dir) return;
                        await AddExternalPath(dir);
                        await reloadConfig();
                        if (libraryRoot) await rescanAndSync();
                        settingsStack?.reRender();
                        setStatus("✓ 外部库已添加", true);
                    } catch (err) {
                        console.error("AddExternalPath error:", err);
                    }
                });
            });
        },
    };
}

function buildSettingsDownloadLevel(): PopupLevel {
    return {
        label: "下载",
        dir: "",
        items: [],
        renderCustom: async (container) => {
            container.classList.remove("render-card");

            let dirInput: HTMLInputElement;
            let refreshStatus: () => Promise<void>;

            cardContainer(container, (c) => {
                const statusEl = document.createElement("div");
                statusEl.style.cssText = "font-size:11px;color:var(--text-dim);padding:4px 14px;";
                c.appendChild(statusEl);

                refreshStatus = async () => {
                    try { const dir = await GetDownloadWatchStatus(); statusEl.textContent = dir ? `监听中: ${dir}` : "监听已停止"; }
                    catch { statusEl.textContent = "监听已停止"; }
                };
                refreshStatus();

                const dirRow = document.createElement("div");
                dirRow.style.cssText = "display:flex;gap:6px;padding:6px 14px;";
                dirInput = document.createElement("input");
                dirInput.type = "text"; dirInput.placeholder = "选择监听目录..."; dirInput.readOnly = true;
                dirInput.style.cssText = "flex:1;background:var(--white-08);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px 8px;font-size:12px;";
                const selectBtn = document.createElement("button");
                selectBtn.textContent = "📁";
                selectBtn.className = "mode-btn";
                selectBtn.addEventListener("click", async () => {
                    try {
                        const dir = await SelectDir(); if (!dir) return;
                        dirInput.value = dir; await SetDownloadWatchDir(dir); refreshStatus();
                        setStatus(`✓ 监听目录已设置: ${dir}`, true);
                    } catch { setStatus("✗ 设置监听目录失败", false); }
                });
                dirRow.appendChild(dirInput);
                dirRow.appendChild(selectBtn);
                c.appendChild(dirRow);

                GetDownloadWatchStatus().then(dir => { if (dir) dirInput.value = dir; }).catch(() => {});
            });

            cardContainer(container, (c) => {
                addToggleRow(c, "自动导入（跳过确认）", "lucide:download", false, async (v) => {
                    try { await SetDownloadAutoImport(v); setStatus(v ? "✓ 自动导入已开启" : "✓ 自动导入已关闭", true); }
                    catch { setStatus("✗ 设置失败", false); }
                });
            });

            cardContainer(container, (c) => {
                const stopRow = document.createElement("div");
                stopRow.className = "slide-item";
                const si = document.createElement("span"); si.className = "slide-icon";
                const se = createIconifyIcon("lucide:stop-circle"); if (se) si.appendChild(se);
                stopRow.appendChild(si);
                const sl = document.createElement("span"); sl.className = "slide-label"; sl.textContent = "停止监听"; sl.style.color = "var(--danger,#e74c3c)";
                stopRow.appendChild(sl);
                stopRow.addEventListener("click", async () => {
                    try { await StopWatchDir(); dirInput.value = ""; refreshStatus(); setStatus("✓ 已停止监听", true); }
                    catch { setStatus("✗ 停止监听失败", false); }
                });
                c.appendChild(stopRow);
            });
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

// Wire up close button (open button wired dynamically from main.ts)
dom.btnCloseSettings.addEventListener("click", () => {
    closeAllOverlays();
});
