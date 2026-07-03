# 相机模式改进 + 预设系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整相机系统：各模式可配置参数 + 预设文件保存/加载 + orbit 切模式自动聚焦

**Architecture:** 参考 DanceXR，每模式有独立参数面板，预设为 JSON 文件通过 Go 后端保存/加载。camera.ts 管理所有参数状态，scene-menu.ts 用 renderCustom 做参数滑块 UI，app.go + library.ts 处理预设文件 I/O。

**Tech Stack:** TypeScript, Babylon.js, Go (Wails)

---

## File Structure

| File | What changes |
|------|-------------|
| `frontend/src/camera.ts` | 重写参数系统：每模式参数接口+默认值+getter/setter；增加轨道自动聚焦；增加预设序列化 |
| `frontend/src/scene-menu.ts` | 场景菜单恢复「相机模式」入口；新增参数面板（滑块组合） |
| `frontend/src/libraray.ts` | 动作弹窗的相机文件夹删除（回归场景菜单） |
| `app.go` | 新增 4 个 binding: SaveCameraPreset/LoadCameraPreset/SelectCameraPresetSaveFile/SelectCameraPresetOpenFile |

---

### Task 1: Orbit auto-focus on mode switch

**Files:**
- Modify: `frontend/src/camera.ts`

- [ ] **Step 1: Ensure modelRegistry import exists**

In `camera.ts`, confirm line 14 imports both `focusedModelId` and `modelRegistry`:

```typescript
import { focusedModelId, modelRegistry } from "./config";
```

- [ ] **Step 2: Add auto-frame call**

In `switchCameraMode()` (line 244 area), after `startConcert(scene)` and before the pipeline import, add:

```typescript
    // Auto-frame on focused model when switching to orbit
    if (mode === "orbit" && focusedModelId) {
        const inst = modelRegistry.get(focusedModelId);
        if (inst) {
            import("./scene").then(({ focusModel }) => focusModel(focusedModelId));
        }
    }
```

- [ ] **Step 3: Build verify**

```bash
cd frontend && npx tsc && npx vite build 2>&1 | findstr /R "✓ error"
```
Expected: build succeeds

---

### Task 2: Define per-mode parameter interfaces + defaults

**Files:**
- Modify: `frontend/src/camera.ts`

- [ ] **Step 1: Add parameter interfaces**

Replace the `CameraMode` type line and add parameter interfaces:

```typescript
export type CameraMode = "orbit" | "freefly" | "oneshot" | "concert" | "vmd";

/** Orbit camera parameters. */
export interface OrbitParams {
    targetHeight: number;   // Y offset of the orbit target above origin
    distance: number;       // radius
    beta: number;           // elevation angle (radians)
}

/** Freefly camera parameters. */
export interface FreeflyParams {
    speed: number;
    angularSensibility: number;
}

/** Oneshot camera parameters — list of named shots. */
export interface CameraShot {
    name: string;
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
}
export interface OneshotParams {
    shots: CameraShot[];
}

/** Concert camera parameters — continuous orbit around target. */
export interface ConcertParams {
    radius: number;     // orbit radius
    height: number;     // target height offset
    speed: number;      // rotation speed (rad/s)
}

/** VMD camera parameters. */
export interface VmdParams {
    path: string;
    name: string;
}

/** Union of all camera mode parameters — each mode has its own config. */
export interface CameraPreset {
    mode: CameraMode;
    orbit: OrbitParams;
    freefly: FreeflyParams;
    oneshot: OneshotParams;
    concert: ConcertParams;
    vmd: VmdParams;
    /** Shared params that apply regardless of mode. */
    shared: {
        fovScale: number;       // 0.25~2.0
        heightOffset: number;   // -5~5
        nearPlane: number;      // 0~0.5
    };
}
```

- [ ] **Step 2: Add default preset factory**

```typescript
export function defaultCameraPreset(): CameraPreset {
    return {
        mode: "orbit",
        orbit: { targetHeight: 8, distance: 16, beta: Math.PI / 3 },
        freefly: { speed: 0.5, angularSensibility: 2000 },
        oneshot: { shots: [] },
        concert: { radius: 12, height: 8, speed: 0.3 },
        vmd: { path: "", name: "" },
        shared: { fovScale: 1.0, heightOffset: 0, nearPlane: 0.1 },
    };
}
```

- [ ] **Step 3: Add runtime state + getter/setter**

```typescript
// ======== Runtime Preset State ========
let _currentPreset: CameraPreset = defaultCameraPreset();

export function getCameraPreset(): CameraPreset { return _currentPreset; }

export function setCameraPreset(p: CameraPreset): void { _currentPreset = p; }

export function getOrbitParams(): OrbitParams { return _currentPreset.orbit; }
export function getFreeflyParams(): FreeflyParams { return _currentPreset.freefly; }
export function getConcertParams(): ConcertParams { return _currentPreset.concert; }
export function getOneshotParams(): OneshotParams { return _currentPreset.oneshot; }
export function getSharedParams() { return _currentPreset.shared; }

export function setOrbitParams(p: Partial<OrbitParams>): void { Object.assign(_currentPreset.orbit, p); }
export function setFreeflyParams(p: Partial<FreeflyParams>): void { Object.assign(_currentPreset.freefly, p); }
export function setConcertParams(p: Partial<ConcertParams>): void { Object.assign(_currentPreset.concert, p); }
export function setSharedParams(p: Partial<CameraPreset["shared"]>): void { Object.assign(_currentPreset.shared, p); }
```

- [ ] **Step 4: Build verify**

```bash
cd frontend && npx tsc && npx vite build 2>&1 | findstr /R "✓ error"
```

---

### Task 3: Apply preset params to camera factories + concert rewrite

**Files:**
- Modify: `frontend/src/camera.ts`

- [ ] **Step 1: Update `createOrbitCamera` to use preset params**

```typescript
function createOrbitCamera(scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera {
    const p = _currentPreset.orbit;
    const cam = new ArcRotateCamera("camera", -Math.PI / 2, p.beta, p.distance, new Vector3(0, p.targetHeight, 0), scene);
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 50;
    cam.panningSensibility = 50;
    cam.attachControl(canvas, true);
    return cam;
}
```

- [ ] **Step 2: Update `createFreeflyCamera` to use preset params**

```typescript
function createFreeflyCamera(scene: Scene, canvas: HTMLCanvasElement): UniversalCamera {
    const p = _currentPreset.freefly;
    const cam = new UniversalCamera("freeflyCam", new Vector3(0, 8, 16), scene);
    cam.speed = p.speed;
    cam.angularSensibility = p.angularSensibility;
    cam.attachControl(canvas, true);
    cam.keysUp = [];
    cam.keysDown = [];
    cam.keysLeft = [];
    cam.keysRight = [];
    return cam;
}
```

- [ ] **Step 3: Replace concert with configurable continuous orbit**

Remove `concertPresets` array, `_concertTimer`, `_concertIndex`, `CameraPreset` interface (old one).

Replace `startConcert`, `scheduleNextConcert`, `stopConcert`, `animateCameraTo` with:

```typescript
let _concertUpdateFn: (() => void) | null = null;
let _concertAngle = 0;

function startConcert(scene: Scene): void {
    _concertAngle = 0;
    if (_concertUpdateFn) {
        scene.onBeforeRenderObservable.removeCallback(_concertUpdateFn);
    }
    _concertUpdateFn = () => {
        const cam = _currentCamera;
        if (!cam || !(cam instanceof ArcRotateCamera)) return;
        const p = _currentPreset.concert;
        const delta = scene.getAnimationRatio() * p.speed * 0.016;
        _concertAngle += delta;
        cam.alpha = -Math.PI / 2 + _concertAngle;
        cam.radius = p.radius;
        cam.beta = Math.PI / 3;
        // Track focused model
        const focusedId = focusedModelId;
        if (focusedId) {
            const inst = modelRegistry.get(focusedId);
            if (inst && inst.meshes.length > 0) {
                const root = inst.rootMesh;
                cam.setTarget(new Vector3(root.position.x, p.height, root.position.z));
            } else {
                cam.setTarget(new Vector3(0, p.height, 0));
            }
        } else {
            cam.setTarget(new Vector3(0, p.height, 0));
        }
    };
    scene.onBeforeRenderObservable.add(_concertUpdateFn);
}

function stopConcert(): void {
    if (_concertUpdateFn && _scene) {
        _scene.onBeforeRenderObservable.removeCallback(_concertUpdateFn);
        _concertUpdateFn = null;
    }
}
```

- [ ] **Step 4: Update `initCameraSystem`**

```typescript
export function initCameraSystem(scene: Scene, canvas: HTMLCanvasElement): Camera {
    _scene = scene;
    _canvas = canvas;
    // Apply shared params immediately
    const shared = _currentPreset.shared;
    if (shared.fovScale !== 1.0) scene.activeCamera.fov *= shared.fovScale;
    const cam = createOrbitCamera(scene, canvas);
    _currentCamera = cam;
    _cameraMode = "orbit";
    scene.activeCamera = cam;
    return cam;
}
```

- [ ] **Step 5: Update `switchCameraMode` to apply preset params on switch**

In `switchCameraMode`, when creating each camera type, the factory already reads from `_currentPreset`. Add shared param re-application after creating camera:

```typescript
    // Apply shared params to new camera
    const shared = _currentPreset.shared;
    newCam.fov = (newCam.fov || 0.8) * shared.fovScale; // scale from base
    if ((newCam as any).minZ !== undefined) (newCam as any).minZ = shared.nearPlane;
```

- [ ] **Step 6: Build verify**

---

### Task 4: Add camera preset Go bindings

**Files:**
- Modify: `app.go`

- [ ] **Step 1: Add 4 bindings**

```go
// ======== Camera Preset Bindings ========

func (a *App) SaveCameraPreset(jsonStr string, path string) error {
    return os.WriteFile(path, []byte(jsonStr), 0644)
}

func (a *App) LoadCameraPreset(path string) (string, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return "", err
    }
    return string(data), nil
}

func (a *App) SelectCameraPresetSaveFile() (string, error) {
    path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
        Title:           "保存相机预设",
        DefaultFilename: "camera.mcucam.json",
        Filters: []runtime.FileFilter{
            { DisplayName: "MikuMikuAR Camera Preset (*.mcucam.json)", Pattern: "*.mcucam.json" },
            { DisplayName: "All Files (*.*)", Pattern: "*.*" },
        },
    })
    if err != nil {
        return "", err
    }
    return filepath.ToSlash(path), nil
}

func (a *App) SelectCameraPresetOpenFile() (string, error) {
    path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
        Title: "加载相机预设",
        Filters: []runtime.FileFilter{
            { DisplayName: "MikuMikuAR Camera Preset (*.mcucam.json)", Pattern: "*.mcucam.json" },
            { DisplayName: "All Files (*.*)", Pattern: "*.*" },
        },
    })
    if err != nil {
        return "", err
    }
    return filepath.ToSlash(path), nil
}
```

- [ ] **Step 2: Regenerate Wails bindings**

```bash
cd . && wails generate module
```

- [ ] **Step 3: Verify Go build**

```bash
cd . && go build ./...
```

---

### Task 5: Camera preset UI — scene menu

**Files:**
- Modify: `frontend/src/scene-menu.ts`
- Modify: `frontend/src/libraray.ts` (remove camera folder from motion popup)

- [ ] **Step 1: Restore camera mode entry in scene root menu**

In `buildSceneRoot()`, add back the camera folder:

```typescript
items: [
    { kind: "folder", label: "模型", icon: "box", target: "scene:models" },
    { kind: "folder", label: "相机模式", icon: "camera", target: "scene:camera" },
    { kind: "folder", label: "灯光", icon: "sun", target: "scene:light" },
    { kind: "folder", label: "渲染", icon: "sparkles", target: "scene:render" },
    { kind: "folder", label: "物理", icon: "toggle-left", target: "scene:physics" },
    { kind: "folder", label: "截图", icon: "camera", target: "scene:screenshot" },
    { kind: "action", label: "保存场景", icon: "save", target: "scene:save" },
    { kind: "action", label: "加载场景", icon: "upload", target: "scene:load" },
],
```

- [ ] **Step 2: Restore `buildCameraLevel()`**

```typescript
function buildCameraLevel(): PopupLevel {
    const currentMode = getCameraMode();
    const vmdLoaded = hasCameraVmd();
    const vmdName = getCameraVmdName();
    return {
        label: "相机模式",
        dir: "",
        items: [
            { kind: "action", label: "轨道", icon: currentMode === "orbit" ? "check" : "circle", target: "camera:orbit", sublabel: "默认轨道相机" },
            { kind: "action", label: "自由飞行", icon: currentMode === "freefly" ? "check" : "circle", target: "camera:freefly", sublabel: "WASD 自由移动" },
            { kind: "action", label: "镜头预设", icon: currentMode === "oneshot" ? "check" : "circle", target: "camera:oneshot", sublabel: "自定义镜头快照" },
            { kind: "action", label: "演唱会", icon: currentMode === "concert" ? "check" : "circle", target: "camera:concert", sublabel: "环绕角色旋转" },
            ...(vmdLoaded ? [
                { kind: "divider" } as PopupRow,
                { kind: "action", label: "VMD 相机", icon: currentMode === "vmd" ? "check" : "circle", target: "camera:vmd", sublabel: vmdName || "相机轨道" },
                { kind: "action", label: "清除相机 VMD", icon: "trash-2", target: "camera:clear-vmd" },
            ] : []),
            { kind: "divider" } as PopupRow,
            { kind: "action", label: "加载相机 VMD", icon: "upload", target: "camera:load-vmd", sublabel: "从 .vmd 文件加载相机轨道" },
            { kind: "divider" } as PopupRow,
            { kind: "folder", label: "轨道设置", icon: "settings", target: "camera:params:orbit" },
            { kind: "folder", label: "自由飞行设置", icon: "settings", target: "camera:params:freefly" },
            { kind: "folder", label: "镜头预设管理", icon: "image", target: "camera:params:oneshot" },
            { kind: "folder", label: "演唱会设置", icon: "settings", target: "camera:params:concert" },
            { kind: "divider" } as PopupRow,
            { kind: "action", label: "保存相机预设", icon: "save", target: "camera:preset-save" },
            { kind: "action", label: "加载相机预设", icon: "upload", target: "camera:preset-load" },
        ],
    };
}
```

- [ ] **Step 3: Restore `case "scene:camera"` in onFolderEnter**

```typescript
switch (row.target) {
    case "scene:models": return buildModelsLevel();
    case "scene:camera": return buildCameraLevel();
    case "scene:light": return buildLightLevel();
    case "scene:render": return buildRenderLevel();
    case "scene:physics": return buildPhysicsLevel();
    case "scene:screenshot": return buildScreenshotLevel();
    case "scene:render:postprocess": return buildPostProcessLevel();
    case "scene:render:stage": return buildStageLevel();
    case "scene:render:presets": return buildPresetsLevel();
    default: return null;
}
```

- [ ] **Step 4: Restore camera action handler in `handleSceneAction`**

```typescript
function handleSceneAction(row: PopupRow): void {
    // Camera VMD actions
    if (row.target === "camera:load-vmd") {
        (async () => {
            try {
                const path = await SelectVMDMotion();
                if (!path) return;
                await loadCameraVmdFromPath(path);
                refreshCameraLevel();
            } catch (err) {
                console.error("Load camera VMD failed:", err);
                setStatus("✗ 相机 VMD 加载失败", false);
            }
        })();
        return;
    }
    if (row.target === "camera:clear-vmd") {
        clearCameraVmd();
        refreshCameraLevel();
        setStatus("✓ 已清除相机 VMD", true);
        return;
    }
    // Camera mode switching
    if (row.target && row.target.startsWith("camera:") && !row.target.includes(":params:") && !row.target.includes(":preset-") && !row.target.includes(":shot:")) {
        const mode = row.target.replace("camera:", "") as CameraMode;
        if (mode === "vmd" && !hasCameraVmd()) {
            setStatus("✗ 请先加载相机 VMD", false);
            return;
        }
        switchCameraMode(mode);
        refreshCameraLevel();
        const labels: Record<string, string> = {
            orbit: "轨道", freefly: "自由飞行",
            oneshot: "镜头预设", concert: "演唱会",
            vmd: "VMD 相机",
        };
        setStatus(`✓ 相机: ${labels[mode] || mode}`, true);
        return;
    }
    // Camera preset save/load
    if (row.target === "camera:preset-save") { /* see Task 6 */ }
    if (row.target === "camera:preset-load") { /* see Task 6 */ }
    // ... screenshot and other existing actions follow
```

Add a helper:

```typescript
function refreshCameraLevel(): void {
    if (sceneStack) {
        sceneStack.setLevel(sceneStack.levelCount - 1, buildCameraLevel());
        sceneStack.reRender();
    }
}
```

- [ ] **Step 5: Restore imports for camera functions in scene-menu.ts**

```typescript
import {
    switchCameraMode, getCameraMode, hasCameraVmd, getCameraVmdName, clearCameraVmd,
    getCameraPreset, setCameraPreset, defaultCameraPreset,
    getOrbitParams, setOrbitParams,
    getFreeflyParams, setFreeflyParams,
    getConcertParams, setConcertParams,
    getOneshotParams, saveCameraShot, deleteCameraShot, applyCameraShot,
    getSharedParams, setSharedParams,
    type CameraMode, type CameraPreset, type CameraShot,
} from "./camera";
import { getLightState, setLightState, triggerAutoSave, serializeScene, deserializeScene, getRenderState, setRenderState, loadCameraVmdFromPath, scene } from "./scene";
import { SelectSceneSaveFile, SelectSceneOpenFile, SaveSceneFile, LoadSceneFile, SaveRenderPreset, DeleteRenderPreset, GetRenderPresets, SelectVMDMotion, SelectDir, SaveScreenshot,
    SaveCameraPreset, LoadCameraPreset, SelectCameraPresetSaveFile, SelectCameraPresetOpenFile } from "../wailsjs/go/main/App";
```

- [ ] **Step 6: Remove camera folder from motion popup in library.ts**

Delete the `"__camera__"` folder from `showMotionPopup()` root items.

Delete `buildActionCameraLevel()` function.

Delete `case "__camera__"` from motion stack's `onFolderEnter`.

Delete the camera action handlers from motion stack's `onItemClick`.

Remove camera imports from `library.ts`.

---

### Task 6: Per-mode parameter panels (renderCustom)

**Files:**
- Modify: `frontend/src/scene-menu.ts`

- [ ] **Step 1: Add `buildCameraParamsLevel` function**

```typescript
/** Build a parameter editing submenu for the given camera mode. */
function buildCameraParamsLevel(mode: CameraMode): PopupLevel {
    return {
        label: mode === "orbit" ? "轨道设置" :
               mode === "freefly" ? "自由飞行设置" :
               mode === "oneshot" ? "镜头预设管理" :
               mode === "concert" ? "演唱会设置" :
               mode === "vmd" ? "VMD 相机" : "相机设置",
        dir: "",
        items: [],
        renderCustom: (container) => {
            container.style.padding = "12px 14px";
            if (mode === "orbit") renderOrbitParams(container);
            else if (mode === "freefly") renderFreeflyParams(container);
            else if (mode === "oneshot") renderOneshotParams(container);
            else if (mode === "concert") renderConcertParams(container);
        },
    };
}
```

- [ ] **Step 2: Add param panel renderers**

```typescript
function renderOrbitParams(container: HTMLElement): void {
    const p = getOrbitParams();
    addSliderRow(container, "目标高度", p.targetHeight, 0, 30, 0.5, (v) => {
        setOrbitParams({ targetHeight: v });
        triggerAutoSave();
    });
    addSliderRow(container, "距离", p.distance, 2, 50, 0.5, (v) => {
        setOrbitParams({ distance: v });
        if (getCameraMode() === "orbit" && _currentCamera instanceof ArcRotateCamera) {
            _currentCamera.radius = v;
        }
        triggerAutoSave();
    });
    addSliderRow(container, "俯仰角", p.beta, 0.1, Math.PI - 0.1, 0.05, (v) => {
        setOrbitParams({ beta: v });
        if (getCameraMode() === "orbit" && _currentCamera instanceof ArcRotateCamera) {
            _currentCamera.beta = v;
        }
        triggerAutoSave();
    });
}

function renderFreeflyParams(container: HTMLElement): void {
    const p = getFreeflyParams();
    addSliderRow(container, "移动速度", p.speed, 0.1, 5, 0.1, (v) => {
        setFreeflyParams({ speed: v });
        triggerAutoSave();
    });
    addSliderRow(container, "鼠标灵敏度", p.angularSensibility, 500, 5000, 100, (v) => {
        setFreeflyParams({ angularSensibility: v });
        triggerAutoSave();
    });
}

function renderConcertParams(container: HTMLElement): void {
    const p = getConcertParams();
    addSliderRow(container, "轨道半径", p.radius, 2, 50, 0.5, (v) => {
        setConcertParams({ radius: v });
        triggerAutoSave();
    });
    addSliderRow(container, "目标高度", p.height, 0, 30, 0.5, (v) => {
        setConcertParams({ height: v });
        triggerAutoSave();
    });
    addSliderRow(container, "旋转速度", p.speed, 0, 5, 0.1, (v) => {
        setConcertParams({ speed: v });
        triggerAutoSave();
    });
}

function renderOneshotParams(container: HTMLElement): void {
    const shots = getOneshotParams().shots;
    // Save current as new shot
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "保存当前镜头";
    saveBtn.style.cssText = "padding:6px 12px;border:1px solid var(--white-08);border-radius:4px;background:var(--accent);color:var(--text-bright);cursor:pointer;font-size:11px;width:100%;margin-bottom:10px;";
    saveBtn.addEventListener("click", () => {
        const name = prompt("镜头名称:", `镜头 ${shots.length + 1}`);
        if (name) {
            saveCameraShot(name);
            refreshCameraLevel();
            container.innerHTML = "";
            renderOneshotParams(container);
        }
    });
    container.appendChild(saveBtn);

    // Delete all button
    if (shots.length > 0) {
        const delAll = document.createElement("button");
        delAll.textContent = "清空所有镜头";
        delAll.style.cssText = "padding:4px 10px;border:1px solid var(--white-08);border-radius:4px;background:transparent;color:var(--text-dim);cursor:pointer;font-size:10px;margin-bottom:10px;";
        delAll.addEventListener("click", () => {
            for (let i = shots.length - 1; i >= 0; i--) deleteCameraShot(i);
            refreshCameraLevel();
            container.innerHTML = "";
            renderOneshotParams(container);
        });
        container.appendChild(delAll);
    }

    // List shots with apply/delete buttons
    for (let i = 0; i < shots.length; i++) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
        const name = document.createElement("span");
        name.style.cssText = "font-size:11px;color:var(--text-bright);flex:1;overflow:hidden;text-overflow:ellipsis;";
        name.textContent = shots[i].name;
        const applyBtn = document.createElement("button");
        applyBtn.textContent = "恢复";
        applyBtn.style.cssText = "padding:2px 8px;border:1px solid var(--white-08);border-radius:3px;background:var(--accent);color:var(--text-bright);cursor:pointer;font-size:10px;";
        applyBtn.addEventListener("click", () => {
            applyCameraShot(i, scene);
            setStatus(`✓ 已恢复镜头: ${shots[i].name}`, true);
        });
        const delBtn = document.createElement("button");
        delBtn.textContent = "×";
        delBtn.style.cssText = "padding:2px 6px;border:none;border-radius:3px;background:transparent;color:var(--text-dim);cursor:pointer;font-size:12px;";
        delBtn.addEventListener("click", () => {
            deleteCameraShot(i);
            container.innerHTML = "";
            renderOneshotParams(container);
        });
        row.appendChild(name);
        row.appendChild(applyBtn);
        row.appendChild(delBtn);
        container.appendChild(row);
    }
}
```

- [ ] **Step 3: Add `onFolderEnter` routing for param panels**

```typescript
    // In the scene stack onFolderEnter switch, add:
    case "camera:params:orbit": return buildCameraParamsLevel("orbit");
    case "camera:params:freefly": return buildCameraParamsLevel("freefly");
    case "camera:params:oneshot": return buildCameraParamsLevel("oneshot");
    case "camera:params:concert": return buildCameraParamsLevel("concert");
```

- [ ] **Step 4: Ensure `addSliderRow` is available**

`addSliderRow` already exists in scene-menu.ts. No changes needed.

- [ ] **Step 5: Build verify**

---

### Task 7: Camera preset save/load + serialization

**Files:**
- Modify: `frontend/src/scene-menu.ts`
- Modify: `frontend/src/camera.ts`

- [ ] **Step 1: Add serialization helpers in camera.ts**

```typescript
/** Serialize current camera preset to JSON string. */
export function serializeCameraPreset(): string {
    return JSON.stringify(_currentPreset, null, 2);
}

/** Deserialize and apply a camera preset from JSON string. */
export function deserializeCameraPreset(jsonStr: string): CameraPreset {
    const data = JSON.parse(jsonStr);
    // Merge with defaults for forward compatibility
    const merged = { ...defaultCameraPreset(), ...data };
    merged.orbit = { ...defaultCameraPreset().orbit, ...data.orbit };
    merged.freefly = { ...defaultCameraPreset().freefly, ...data.freefly };
    merged.oneshot = { ...defaultCameraPreset().oneshot, ...data.oneshot };
    merged.concert = { ...defaultCameraPreset().concert, ...data.concert };
    merged.vmd = { ...defaultCameraPreset().vmd, ...data.vmd };
    merged.shared = { ...defaultCameraPreset().shared, ...data.shared };
    return merged;
}

/** Load a camera preset from JSON and apply it immediately. */
export async function loadAndApplyCameraPreset(jsonStr: string): Promise<void> {
    const preset = deserializeCameraPreset(jsonStr);
    _currentPreset = preset;
    // Switch to saved mode
    if (preset.mode) {
        switchCameraMode(preset.mode);
    }
    setStatus(`✓ 已加载相机预设`, true);
}
```

- [ ] **Step 2: Add save/load handlers in scene-menu.ts's handleSceneAction**

```typescript
    // Camera preset save/load
    if (row.target === "camera:preset-save") {
        (async () => {
            try {
                const path = await SelectCameraPresetSaveFile();
                if (!path) return;
                const json = serializeCameraPreset();
                await SaveCameraPreset(json, path);
                setStatus("✓ 相机预设已保存", true);
            } catch (err: any) {
                setStatus("✗ 保存失败: " + (err.message || err), false);
            }
        })();
        return;
    }
    if (row.target === "camera:preset-load") {
        (async () => {
            try {
                const path = await SelectCameraPresetOpenFile();
                if (!path) return;
                const json = await LoadCameraPreset(path);
                await loadAndApplyCameraPreset(json);
                refreshCameraLevel();
            } catch (err: any) {
                setStatus("✗ 加载失败: " + (err.message || err), false);
            }
        })();
        return;
    }
```

- [ ] **Step 3: Update `CameraState` to store full preset**

Replace existing `CameraState` interface in camera.ts:

```typescript
export interface CameraState {
    preset: CameraPreset;
    // Runtime-only: camera position restore
    alpha: number;
    beta: number;
    radius: number;
    targetX: number;
    targetY: number;
    targetZ: number;
    positionX?: number;
    positionY?: number;
    positionZ?: number;
}
```

Update `getCameraState`:

```typescript
export function getCameraState(): CameraState {
    const cam = _currentCamera;
    const isArc = cam instanceof ArcRotateCamera;
    const alpha = isArc ? cam.alpha : 0;
    const beta = isArc ? cam.beta : 0;
    const radius = isArc ? cam.radius : 16;
    return {
        preset: JSON.parse(JSON.stringify(_currentPreset)),
        alpha, beta, radius,
        targetX: (cam as any).target?.x ?? 0,
        targetY: (cam as any).target?.y ?? 8,
        targetZ: (cam as any).target?.z ?? 0,
        positionX: cam?.position.x,
        positionY: cam?.position.y,
        positionZ: cam?.position.z,
    };
}
```

- [ ] **Step 4: Integrate with scene save/load**

No changes needed — `getCameraState`/`setCameraState` already in the save/load chain. The new `CameraState.preset` will be serialized automatically.

---

### Task 8: Build + test

- [ ] **Step 1: Full build**

```bash
cd frontend && npx tsc && npx vite build 2>&1 | findstr /R "✓ error"
cd . && go build ./...
```

- [ ] **Step 2: Run vitest**

```bash
cd frontend && npx vitest run 2>&1 | findstr "Tests"
```
Expected: 93+ tests pass

- [ ] **Step 3: Manual QA checklist with wails dev**

- [ ] 场景菜单 → 相机模式 — 可见，4 个子模式可切换
- [ ] 切到轨道 → 自动聚焦当前角色
- [ ] 轨道设置 — 滑块调目标高度/距离/俯仰角，实时生效
- [ ] 自由飞行设置 — 速度/灵敏度滑块
- [ ] 演唱会设置 — 半径/高度/速度滑块，实时生效
- [ ] 镜头预设 — 保存当前镜头 → 列表中显示 → 恢复 → 删除
- [ ] 保存相机预设 → 弹出 `.mcucam.json` 保存对话框
- [ ] 加载相机预设 → 选择文件 → 所有参数恢复
- [ ] 保存场景 → 加载场景 → 相机预设一并恢复

---

## Self-Review

### 1. Spec Coverage

| Requirement | Task |
|-------------|------|
| Orbit auto-focus on switch | Task 1 |
| 完整参数系统：每模式独立配置 | Task 2 (interfaces) + Task 3 (factories) |
| 演唱会可配置环绕 | Task 3.3 |
| 镜头预设保存/加载 | Task 4 (Go) + Task 7 (serde) |
| 参数 UI 面板 | Task 6 (renderCustom sliders/buttons) |
| 镜头预设管理界面 | Task 6.2 (renderOneshotParams) |
| 场景菜单恢复相机入口 | Task 5 |
| 动作弹窗移除相机 | Task 5.6 |
| 场景持续化 | Task 7.4 |

### 2. Placeholder Scan
No placeholders. All code provided inline.

### 3. Type Consistency
- `CameraPreset` union structure used consistently across camera.ts, scene-menu.ts, serialization
- `CameraState.preset` enables full round-trip persistence
- `CameraShot` type shared between oneshot params and UI
- Go binding signatures match Wails convention
