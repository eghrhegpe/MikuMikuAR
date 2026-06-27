// [doc:architecture] Motion Popup — 动作弹窗 + 舞蹈套装
// 从 library.ts 提取

import {
  dom, setStatus, libraryRoot, allModels,
  PopupLevel, PopupRow, escapeHtml,
  modelRegistry, isPlaying, setIsPlaying, mmdRuntime,
  autoLoop, setAutoLoop, focusedModelId,
  motionBindingTargetId, setMotionBindingTargetId,
  stackRegistry,
  closeAllOverlays,
} from "./config";
import {
  loadVMDFromPath, loadVPDPose,
  updatePlaybackUI,
} from "./scene";
import { SlideMenu } from "./menu";
import { slideRow, addSliderRow } from "./ui-helpers";
import { createIconifyIcon } from "./icons";
import { loadAudioFile, setAudioOffset, getAudioPath, getAudioName, getVolume, getAudioOffset } from "./audio";
import {
  SelectAudioFile, SelectVMDMotion, SelectVPDPose,
  GetDanceSets, SaveDanceSet, DeleteDanceSet, ImportDanceSet,
} from "../wailsjs/go/main/App";

// ======== Dance Set Types & State ========

export type DanceSet = {
  name: string;
  vmd_path: string;
  audio_path: string;
  audio_offset: number;
  description: string;
  thumbnail: string;
  source: string;
};

let danceSets: DanceSet[] = [];
export let currentDanceSetId: string | null = null;

function computeDanceSetId(ds: DanceSet): string {
  return sha256Hex(ds.vmd_path + ":" + ds.audio_path).substring(0, 16);
}

function sha256Hex(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, "0") + Math.abs(hash * 7).toString(16).padStart(16, "0");
}

export async function loadDanceSets(): Promise<void> {
  try {
    const sets = await GetDanceSets();
    danceSets = sets || [];
  } catch (err) {
    console.warn("loadDanceSets:", err);
    danceSets = [];
  }
}

async function loadDanceSetAudio(ds: DanceSet): Promise<void> {
  if (!ds.audio_path) return;
  try {
    await loadAudioFile(ds.audio_path);
    setAudioOffset(ds.audio_offset || 0);
  } catch (err) {
    console.warn("loadDanceSetAudio failed:", err);
    setStatus("✗ 音频加载失败", false);
  }
}

// ======== Build action model row and binding ========

function buildActionModelRow(id: string): PopupRow {
  const inst = modelRegistry.get(id);
  if (!inst) return { kind: "action", label: "?", icon: "help-circle", target: "" };
  return {
    kind: "folder",
    label: inst.name,
    icon: "tabler:cube-3d-sphere",
    target: `action:binding:${id}`,
    sublabel: inst.vmdName || undefined,
    catTag: inst.kind === "actor" ? "角色" : "舞台",
  };
}

function buildActionBindingLevel(id: string): PopupLevel {
  const inst = modelRegistry.get(id);
  if (!inst) return { label: "动作绑定", dir: "", items: [] };
  return {
    label: `动作 — ${inst.name}`,
    dir: "",
    items: [
      { kind: "action", label: `当前: ${inst.vmdName || "无"}`, icon: "info", target: "", sublabel: undefined },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "folder", label: "更换动作", icon: "music", target: `action:motion:browse:${id}`, sublabel: "从动作库选择" },
      { kind: "action", label: "加载姿势 (VPD)", icon: "user", target: `action:motion:pose:${id}`, sublabel: "从 VPD 文件加载静态姿势" },
      { kind: "action", label: inst.mmdModel ? (inst.vmdData ? "暂停动作" : "—") : "—", icon: "pause-circle", target: `action:motion:pause:${id}`, sublabel: inst.vmdData ? "暂停/继续" : "无动作" },
      { kind: "action", label: "重置动作", icon: "rotate-ccw", target: `action:motion:reset:${id}`, sublabel: "恢复初始姿势" },
      { kind: "divider", label: "", icon: "", target: "" },
      { kind: "action", label: `循环: ${inst.vmdData ? (autoLoop ? "开" : "关") : "—"}`, icon: "repeat", target: `action:motion:loop:${id}`, sublabel: inst.vmdData ? "切换自动循环" : "加载动作后可用" },
    ],
  };
}

// ======== Music Level ========

function buildActionMusicLevel(): PopupLevel {
  const name = getAudioName();
  const offset = getAudioOffset();
  return {
    label: "音乐",
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";
      const nameRow = document.createElement("div");
      nameRow.style.cssText = "font-size:12px;color:var(--text-dim);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      nameRow.textContent = name ? `当前: ${name}` : "未加载音乐";
      container.appendChild(nameRow);

      const loadRow = document.createElement("div");
      loadRow.className = "menu-item";
      loadRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="folder-open"></iconify-icon></span><span class="menu-label">加载音乐</span>';
      loadRow.addEventListener("click", async () => {
        try {
          const path = await SelectAudioFile();
          if (!path) return;
          await loadAudioFile(path);
          setStatus(`✓ 音乐: ${getAudioName()}`, true);
          motionStack?.reRender();
        } catch (err) {
          console.warn("Load audio failed:", err);
          setStatus("✗ 音乐加载失败", false);
        }
      });
      container.appendChild(loadRow);

      const offsetRow = document.createElement("div");
      offsetRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
      const offsetLbl = document.createElement("label");
      offsetLbl.style.cssText = "font-size:11px;color:var(--text-dim);width:80px;flex-shrink:0;";
      offsetLbl.textContent = "音频偏移";
      const offsetVal = document.createElement("span");
      offsetVal.style.cssText = "font-size:11px;color:var(--text-bright);width:36px;text-align:right;";
      offsetVal.textContent = offset.toFixed(2);
      const offsetSlider = document.createElement("input");
      offsetSlider.type = "range";
      offsetSlider.min = "-5";
      offsetSlider.max = "5";
      offsetSlider.step = "0.1";
      offsetSlider.value = String(offset);
      offsetSlider.style.cssText = "flex:1;accent-color:var(--accent);height:4px;";
      offsetSlider.addEventListener("input", () => {
        const v = parseFloat(offsetSlider.value);
        offsetVal.textContent = v.toFixed(2);
        setAudioOffset(v);
      });
      offsetRow.appendChild(offsetLbl);
      offsetRow.appendChild(offsetSlider);
      offsetRow.appendChild(offsetVal);
      container.appendChild(offsetRow);
      const offsetHint = document.createElement("div");
      offsetHint.style.cssText = "font-size:10px;color:var(--text-dark);margin:-4px 0 10px 88px;";
      offsetHint.textContent = "正=音频先播，负=音频后播";
      container.appendChild(offsetHint);
    },
  };
}

// ======== Motion Stack ========

let motionStack: SlideMenu | null = null;

function makeMotionStack(): SlideMenu {
  return new SlideMenu({
    container: dom.motionPopup,
    onClose: hideMotionPopup,
    onFolderEnter: (row) => {
      if (row.target === "__dance_sets__") {
        setMotionBindingTargetId(null);
        return buildDanceSetsOverviewLevel();
      }
      if (row.target === "__music__") {
        setMotionBindingTargetId(null);
        return buildActionMusicLevel();
      }
      if (row.target && row.target.startsWith("action:binding:")) {
        setMotionBindingTargetId(null);
        const id = row.target.replace("action:binding:", "");
        return buildActionBindingLevel(id);
      }
      if (row.target && row.target.startsWith("action:motion:browse:")) {
        const id = row.target.replace("action:motion:browse:", "");
        setMotionBindingTargetId(id);
        const level = stackRegistry.buildLevel!(libraryRoot, "动作库", (m) => m.format === "vmd");
        const inst = modelRegistry.get(id);
        level.label = `绑定动作 → ${inst?.name || "模型"}`;
        return level;
      }
      return null;
    },
    onItemClick: (row: PopupRow) => {
      if (row.model) {
        if (row.model.format === "vmd" && motionBindingTargetId) {
          hideMotionPopup();
          loadVMDFromPath(row.model.file_path, motionBindingTargetId);
          setMotionBindingTargetId(null);
          return;
        }
        hideMotionPopup();
        if (row.model.format === "vmd") loadVMDFromPath(row.model.file_path);
        return;
      }
      if (row.target && row.target.startsWith("action:motion:")) {
        const parts = row.target.split(":");
        const action = parts[2];
        const id = parts.slice(3).join(":");
        if (!id) return;
        const inst = modelRegistry.get(id);
        if (!inst) return;
        switch (action) {
          case "pause":
            if (mmdRuntime) {
              if (isPlaying) {
                mmdRuntime.pauseAnimation();
                setIsPlaying(false);
                setAutoLoop(false);
              } else {
                setAutoLoop(true);
                mmdRuntime.playAnimation().then(() => setIsPlaying(true));
              }
              updatePlaybackUI();
              motionStack?.reRender();
            }
            break;
          case "reset":
            if (inst.mmdModel && mmdRuntime) {
              inst.mmdModel.setRuntimeAnimation(null);
              inst.vmdData = null;
              inst.vmdName = "";
              inst.vmdPath = null;
              inst.animationDuration = 0;
              if (isPlaying) {
                mmdRuntime.pauseAnimation();
                setIsPlaying(false);
              }
              updatePlaybackUI();
              motionStack?.reRender();
              setStatus("✓ 动作已重置", true);
            }
            break;
          case "pose":
            (async () => {
              try {
                const path = await SelectVPDPose();
                if (!path) { setStatus("✗ 未选择文件", false); return; }
                await loadVPDPose(path, id);
                motionStack?.reRender();
              } catch (err: any) {
                setStatus("✗ " + (err.message || err), false);
              }
            })();
            break;
          case "loop":
            setAutoLoop(!autoLoop);
            motionStack?.reRender();
            setStatus(`循环: ${autoLoop ? "开" : "关"}`, true);
            break;
        }
        return;
      }
    },
  });
}

// ======== Popup Show / Hide ========

export function showMotionPopup(): void {
  closeAllOverlays();
  dom.motionPopup.classList.add("visible");

  if (!motionStack) {
    motionStack = makeMotionStack();
  }

  const rootItems: PopupRow[] = [];

  if (modelRegistry.size > 0) {
    for (const [id, inst] of modelRegistry) {
      rootItems.push(buildActionModelRow(id));
    }
  }

  rootItems.push({ kind: "divider", label: "", icon: "", target: "" });
  rootItems.push(
    {
      kind: "folder",
      label: "舞蹈套装",
      icon: "music",
      target: "__dance_sets__",
      sublabel: danceSets.length > 0 ? `${danceSets.length} 个套装` : "暂无套装",
    },
    {
      kind: "folder",
      label: "音乐",
      icon: "music",
      target: "__music__",
      sublabel: getAudioName() || "未加载",
    },
  );

  motionStack.reset({ label: "动作", dir: "", items: rootItems });
}

export function hideMotionPopup(): void {
  dom.motionPopup.classList.remove("visible");
}

// ======== Dance Sets ========

function buildDanceSetsOverviewLevel(): PopupLevel {
  return {
    label: "舞蹈套装",
    dir: "",
    items: [],
    renderCustom: async (container) => {
      container.style.padding = "12px 14px";
      try {
        await loadDanceSets();
        if (!danceSets || danceSets.length === 0) {
          const empty = document.createElement("div");
          empty.style.cssText = "padding:16px;text-align:center;color:var(--text-muted);font-size:13px;";
          empty.innerHTML = '<div>暂无舞蹈套装</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">点击下方按钮创建新套装</div>';
          container.appendChild(empty);
        } else {
          for (const ds of danceSets) {
            const setId = computeDanceSetId(ds);
            const row = document.createElement("div");
            row.className = "menu-item";
            const vmdName = ds.vmd_path.split("/").pop() || ds.vmd_path;
            row.innerHTML = `
              <span class="menu-icon"><iconify-icon icon="music"></iconify-icon></span>
              <span class="menu-label">${escapeHtml(ds.name)}</span>
              <span class="menu-arrow">&gt;</span>
            `;
            row.setAttribute("data-hint", ds.description || vmdName);
            row.addEventListener("click", () => {
              const level = buildDanceSetDetailLevel(setId);
              stackRegistry.modelStack?.push(level);
            });
            container.appendChild(row);
  }
}

// Close button listener (safe at module level — only element in motion popup)
dom.btnCloseMotionPopup?.addEventListener("click", hideMotionPopup);

        const divider = document.createElement("div");
        divider.className = "menu-divider";
        container.appendChild(divider);
        const addRow = document.createElement("div");
        addRow.className = "menu-item";
        addRow.innerHTML = '<span class="menu-icon"><iconify-icon icon="plus"></iconify-icon></span><span class="menu-label">新建套装</span>';
        addRow.addEventListener("click", () => {
          createNewDanceSet();
        });
        container.appendChild(addRow);
      } catch (err) {
        console.warn("buildDanceSetsOverviewLevel:", err);
        container.textContent = "加载失败";
      }
    },
  };
}

export function buildDanceSetDetailLevel(setId: string): PopupLevel {
  const ds = danceSets.find(d => computeDanceSetId(d) === setId);
  if (!ds) return { label: "未知套装", dir: "", items: [] };

  const vmdName = ds.vmd_path.split("/").pop() || ds.vmd_path;
  const audioName = ds.audio_path ? ds.audio_path.split("/").pop() : "无";

  return {
    label: ds.name,
    dir: "",
    items: [],
    renderCustom: (container) => {
      container.style.padding = "12px 14px";

      const fields: Array<{ label: string; value: string }> = [
        { label: "套装名称", value: ds.name },
        { label: "VMD 文件", value: vmdName },
        { label: "音频文件", value: audioName },
        { label: "音频偏移", value: `${ds.audio_offset.toFixed(2)} 秒` },
        { label: "描述", value: ds.description || "—" },
      ];

      for (const f of fields) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;";
        const lbl = document.createElement("span");
        lbl.style.cssText = "color:var(--text-dim);";
        lbl.textContent = f.label;
        const val = document.createElement("span");
        val.style.cssText = "color:var(--text-bright);text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;";
        val.textContent = f.value;
        val.title = f.value;
        row.appendChild(lbl);
        row.appendChild(val);
        container.appendChild(row);
      }

      const divider1 = document.createElement("div");
      divider1.className = "menu-divider";
      divider1.style.marginTop = "8px";
      container.appendChild(divider1);

      const loadBtn = document.createElement("div");
      loadBtn.className = "menu-item";
      loadBtn.innerHTML = '<span class="menu-icon"><iconify-icon icon="play"></iconify-icon></span><span class="menu-label">一键加载</span>';
      loadBtn.addEventListener("click", () => {
        loadDanceSet(ds);
      });
      container.appendChild(loadBtn);

      const deleteBtn = document.createElement("div");
      deleteBtn.className = "menu-item";
      deleteBtn.innerHTML = '<span class="menu-icon"><iconify-icon icon="trash-2"></iconify-icon></span><span class="menu-label" style="color:var(--danger,#ff6b6b);">删除套装</span>';
      deleteBtn.addEventListener("click", () => {
        if (confirm(`确定要删除舞蹈套装「${ds.name}」吗？`)) {
          DeleteDanceSet(setId).then(() => {
            setStatus("✓ 已删除舞蹈套装", true);
            loadDanceSets().then(() => {
              stackRegistry.modelStack?.pop();
              const rootIdx = stackRegistry.modelStack?.levelCount ? stackRegistry.modelStack.levelCount - 1 : 0;
              if (stackRegistry.modelStack && rootIdx >= 0) {
                stackRegistry.modelStack.setLevel(rootIdx, buildDanceSetsOverviewLevel());
                stackRegistry.modelStack.reRender();
              }
            });
          }).catch((err) => {
            console.warn("DeleteDanceSet failed:", err);
            setStatus("✗ 删除失败", false);
          });
        }
      });
      container.appendChild(deleteBtn);
    },
  };
}

async function loadDanceSet(ds: DanceSet): Promise<void> {
  if (!focusedModelId) {
    setStatus("✗ 请先加载并聚焦一个模型", false);
    return;
  }
  hideMotionPopup();
  await Promise.all([
    loadVMDFromPath(ds.vmd_path, focusedModelId),
    loadDanceSetAudio(ds),
  ]);
  setStatus(`✓ 已加载舞蹈套装: ${ds.name}`, true);
}

async function createNewDanceSet(): Promise<void> {
  try {
    const vmdPath = await SelectVMDMotion();
    if (!vmdPath) return;

    const audioPath = await SelectAudioFile().catch(() => "");

    const defaultName = vmdPath.split(/[\\/]/).pop()?.replace(/\.vmd$/i, "") || "";
    const name = prompt("请输入舞蹈套装名称：", defaultName);
    if (!name) return;

    const setId = await ImportDanceSet(vmdPath, audioPath, name);
    if (setId) {
      setStatus("✓ 已创建舞蹈套装", true);
      await loadDanceSets();
      const rootIdx = stackRegistry.modelStack?.levelCount ? stackRegistry.modelStack.levelCount - 1 : 0;
      if (stackRegistry.modelStack && rootIdx >= 0) {
        stackRegistry.modelStack.setLevel(rootIdx, buildDanceSetsOverviewLevel());
        stackRegistry.modelStack.reRender();
      }
    }
  } catch (err) {
    console.warn("createNewDanceSet failed:", err);
    setStatus("✗ 创建失败", false);
  }
}
