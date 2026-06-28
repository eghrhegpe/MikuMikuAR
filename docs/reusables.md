# 🔧 复用函数索引

> 写新功能前先查此表。已有现成函数时不重复实现。

---

## Go Binding 完整函数表（`app.go`）

> Wails 自动生成 `wailsjs/go/main/App.ts` 供前端调用。

### 文件对话框

| 函数 | 签名 | 用途 |
|------|------|------|
| `SelectPMXFile` | `() (string, error)` | 选择 PMX 文件 |
| `SelectVMDMotion` | `() (string, error)` | 选择 VMD 文件 |
| `SelectVPDPose` | `() (string, error)` | 选择 VPD 姿势文件 |
| `SelectAudioFile` | `() (string, error)` | 选择音频文件（MP3/WAV/OGG） |
| `SelectDir` | `() (string, error)` | 选择目录 |
| `SelectExeFile` | `() (string, error)` | 选择可执行文件 |
| `SelectSceneSaveFile` | `() (string, error)` | 场景保存对话框 |
| `SelectSceneOpenFile` | `() (string, error)` | 场景打开对话框 |

### 模型库管理

| 函数 | 签名 | 用途 |
|------|------|------|
| `ScanModelDir` | `(root string, external []ExternalPath) ([]ModelEntry, error)` | 扫描主库+外部库，返回合并列表 |
| `GetModelMeta` | `(pmxPath string) (ModelMeta, error)` | 解析单个 PMX Header |
| `GetModelMetaBatch` | `(paths []string) (map[string]ModelMeta, error)` | 批量解析 PMX Header |
| `GetLibraryIndex` | `() ([]ModelEntry, error)` | 读取缓存的 index.json |
| `SetLibraryRoot` | `(root string) error` | 设置主库路径并触发重新扫描 |
| `AddExternalPath` | `(path string) error` | 添加外部库并重新扫描 |
| `RemoveExternalPath` | `(path string) error` | 移除外部库并重新扫描 |
| `RenameExternalPath` | `(path, name string) error` | 重命名外部库显示名 |

### 配置读写

| 函数 | 签名 | 用途 |
|------|------|------|
| `GetConfig` | `() (*Config, error)` | 读取配置 |
| `SetBlenderPath` | `(path string) error` | 保存 Blender 路径 |
| `SetDisplayNamePriority` | `(priority string) error` | 保存显示名优先级 |
| `SetDownloadWatchDir` | `(dir string) error` | 设置监听目录 |
| `SetDownloadAutoImport` | `(auto bool) error` | 设置自动导入 |
| `SetMMDPath` | `(path string) error` | 保存 MMD 路径 |
| `AutoDetectMMD` | `() (string, error)` | 自动检测 MMD |

### 收藏与标签

| 函数 | 签名 | 用途 |
|------|------|------|
| `ToggleFavorite` | `(libraryRef string) error` | 切换收藏状态 |
| `GetFavorites` | `() []string` | 获取收藏列表 |
| `AddTag` | `(libraryRef, tag string) error` | 添加标签 |
| `RemoveTag` | `(libraryRef, tag string) error` | 移除标签 |
| `GetTagsByModel` | `(libraryRef string) []string` | 获取模型标签 |
| `GetAllTags` | `() []string` | 获取所有标签 |
| `GetModelsByTag` | `(tag string) []string` | 按标签查询模型 |

### 渲染预设

| 函数 | 签名 | 用途 |
|------|------|------|
| `SaveRenderPreset` | `(name, params string) error` | 保存渲染预设 |
| `DeleteRenderPreset` | `(name string) error` | 删除渲染预设 |
| `GetRenderPresets` | `() []RenderPreset` | 获取所有预设 |

### Zip 处理

| 函数 | 签名 | 用途 |
|------|------|------|
| `ExtractZip` | `(zipPath, innerPath string) (*ExtractResult, error)` | 解压 zip 并返回路径 |
| `ImportZip` | `(zipPath string) (*ExtractResult, error)` | 导入 zip（找首个 PMX） |
| `ImportLocalFile` | `(path string) (*ExtractResult, error)` | 导入本地文件（自动识别格式） |
| `CleanOrphanCache` | `() (int, error)` | 清理孤儿缓存 |
| `ClearExtractCache` | `() error` | 清除所有提取缓存 |

### HTTP 文件服务

| 函数 | 签名 | 用途 |
|------|------|------|
| `StartFileServer` | `(dirPath string) (int, error)` | 启动/复用 HTTP 服务器，返回端口 |
| `StopFileServer` | `(dirPath string)` | 停止指定目录的 HTTP 服务器 |
| `IsolateModelDir` | `(filePath string) (string, error)` | 安全隔离外部文件到 temp 目录 |

### 缩略图

| 函数 | 签名 | 用途 |
|------|------|------|
| `SaveThumbnail` | `(modelPath, base64PNG string) error` | 保存缩略图 |
| `GetThumbnail` | `(modelPath string) (string, error)` | 读取缩略图（base64） |
| `GetThumbnailBatch` | `(paths []string) (map[string]string, error)` | 批量读取缩略图 |

### 近期播放

| 函数 | 签名 | 用途 |
|------|------|------|
| `GetRecentModels` | `() []string` | 获取最近打开的模型 libraryRef 列表（最新在前） |
| `AddRecentModel` | `(libraryRef string) error` | 添加模型到近期播放列表（去重置顶，最多 20 条） |

### 截图

| 函数 | 签名 | 用途 |
|------|------|------|
| `SaveScreenshot` | `(dir, filename, base64PNG string) error` | 保存 PNG 截图到指定目录 |

### 目录监听

| 函数 | 签名 | 用途 |
|------|------|------|
| `StartWatchDir` | `(dir string) error` | 开始监听目录（fsnotify） |
| `StopWatchDir` | `() error` | 停止监听 |
| `GetDownloadWatchStatus` | `() string` | 获取监听状态（目录或空字符串） |

### Blender / MMD / 软件

| 函数 | 签名 | 用途 |
|------|------|------|
| `OpenInBlender` | `(modelPath string) error` | 在 Blender 中打开模型 |
| `OpenInMMD` | `(modelPath string) error` | 在 MMD 中打开模型 |
| `ScanSoftwareDir` | `() ([]SoftwareEntry, error)` | 扫描软件目录 + 合并自定义软件，自动识别 Kind |
| `LaunchSoftware` | `(path string, args string) error` | 启动软件（args 为命令行参数，可为空） |
| `OpenWithSoftware` | `(modelPath, softwarePath, args string) error` | 用指定软件打开模型（args 中 {model} 会被替换为模型路径） |
| `AddCustomSoftware` | `(path, name, args string) error` | 添加自定义软件到 Config |
| `RemoveCustomSoftware` | `(path string) error` | 从 Config 移除自定义软件 |
| `UpdateCustomSoftware` | `(path, name, args string) error` | 更新自定义软件的名称和参数 |
| `OpenSoftwareDir` | `() error` | 打开软件目录 |

### 舞蹈套装

| 函数 | 签名 | 用途 |
|------|------|------|
| `GetDanceSets` | `() ([]DanceSet, error)` | 获取所有舞蹈套装 |
| `SaveDanceSet` | `(id string, ds DanceSet) error` | 保存/更新套装 |
| `DeleteDanceSet` | `(id string) error` | 删除套装 |
| `ImportDanceSet` | `(vmdPath, audioPath, name string) (string, error)` | 从 VMD+音频创建套装 |

### 场景序列化

| 函数 | 签名 | 用途 |
|------|------|------|
| `SaveSceneFile` | `(jsonStr, path string) error` | 保存场景到文件 |
| `LoadSceneFile` | `(path string) (string, error)` | 读取场景文件 |
| `SaveLastScene` | `(jsonStr string) error` | 自动保存上次场景 |
| `LoadLastScene` | `() (string, error)` | 读取上次场景 |

### Go 内部工具函数（app.go / pmx.go）

| 函数 | 位置 | 签名 | 用途 |
|------|------|------|------|
| `ParsePMXHeader` | `pmx.go:20` | `(path string) (*PMXMeta, error)` | 读 PMX 签名/版本/编码/4段元数据；编码解码用 unicode/utf16 标准库 |
| `parsePMXHeaderBytes` | `pmx.go:38` | `(buf []byte) *PMXMeta` | 从 bytes 解析 PMX Header（zip 内条目用） |
| `truncate` | `app.go` | `(s string, n int) string` | 截断到 n 个 rune + "…" |
| `corsMiddleware` | `app.go` | `(next http.Handler) http.Handler` | 注入 CORS 头 |
| `basenameFallbackFS` | `app.go` | `(root string, logFn ...) http.Handler` | HTTP 404 → 按文件名回退 |
| `ensureDir` | `app.go` | `(subDir string, useCache bool) (string, error)` | 确保目录存在 |

---

## TypeScript（`frontend/src/{core,scene,menus,motion,outfit}/`）

> **文件夹结构（2026-06-28 重构后）**：
> - `core/` — 入口、共享状态、工具函数（config, main, fileservice, ui-helpers, icons）
> - `scene/` — 3D 场景核心 + 子模块（scene, scene-model, scene-material, scene-vmd, scene-playback, camera, env-lighting）
> - `menus/` — 所有弹窗 UI（menu, library, library-core, model-detail, model-material, model-preset, motion-popup, scene-menu, env-menu, outfit-ui, settings）
> - `motion/` — 程序化动作 + 文件格式（procedural-motion, vmd-writer, vpd-parser, beat-detector, lipsync）
> - `outfit/` — 换装 + 音频（outfit, audio）

| 函数 | 位置 | 签名 | 用途 |
|------|------|------|------|

### 关键类型

| 类型 | 位置 | 字段 | 说明 |
|------|------|------|------|
| `ModelInstance` | `core/config.ts:9` | `id, name, filePath, meshes, kind, mmdModel?` | 运行时模型实例，kind="actor"\|"stage", mmdModel 可选 |
| `ModelKind` | `core/config.ts:7` | `"actor" \| "stage"` | 模型类型，stage 跳过物理和 VMD 绑定 |
| `LightState` | `scene/scene.ts:117` | `hemiIntensity, dirIntensity, dirX/Y/Z` | 灯光参数，用于灯光面板和场景序列化 |
| `CameraState` | `scene/camera.ts:319` | `mode, alpha/beta/radius, targetX/Y/Z, positionX/Y/Z` | 相机状态，支持 ArcRotate + UniversalCamera |
| `SceneFile` | `scene/scene.ts:481` | `version, models[], camera, lights` | 场景 JSON 结构，含 libraryRef 可移植标识符 |
| `LipSyncState` | `motion/lipsync.ts` | `enabled, sensitivity, intensity` | LipSync 状态，序列化到 `SceneFile.lipSync` |
| `PhysicsCategory` | `core/config.ts` | `"skirt" \| "chest" \| "hair" \| "accessory"` | 物理分类，按骨骼名正则匹配 |
| `ProcMotionState` | `motion/procedural-motion.ts` | `{ mode, intensity, speed, autoSwitch }` | 程序化动作完整状态 |

### 工具函数
| `escapeHtml` | `core/config.ts:154` | `(s: string) => string` | HTML 特殊字符转义，零依赖 |
| `normPath` | `core/fileservice.ts:24` | `(p: string) => string` | 标准化路径：反斜杠→正斜杠；原在 config.ts，已迁入 fileservice |
| `resolveFileUrl` | `core/fileservice.ts:11` | `(filePath: string) => Promise<{url,port,dir}>` | 统一 URL 构造：normPath → StartFileServer → HTTP URL |
| `setStatus` | `core/config.ts:190` | `(text: string, ok: boolean) => void` | 更新状态栏文字 + 样式 |
| `formatTime` | `core/config.ts:224` | `(seconds: number) => string` | 秒数 → `MM:SS` 格式 |
| `toBase64` | `core/config.ts:231` | `(s: string) => string` | 字符串→base64（btoa 包装，统一 UTF-8 处理） |
| `closeAllOverlays` | `core/config.ts:248` | `() => void` | 统一关闭弹窗（modelPopup/motionPopup/external/settings） |
| `computeLibraryRef` | `core/config.ts:257` | `(filePath: string) => string\|null` | 计算可移植库标识符，用于场景序列化避免路径依赖 |
| `resolveLibraryRef` | `core/config.ts:280` | `(libraryRef: string) => string\|null` | 将库标识符解析为当前配置下的绝对路径 |

### 场景编排（scene/）

所有函数从 `scene/scene.ts` 导出（re-export），部分实现在子模块中。

| 函数 | 位置 | 签名 | 用途 |
|------|------|------|------|
| `loadPMXFile` | `scene/scene.ts` | `(filePath: string, asStage?: boolean) => Promise<void>` | HTTP 加载 PMX + MMD 运行时绑定 |
| `removeModel` | `scene/scene.ts`（委托 scene-model） | `(id: string) => void` | 销毁单个模型并释放资源 |
| `focusModel` | `scene/scene.ts`（委托 scene-model） | `(id: string) => void` | 切换聚焦模型 + 相机对准 |
| `arrangeModels` | `scene/scene.ts`（委托 scene-model） | `() => void` | 重新排列所有已加载模型的位置 |
| `getLightState` | `scene/scene.ts` | `() => LightState` | 获取当前灯光参数（hemi+dir 强度/方向） |
| `setLightState` | `scene/scene.ts` | `(s: Partial<LightState>) => void` | 设置灯光参数，实时生效 |
| `serializeScene` | `scene/scene.ts` | `() => SceneFile` | 序列化完整场景（模型/VMD/相机/灯光/队形） |
| `deserializeScene` | `scene/scene.ts` | `(data: SceneFile) => Promise<void>` | 反序列化场景，按 libraryRef 优先解析路径 |
| `tryRestoreLastScene` | `scene/scene.ts` | `() => Promise<void>` | 启动时自动恢复上次保存的场景 |
| `focusedMmdModel` | `scene/scene.ts`（委托 modelManager） | `() => MmdWasmModel\|null` | 获取当前聚焦模型的 MMD 运行时对象 |
| `focusedModel` | `scene/scene.ts`（委托 modelManager） | `() => ModelInstance\|undefined` | 获取当前聚焦模型实例 |

### VMD 加载（scene/scene-vmd.ts）

| 函数 | 签名 | 用途 |
|------|------|------|
| `loadVMDMotion` | `(data: ArrayBuffer, name: string, targetModelId?: string) => Promise<void>` | ArrayBuffer → VMD 解析 → 绑定 → 播放 |
| `loadVMDFromPath` | `(path: string) => Promise<void>` | `resolveFileUrl` → fetch → loadVMDMotion |
| `loadCameraVmdFromPath` | `(path: string) => Promise<void>` | 从 VMD 文件加载相机轨道 |
| `loadVPDPose` | `(path: string) => Promise<void>` | VPD 姿势文件 → VMD 帧 → 绑定到当前模型 |

### 播放 UI（scene/scene-playback.ts）

| 函数 | 签名 | 用途 |
|------|------|------|
| `updatePlaybackUI` | `() => void` | 更新进度条 + 时间显示 + 暂停按钮状态 |
| `seekFromEvent` | `(e: MouseEvent \| PointerEvent) => void` | 点击/拖拽进度条定位 |

### 材质系统（scene/scene-material.ts）

| 函数 | 签名 | 用途 |
|------|------|------|
| `_catOf` | `(matName: string) => string` | 按材质名分类：skin/hair/eye/clothing/other |
| `_applyAll` | `(matData: MaterialOverride[], inst: ModelInstance, params: MatParams) => void` | 批量应用材质参数至所有匹配材质 |
| `setMatParams` | `(inst: ModelInstance, category: string, params: MatParams) => void` | 按分类设置材质参数（diffuse/specular/ambient/shininess） |
| `getMatState` | `(inst: ModelInstance, cat: string) => MatParams \| null` | 获取当前分类的材质参数快照 |
| `applyMatState` | `(inst: ModelInstance, cat: string, params: MatParams) => void` | 恢复某个分类的材质参数 |

### 模型管理器（scene/scene-model.ts）

`ModelManager` 类封装模型注册表 + 生命周期 + 属性管理，`scene.ts` 中通过 `export let modelManager: ModelManager` 提供全局单例。

**构造**：`new ModelManager(scene, onChange, autoFrame)` — onChange=triggerAutoSave, autoFrame=相机 framing

| 方法 | 签名 | 用途 |
|------|------|------|
| `get` | `(id: string) => ModelInstance\|undefined` | 按 ID 获取模型实例 |
| `getAll` | `() => ModelInstance[]` | 获取所有已加载模型 |
| `size` | `number`（getter） | 当前模型总数 |
| `register` | `(inst: ModelInstance) => void` | 注册新模型到 registry |
| `storeRigidBodyState` | `(id: string, states: Uint8Array) => void` | 保存刚体初始状态（物理 toggle 恢复用） |
| `focused` | `() => ModelInstance\|undefined` | 当前聚焦模型实例 |
| `focusedMmdModel` | `() => MmdWasmModel\|null` | 当前聚焦模型的 WASM 运行时对象 |
| `findByFilePath` | `(filePath: string) => ModelInstance\|undefined` | 按路径查找已加载模型 |
| `remove` | `(id: string) => void` | 删除模型 + 清理所有关联状态 |
| `removeFocused` | `() => void` | 删除当前聚焦模型 |
| `focus` | `(id: string) => void` | 聚焦模型 + 相机 framing + onChange |
| `arrange` | `() => void` | 横向排列所有模型（间距 3） |
| `setVisibility` | `(id: string, visible: boolean) => void` | 显示/隐藏 |
| `setOpacity` | `(id: string, opacity: number) => void` | 透明度 0..1 |
| `setWireframe` | `(id: string, wireframe: boolean) => void` | 线框模式 |
| `setBoneVis` | `(id: string, show: boolean) => void` | 骨骼可视化（彩色线段+关节球） |
| `setPhysics` | `(id: string, enabled: boolean) => void` | 物理开关，恢复/清除 rigidBodyStates |
| `setScaling` | `(id: string, scaling: number) => void` | 缩放 0.01..∞ |
| `setRotationY` | `(id: string, rotationY: number) => void` | Y 轴旋转 |
| `setPosition` | `(id: string, x: number, y: number, z: number) => void` | 设置位置 |
| `getPosition` | `(id: string) => [number, number, number]` | 获取位置 |
| `resetTransform` | `(id: string) => void` | 重置所有变换（可见/不透明/无线框/缩放1/归零） |
| `stopVMD` | `(id: string) => void` | 清除模型 VMD 数据 |
| `getPhysicsCategories` | `(id: string) => PhysicsCategory[]` | 返回模型中存在的物理类别 |
| `getPhysicsCatState` | `(id: string) => Record<string, boolean>\|null` | 获取模型 per-category 物理状态 |
| `isPhysicsCategoryEnabled` | `(id: string, cat: string) => boolean` | 指定类别物理是否启用 |
| `setPhysicsCategory` | `(id: string, cat: string, enabled: boolean) => void` | 开关指定类别物理 |
| `getMorphs` | `(id: string) => { name, type }[]` | 获取模型 morph 列表 |
| `setMorphWeight` | `(id: string, morphName: string, weight: number) => void` | 设置 morph 权重 |
| `getMorphWeight` | `(id: string, morphName: string) => number` | 获取 morph 权重 |
| `resetMorphs` | `(id: string) => void` | 重置所有 morph 权重 |
| `captureThumbnail` | `(filePath, canvas, saveFn) => Promise<void>` | 模型加载后自动截图用于缩略图缓存 |
| `dispose` | `() => void` | 清理所有 observer（shutdown 用） |

### 相机（scene/camera.ts）

| 函数 | 签名 | 用途 |
|------|------|------|
| `hasCameraVmd` | `() => boolean` | 是否已加载相机 VMD |
| `clearCameraVmd` | `() => void` | 清除相机 VMD 并切回轨道相机 |
| `animateCameraVmd` | `(frameTime: number) => void` | 每帧更新 VMD 相机位置（30fps帧号） |
| `getCameraState` | `() => CameraState` | 导出相机状态（球坐标+position，支持所有模式） |
| `setCameraState` | `(s: CameraState) => void` | 恢复相机状态，ArcRotateCamera/UniversalCamera 双分支 |

### 模型库 UI（menus/）

| 函数 | 位置 | 签名 | 用途 |
|------|------|------|------|
| `initLibrary` | `menus/library.ts` | `() => Promise<void>` | 启动时加载配置 + 库索引 + 后台刷新 |
| `rescanAndSync` | `menus/library.ts` | `(dir?: string) => Promise<LibraryModel[]>` | 重新扫描 + 同步状态；收拢 5 处重复 |
| `refreshLibrary` | `menus/library.ts` | `() => Promise<void>` | rescanAndSync + 清缓存 + 状态提示 + 刷新弹窗 |
| `togglePopup` | `menus/library.ts` | `() => void` | 打开/关闭模型库弹窗（已简化，删伪分支）|
| `renderExternalList` | `menus/settings.ts` | `() => void` | 渲染外部模型列表（库外目录扫描结果） |

### 音频（outfit/audio.ts）

| 函数 | 签名 | 用途 |
|------|------|------|
| `loadAudioFile` | `(filePath: string) => Promise<void>` | 从本地路径加载音频 |
| `syncAudioPlayback` | `(vmdTime, playing, dur) => void` | VMD 音频同步（每帧调用，偏差>0.1s校正） |
| `setAudioOffset` | `(seconds: number) => void` | 设置音频偏移（正=先播，负=后播） |
| `getAudioPath` | `() => string` | 获取当前音频文件路径 |
| `clearAudio` | `() => void` | 清除当前音频 |

---

## UI CSS 模式

### 滑动条（cs-row 点击条）

由 `addSliderRow` 使用，替代原生 `<input type="range">`。点击条的四个区域（0-25%/25-50%/50-75%/75-100%）分别对应 -0.5/-0.1/+0.1/+0.5 的增量。

| Class | 用途 |
|-------|------|
| `.cs-row` | 滑动条容器（可点击） |
| `.cs-top` | 顶栏 = 图标 + 标签 + 数值 |
| `.cs-icon` | 左侧图标容器 |
| `.cs-label` | 参数名 |
| `.cs-value` | 数值显示 |
| `.cs-bar` | 进度条轨道 |
| `.cs-fill` | 进度条填充（`width` 百分比） |

### 材质列表卡片

| Class | 用途 |
|-------|------|
| `.mat-card` | 材质分类卡片（皮肤/头发/眼睛/服装） |
| `.mat-card-header` | 卡片标题行 |
| `.mat-card-icon` | 分类图标 |
| `.mat-card-title` | 分类名 |
| `.mat-card-count` | 材质数量角标 |
| `.mat-card-modified` | "已修改"标记 |
| `.mat-row` | 材质行，`.modified`=已修改，`.excess`=折叠隐藏 |
| `.mat-swatch` | 10px 漫反射颜色色块 |
| `.mat-index` | `#01` 序号 |
| `.mat-name` | 材质名称 |
| `.mat-modified` | 修改指示图标 |
| `.mat-expand-btn` | 展开/收起按钮（>15 材质时） |
| `.mat-slider-toggle` | 参数微调下拉按钮 |
| `.mat-slider-panel` | 参数微调内容面板 |

### 标签系统

| Class | 用途 |
|-------|------|
| `.tag-chip` | 标签 chip，`.active`=已添加 |
| `.tag-del` | 删除按钮（✕） |
| `.tag-input` | 标签名输入框 |
| `.tag-container` | 标签列表容器 |
| `.hint-text` | 提示文字 |

### Morph/表情

| Class | 用途 |
|-------|------|
| `.morph-list` | 表情 slider 列表 |
| `.morph-row` | 单个表情行 |
| `.morph-header` | 表情名 + 类型 + 数值行 |
| `.morph-name` | 表情名称 |
| `.morph-type` | 表情类型标签 |
| `.morph-val` | 当前权重值 |
| `.morph-empty` | 空状态 |

### 按钮/行

| Class | 用途 |
|-------|------|
| `.slide-item` | MenuStack 行，`.slide-focused`=激活态 |
| `.slide-icon` / `.slide-label` | 行内图标/文字 |
| `.menu-item` | 旧版行（逐步迁移到 slide-item） |
| `.cs-row` | 滑动条（复用在场景菜单 & 模型弹窗） |

> 注：`addSliderRow` 在 `menus/library.ts` 和 `menus/scene-menu.ts` 各有一份独立实现（均使用 cs-row 风格），改一处须同步另一处。

---

## 程序化动作子系统（新增）

### VMD 写入器（`vmd-writer.ts`）

| 函数/常量 | 签名 | 用途 |
|-----------|------|------|
| `BONE_FRAME_SIZE` | `111` | 骨骼关键帧字节数（15+4+12+16+64） |
| `MORPH_FRAME_SIZE` | `23` | morph 关键帧字节数（15+4+4） |
| `buildBoneFrame` | `(frame: BoneKeyFrame) => ArrayBuffer` | 构建单个 111B 骨骼帧 |
| `buildMorphFrame` | `(frame: MorphKeyFrame) => ArrayBuffer` | 构建单个 23B morph 帧 |
| `buildVmd` | `(bones, morphs?, modelName?) => ArrayBuffer` | 构建完整 VMD 二进制文件 |

### 节拍检测器（`beat-detector.ts`）

| 函数/类 | 签名 | 用途 |
|---------|------|------|
| `BeatDetector` | `class` | Web Audio API 节拍检测类 |
| `BeatDetector.attach` | `(audioEl: HTMLAudioElement) => void` | 接入音频元素 |
| `BeatDetector.update` | `() => void` | 每帧更新能量/BPM |
| `BeatDetector.getBPM` | `() => number` | 当前估计 BPM |
| `BeatDetector.isBeat` | `() => boolean` | 本帧是否触发 beat |
| `BeatDetector.reset` | `() => void` | 重置状态 |
| `BeatDetector.detectBeatsFromEnergies` | `static (energies[], threshold?, minInterval?) => number[]` | 纯逻辑节拍检测（供测试） |
| `BeatDetector.bpmFromIntervals` | `static (intervalMs[]) => number` | 从间隔计算 BPM |

### 程序化动作管理器（`procedural-motion.ts`）

| 函数/类型 | 签名 | 用途 |
|----------|------|------|
| `ProcMotionMode` | `"off" \| "idle" \| "autodance"` | 程序化动作模式 |
| `ProcMotionState` | `{ mode, intensity, speed, autoSwitch }` | 程序化动作完整状态 |
| `DEFAULT_PROC_STATE` | `ProcMotionState` | 默认状态 |
| `generateIdleVmd` | `(state, morphNames?) => ArrayBuffer` | 生成 Idle 呼吸 VMD |
| `generateAutoDanceVmd` | `(state, bpm, morphNames?) => ArrayBuffer` | 生成 Auto Dance VMD |
| `shouldAutoDance` | `(playing, mode) => boolean` | 判断是否应切 Auto Dance |
| `shouldIdle` | `(playing, hasUserVmd, mode) => boolean` | 判断是否应切 Idle |

### scene.ts（re-export from scene/scene.ts）— 程序化动作控制

| 函数 | 签名 | 用途 |
|------|------|------|
| `setProcMotionMode` | `(mode: ProcMotionMode) => void` | 设置程序化动作模式 |
| `setProcMotionIntensity` | `(v: number) => void` | 设置动作强度 0..1 |
| `setProcMotionSpeed` | `(v: number) => void` | 设置速度 0.5..2 |
| `setProcMotionAutoSwitch` | `(on: boolean) => void` | 设置自动切换 |
| `getProcMotionState` | `() => ProcMotionState` | 获取当前状态 |
| `regenerateProcMotion` | `() => void` | 强制重新生成 procedural VMD |

### outfit/audio.ts

| 函数 | 签名 | 用途 |
|------|------|------|
| `attachBeatDetector` | `(detector: BeatDetector) => void` | 接入节拍检测器 |
| `notifyBeatDetectorReset` | `() => void` | 通知重置（新曲目） |

### LipSync 子系统（`motion/lipsync.ts`）

| 函数/类型 | 签名 | 用途 |
|----------|------|------|
| `LipSyncState` | `{ enabled, sensitivity, intensity }` | LipSync 状态类型 |
| `DEFAULT_LIPSYNC_STATE` | `LipSyncState` | 默认状态（disabled, sensitivity=0.2, intensity=0.8） |
| `findLipMorph` | `(morphNames: string[]) => string \| null` | 在模型 morph 列表中查找口型 morph（优先级：あ→ア→A→a→口→mouth→open） |
| `amplitudeToWeight` | `(amp, sensitivity, intensity) => number` | 振幅→morph 权重映射，低于阈值返回 0，否则线性映射到 0..intensity |

### beat-detector.ts（`motion/beat-detector.ts`）

| 函数 | 签名 | 用途 |
|------|------|------|
| `BeatDetector.getLevel` (static) | `(freqData: Uint8Array, startBin?, endBin?) => number` | 纯逻辑：频段平均能量 0..1 |
| `BeatDetector.getLevel` (instance) | `(startBin?, endBin?) => number` | 当前帧频段能量，须在 update() 后调用 |

### scene/scene.ts — LipSync 控制 API

| 函数 | 签名 | 用途 |
|------|------|------|
| `setLipSyncEnabled` | `(on: boolean) => void` | 开关 LipSync，关闭时重置 morph |
| `setLipSyncSensitivity` | `(v: number) => void` | 设置灵敏度阈值 0..1 |
| `setLipSyncIntensity` | `(v: number) => void` | 设置最大张嘴幅度 0..1 |
| `getLipSyncState` | `() => LipSyncState` | 获取当前状态副本 |

### ModelManager — 物理分类控制（scene/scene-model.ts）

这些函数已从 scene.ts 移至 ModelManager 类，通过 `modelManager.*` 调用。

| 方法 | 签名 | 用途 |
|------|------|------|
| `getPhysicsCategories` | `(id: string) => PhysicsCategory[]` | 返回模型中存在的物理类别（skirt/chest/hair/accessory） |
| `isPhysicsCategoryEnabled` | `(id, cat) => boolean` | 指定类别物理是否启用 |
| `setPhysicsCategory` | `(id, cat, enabled) => void` | 开关指定类别的物理刚体，恢复/清除 `rigidBodyStates` |
| `setPhysics` | `(id, enabled) => void` | 全局物理开关，清除 per-category 状态 |

判定依据：`scene-model.ts` 中遍历 `runtimeBones`，对每个有 `rigidBodyIndices` 的骨骼按名正则分类：

| 类别 | 匹配模式 |
|------|---------|
| `skirt` | `/スカート\|skirt\|フリル\|frill\|裾\|hem/` |
| `chest` | `/胸\|chest\|bust\|バスト/` |
| `hair` | `/髪\|hair\|ahoge\|bangs\|ponytail\|前髪\|後ろ髪/` |
| `accessory` | `/リボン\|ribbon\|アクセサリ\|accessory\|飾り\|collar\|ネクタイ\|tie\|紐\|string\|襟/` |

---

## 更新规则

- 新增函数被第二个调用方使用时 → 记入此表
- 函数改名/移动 → 同步更新行
- 函数删除 → 移出行
