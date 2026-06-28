# 模型加载预设 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to save and load a single model's complete state (transform, visibility, VMD, material parameters, audio) as a `.mcupreset.json` file — a lightweight "character card" that excludes camera/lighting/scene-level data.

**Architecture:** Reuses the scene serialization's `ModelState` data shape. Adds two Go bindings for file I/O (`SaveModelPreset`/`LoadModelPreset`) with dedicated file dialogs. UI added as two new action rows in the existing model detail submenu (`buildModelDetailLevel` in `library.ts`). Frontend serialization/deserialization logic in `library.ts` calls existing state getters/setters from `scene.ts` and `audio.ts`.

**Tech Stack:** Wails Go backend, TypeScript frontend (existing `library.ts`/`scene.ts`/`audio.ts`), `.mcupreset.json` file format.

---

## 前置修复：三个已知坑

### 坑一：MMD 模型是多 mesh，transform 应走 rootMesh 而非 meshes[0]

MikuMikuAR 的 `ModelInstance.meshes` 是 `MmdModel.getMeshes()` 返回的数组（Body / 髪 / スカート…十几个），`meshes[0]` 的 position 是相对 rootMesh 的 offset。MMD 的 transform（position/scaling/rotationY）实际挂在 `MmdModel.rootMesh` 上。

**修复**：给 `ModelInstance` 加 `rootMesh: Mesh` 字段，PMX 加载时赋值。serialize/apply 全走 `rootMesh`。

### 坑二：MaterialCategory 是 string union，反序列化需 as 强制类型

`MaterialCategory = typeof CATEGORIES[number]`（`"皮肤" | "头发" | "眼睛" | "服装"`），`Object.entries()` 返回 `[string, T]`。

**修复**：`applyMatState` 中加 `as MaterialCategory` cast。

### 坑三：不存在 stopVMD()，应提取而非手写清理

`setRuntimeAnimation(null)` 不 dispose 旧 animation 对象，留 ghost。

**修复**：在 `scene.ts` 中提取 `export function stopVMD(id)` 函数。

---

## File Structure

| File | What changes |
|------|-------------|
| `MikuMikuAR/app.go` | +4 Go bindings: `SaveModelPreset`, `LoadModelPreset`, `SelectPresetSaveFile`, `SelectPresetOpenFile` |
| `MikuMikuAR/frontend/src/config.ts` | +`rootMesh: Mesh` 字段到 `ModelInstance` |
| `MikuMikuAR/frontend/src/scene.ts` | +`rootMesh` 赋值 + `stopVMD()` + `getMatState()` + `applyMatState()`(含 cast) |
| `MikuMikuAR/frontend/src/library.ts` | +`serializeModelPreset()`, `applyModelPreset()`, `selectAndSavePreset()`, `selectAndLoadPreset()`; modify `buildModelDetailLevel()` to add preset rows; modify `onItemClick` to handle preset actions; add import lines |
| `MikuMikuAR/frontend/src/audio.ts` | Verify all needed getters are exported |

---

### Task 1: Add Go bindings for preset file I/O

**Files:**
- Modify: `MikuMikuAR/app.go`

- [ ] **Step 1: Add `SaveModelPreset` and `LoadModelPreset` bindings**

Add after the existing `SaveSceneFile`/`LoadSceneFile` block (around line 1175 in `app.go`):

```go
// SaveModelPreset writes a JSON model preset file to the given path.
func (a *App) SaveModelPreset(jsonStr string, path string) error {
	return os.WriteFile(path, []byte(jsonStr), 0644)
}

// LoadModelPreset reads a JSON model preset file from the given path.
func (a *App) LoadModelPreset(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
```

- [ ] **Step 2: Add `SelectPresetSaveFile` and `SelectPresetOpenFile` dialogs**

Add after the `SaveModelPreset`/`LoadModelPreset` bindings:

```go
// SelectPresetSaveFile opens a save dialog for model preset files.
func (a *App) SelectPresetSaveFile() (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存模型预设",
		DefaultFilename: "preset.mcupreset.json",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "MikuMikuAR Model Preset (*.mcupreset.json)",
				Pattern:     "*.mcupreset.json",
			},
			{
				DisplayName: "All Files (*.*)",
				Pattern:     "*.*",
			},
		},
	})
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

// SelectPresetOpenFile opens a file dialog to pick a model preset file.
func (a *App) SelectPresetOpenFile() (string, error) {
	return a.openFileDialog("加载模型预设", []runtime.FileFilter{
		{
			DisplayName: "MikuMikuAR Model Preset (*.mcupreset.json)",
			Pattern:     "*.mcupreset.json",
		},
		{
			DisplayName: "All Files (*.*)",
			Pattern:     "*.*",
		},
	})
}
```

- [ ] **Step 3: Build and verify**

```bash
cd MikuMikuAR && go build ./...
```
Expected: `go build` succeeds with no errors.

---

### Task 2: Add rootMesh + stopVMD + material state to scene.ts

**Files:**
- Modify: `MikuMikuAR/frontend/src/config.ts`
- Modify: `MikuMikuAR/frontend/src/scene.ts`

- [ ] **Step 1 (坑一): Add `rootMesh` field to `ModelInstance` in config.ts**

In `config.ts`, add `rootMesh: Mesh;` after `meshes: Mesh[];`:

```typescript
export type ModelInstance = {
    id: string;
    name: string;
    filePath: string;
    port: number;
    modelDir: string;
    meshes: Mesh[];
    rootMesh: Mesh;           // ← ADD: first mesh from ImportMeshAsync, serves as transform root
    mmdModel?: MmdWasmModel;
    vmdData: ArrayBuffer | null;
    vmdName: string;
    vmdPath: string | null;
    animationDuration: number;
    kind: ModelKind;
    visible: boolean;
    opacity: number;
    wireframe: boolean;
    scaling: number;
    rotationY: number;
};
```

- [ ] **Step 2 (坑一): Store `rootMesh` during PMX loading**

In `scene.ts` `loadPMXFile`, around line 367 after `inst.mmdModel = wasmModel;`:

```typescript
inst.rootMesh = rootMesh;
```

- [ ] **Step 3 (坑三): Add `stopVMD()` function**

```typescript
/** Stop VMD animation on a model and clean up state.
 *  Always use this instead of manual setRuntimeAnimation(null).
 */
export function stopVMD(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    if (inst.mmdModel && mmdRuntime) {
        inst.mmdModel.setRuntimeAnimation(null);
        mmdRuntime.stopAnimation();
    }
    inst.vmdData = null;
    inst.vmdName = "";
    inst.vmdPath = null;
    inst.animationDuration = 0;
    if (isPlaying) {
        mmdRuntime?.pauseAnimation();
        setIsPlaying(false);
    }
    updatePlaybackUI();
    triggerAutoSave();
}
```

- [ ] **Step 4: Add `getMatState()` function**

```typescript
/** Get the full material state (categories + per-material overrides) for a model.
 *  Returns null if no material adjustments have been made.
 *  Used for preset serialization.
 */
export function getMatState(id: string): {
    categories: Record<string, MaterialCategoryParams>;
    overrides: Record<number, MaterialCategoryParams>;
} | null {
    const catState = _catState.get(id);
    const matState = _matState.get(id);
    if (!catState && !matState) return null;
    const categories: Record<string, MaterialCategoryParams> = {};
    if (catState) {
        for (const [cat, params] of catState) {
            categories[cat] = { ...params };
        }
    }
    const overrides: Record<number, MaterialCategoryParams> = {};
    if (matState) {
        for (const [idx, params] of matState) {
            overrides[idx] = { ...params };
        }
    }
    return { categories, overrides };
}
```

- [ ] **Step 5 (坑二): Add `applyMatState()` function with `as MaterialCategory` cast**

```typescript
/** Apply a previously saved material state to a model.
 *  ⚠ MaterialCategory is a string union ("皮肤"|"头发"|"眼睛"|"服装"),
 *    so Object.entries() yields [string, T] — need `as MaterialCategory`.
 */
export function applyMatState(id: string, state: {
    categories?: Record<string, MaterialCategoryParams>;
    overrides?: Record<number, MaterialCategoryParams>;
}): void {
    if (state.categories) {
        for (const [cat, params] of Object.entries(state.categories)) {
            setMatCatParams(id, cat as MaterialCategory, params);
        }
    }
    if (state.overrides) {
        for (const [idxStr, params] of Object.entries(state.overrides)) {
            const idx = parseInt(idxStr, 10);
            setMatParams(id, idx, params);
        }
    }
}
```

- [ ] **Step 6: Build to verify**

```bash
cd MikuMikuAR/frontend && npx vite build 2>&1
```
Expected: build succeeds with no TypeScript errors.

---

### Task 3: Add preset logic and UI to library.ts

- [ ] **Step 1: Add Go binding imports**

Add these to the existing import block (around line 36):

```typescript
import {
  // ... existing imports ...
  SaveModelPreset,
  LoadModelPreset,
  SelectPresetSaveFile,
  SelectPresetOpenFile,
} from "../wailsjs/go/main/App";
```

- [ ] **Step 2: Add function imports from scene.ts and audio.ts**

Add to the import from `./scene` (around line 96):

```typescript
import {
  // ... existing imports ...
  getMatState,
  applyMatState,
  stopVMD,
  MaterialCategory,
} from "./scene";
```

Add to the import from `./audio` (around line 98):

```typescript
import { loadAudioFile, setVolume, setAudioOffset, getAudioPath, getAudioName, getVolume, getAudioOffset, isAudioPlaying } from "./audio";
```

- [ ] **Step 3: Add `ModelPresetFile` type**

Place near the top of the file (after imports):

```typescript
/** Shape of a .mcupreset.json file — single-model state snapshot. */
interface ModelPresetFile {
  version: 1;
  model: {
    filePath: string;
    libraryRef?: string;
    name: string;
    kind: "actor" | "stage";
  };
  transform: {
    positionX: number;
    positionY?: number;
    positionZ?: number;
    scaling?: number;
    rotationY?: number;
  };
  visibility: {
    visible?: boolean;
    opacity?: number;
    wireframe?: boolean;
  };
  vmd: {
    path: string | null;
    libraryRef?: string | undefined;
    name: string;
  };
  audio?: {
    path: string;
    name: string;
    volume: number;
    offset: number;
  };
  materialCategories?: Record<string, MaterialCategoryParams>;
  materialOverrides?: Record<number, MaterialCategoryParams>;
}
```

Also add the import for `MaterialCategoryParams`:

```typescript
import type { MaterialCategoryParams } from "./scene";
```

- [ ] **Step 4 (坑一): Add `serializeModelPreset()` — use rootMesh + cached scaling/rotationY**

```typescript
/** Serialize a model instance's state into a preset JSON string. */
function serializeModelPreset(id: string): string {
  const inst = modelRegistry.get(id);
  if (!inst) return "";
  const matState = getMatState(id);
  const rm = inst.rootMesh;
  const preset: ModelPresetFile = {
    version: 1,
    model: {
      filePath: inst.filePath,
      libraryRef: computeLibraryRef(inst.filePath) || undefined,
      name: inst.name,
      kind: inst.kind,
    },
    transform: {
      // rootMesh is the authoritative transform root for MMD models
      positionX: rm?.position.x ?? 0,
      positionY: rm?.position.y ?? 0,
      positionZ: rm?.position.z ?? 0,
      scaling: inst.scaling,
      rotationY: inst.rotationY,
    },
    visibility: {
      visible: inst.visible,
      opacity: inst.opacity,
      wireframe: inst.wireframe,
    },
    vmd: {
      path: inst.vmdPath,
      libraryRef: inst.vmdPath ? (computeLibraryRef(inst.vmdPath) || undefined) : undefined,
      name: inst.vmdName,
    },
    audio: getAudioPath() ? {
      path: getAudioPath(),
      name: getAudioName(),
      volume: getVolume(),
      offset: getAudioOffset(),
    } : undefined,
    materialCategories: matState?.categories,
    materialOverrides: matState?.overrides,
  };
  return JSON.stringify(preset, null, 2);
}
```

- [ ] **Step 5 (坑一+坑三): Add `applyModelPreset()` — use rootMesh + reuse stopVMD()**

```typescript
/** Apply a preset JSON to the specified model instance. */
async function applyModelPreset(id: string, jsonStr: string): Promise<void> {
  let preset: ModelPresetFile;
  try {
    preset = JSON.parse(jsonStr);
  } catch {
    setStatus("✗ 预设文件格式错误", false);
    return;
  }
  if (preset.version !== 1) {
    setStatus("✗ 不支持的预设版本", false);
    return;
  }
  const inst = modelRegistry.get(id);
  if (!inst) {
    setStatus("✗ 目标模型不存在", false);
    return;
  }

  // Apply transform — always use rootMesh for MMD transform
  if (preset.transform) {
    const t = preset.transform;
    const rm = inst.rootMesh;
    if (rm) {
      rm.position.x = t.positionX ?? 0;
      rm.position.y = t.positionY ?? 0;
      rm.position.z = t.positionZ ?? 0;
    }
    inst.scaling = t.scaling ?? 1;
    inst.rotationY = t.rotationY ?? 0;
    if (rm) {
      rm.scaling.setAll(inst.scaling);
      rm.rotation.y = inst.rotationY;
    }
  }

  // Apply visibility
  if (preset.visibility) {
    const v = preset.visibility;
    inst.visible = v.visible ?? true;
    inst.opacity = v.opacity ?? 1.0;
    inst.wireframe = v.wireframe ?? false;
    if (!inst.visible) {
      for (const mesh of inst.meshes) mesh.setEnabled(false);
    } else {
      for (const mesh of inst.meshes) mesh.setEnabled(true);
    }
    if (inst.opacity < 1.0 || inst.wireframe) {
      for (const mesh of inst.meshes) {
        if (mesh.material) {
          mesh.material.alpha = inst.opacity;
          if (mesh.material instanceof StandardMaterial) {
            mesh.material.wireframe = inst.wireframe;
          }
        }
      }
    }
  }

  // Apply VMD — reuse stopVMD() for clean cleanup
  if (preset.vmd && preset.vmd.path) {
    try {
      const resolvedVmdPath = preset.vmd.libraryRef
        ? (resolveLibraryRef(preset.vmd.libraryRef) || preset.vmd.path)
        : preset.vmd.path;
      await loadVMDFromPath(resolvedVmdPath, id);
    } catch (err) {
      console.warn("Preset VMD load failed:", err);
    }
  } else {
    // Clear VMD via proper cleanup instead of manual setRuntimeAnimation(null)
    stopVMD(id);
  }

  // Apply material state
  if (preset.materialCategories || preset.materialOverrides) {
    applyMatState(id, {
      categories: preset.materialCategories,
      overrides: preset.materialOverrides,
    });
  }

  // Apply audio — loadAudioFile stops previous audio internally
  if (preset.audio && preset.audio.path) {
    try {
      await loadAudioFile(preset.audio.path);
      setVolume(preset.audio.volume ?? 1);
      setAudioOffset(preset.audio.offset ?? 0);
    } catch (err) {
      console.warn("Preset audio load failed:", err);
    }
  }

  updatePlaybackUI();
  triggerAutoSave();
  setStatus(`✓ 已应用预设: ${preset.model.name}`, true);
}
```

- [ ] **Step 6: Add `selectAndSavePreset` and `selectAndLoadPreset` wrappers**

```typescript
/** Open save dialog → serialize model state → write preset file. */
async function selectAndSavePreset(id: string): Promise<void> {
  const path = await SelectPresetSaveFile();
  if (!path) return;
  const json = serializeModelPreset(id);
  if (!json) {
    setStatus("✗ 无法序列化模型状态", false);
    return;
  }
  try {
    await SaveModelPreset(json, path);
    setStatus("✓ 预设已保存", true);
  } catch (err: any) {
    setStatus("✗ 保存失败: " + (err.message || err), false);
  }
}

/** Open file dialog → read preset file → apply to model. */
async function selectAndLoadPreset(id: string): Promise<void> {
  const path = await SelectPresetOpenFile();
  if (!path) return;
  try {
    const json = await LoadModelPreset(path);
    await applyModelPreset(id, json);
  } catch (err: any) {
    setStatus("✗ 加载失败: " + (err.message || err), false);
  }
}
```

- [ ] **Step 7: Add preset rows to `buildModelDetailLevel()`**

Add two new action rows after the "移除" divider:

```typescript
      { kind: "action", label: "保存预设", icon: "save", target: `detail:preset-save:${id}`, sublabel: "保存模型状态到预设文件" },
      { kind: "action", label: "加载预设", icon: "folder-open", target: `detail:preset-load:${id}`, sublabel: "从预设文件恢复模型状态" },
```

- [ ] **Step 8: Add preset action handling to `onItemClick`**

```typescript
          case "preset-save":
            selectAndSavePreset(id);
            break;
          case "preset-load":
            selectAndLoadPreset(id);
            break;
```

- [ ] **Step 9: Add hover hints**

```typescript
        "detail:preset-save": "将模型当前的变换/材质/VMD状态保存为预设文件",
        "detail:preset-load": "从预设文件恢复模型的变换/材质/VMD状态",
```

- [ ] **Step 10: Build to verify**

```bash
cd MikuMikuAR/frontend && npx vite build 2>&1
```
Expected: build succeeds with no TypeScript errors.

---

## Self-Review

### 1. Spec Coverage

| Spec requirement | Covered by |
|-----------------|-----------|
| 数据结构复用场景的 ModelState | Task 3 Step 4 — `serializeModelPreset()` reuses same fields as `SceneFile.models[0]` |
| 新增 SaveModelPreset/LoadModelPreset Go binding | Task 1 Step 1 |
| UI 入口：模型详情 → 保存预设 / 加载预设 | Task 3 Step 7 |
| 预设文件存 .mcupreset.json 后缀 | Task 1 Step 2 |
| 变换+材质参数+VMD+音频状态 | Task 3 Step 4 |
| 坑一：rootMesh 修复 | Task 2 Step 1+2 (config.ts/scene.ts), Task 3 Step 4+5 |
| 坑二：MaterialCategory cast | Task 2 Step 5 |
| 坑三：stopVMD 提取 | Task 2 Step 3, Task 3 Step 5 |

### 2. Placeholder Scan
No placeholders.

### 3. Type Consistency
- `ModelPresetFile` uses same fields as `SceneFile.models[0]`
- `MaterialCategoryParams` imported from `scene.ts`
- Go bindings follow `SaveSceneFile`/`LoadSceneFile` pattern
- `rootMesh: Mesh` matches Babylon.js `Mesh` type
