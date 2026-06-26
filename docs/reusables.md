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
| `ScanSoftwareDir` | `() ([]SoftwareEntry, error)` | 扫描软件目录 |
| `LaunchSoftware` | `(path string) error` | 启动软件 |
| `OpenSoftwareDir` | `() error` | 打开软件目录 |

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
| `ParsePMXHeader` | `pmx.go:20` | `(path string) (*PMXMeta, error)` | 读 PMX 签名/版本/编码/4段元数据 |
| `parsePMXHeaderBytes` | `pmx.go:38` | `(buf []byte) *PMXMeta` | 从 bytes 解析 PMX Header（zip 内条目用） |
| `decodeUTF16LE` | `pmx.go:95` | `(b []byte) string` | UTF-16LE → string，含 surrogate pair 处理 |
| `decodeUTF16` | `pmx.go:108` | `(u16 []uint16) string` | `[]uint16` → string |
| `truncate` | `app.go` | `(s string, n int) string` | 截断到 n 个 rune + "…" |
| `corsMiddleware` | `app.go` | `(next http.Handler) http.Handler` | 注入 CORS 头 |
| `basenameFallbackFS` | `app.go` | `(root string, logFn ...) http.Handler` | HTTP 404 → 按文件名回退 |
| `ensureDir` | `app.go` | `(subDir string, useCache bool) (string, error)` | 确保目录存在 |

---

## TypeScript（`frontend/src/`）

| 函数 | 位置 | 签名 | 用途 |
|------|------|------|------|

### 关键类型

| 类型 | 位置 | 字段 | 说明 |
|------|------|------|------|
| `ModelInstance` | `config.ts:9` | `id, name, filePath, meshes, kind, mmdModel?` | 运行时模型实例，kind="actor"\|"stage", mmdModel 可选 |
| `ModelKind` | `config.ts:7` | `"actor" \| "stage"` | 模型类型，stage 跳过物理和 VMD 绑定 |
| `LightState` | `scene.ts:117` | `hemiIntensity, dirIntensity, dirX/Y/Z` | 灯光参数，用于灯光面板和场景序列化 |
| `CameraState` | `camera.ts:319` | `mode, alpha/beta/radius, targetX/Y/Z, positionX/Y/Z` | 相机状态，支持 ArcRotate + UniversalCamera |
| `SceneFile` | `scene.ts:481` | `version, models[], camera, lights` | 场景 JSON 结构，含 libraryRef 可移植标识符 |

### 工具函数
| `escapeHtml` | `config.ts:154` | `(s: string) => string` | HTML 特殊字符转义，零依赖 |
| `normPath` | `fileservice.ts:24` | `(p: string) => string` | 标准化路径：反斜杠→正斜杠；原在 config.ts，已迁入 fileservice |
| `resolveFileUrl` | `fileservice.ts:11` | `(filePath: string) => Promise<{url,port,dir}>` | 统一 URL 构造：normPath → StartFileServer → HTTP URL |
| `setStatus` | `config.ts:190` | `(text: string, ok: boolean) => void` | 更新状态栏文字 + 样式 |
| `formatTime` | `config.ts:224` | `(seconds: number) => string` | 秒数 → `MM:SS` 格式 |
| `toBase64` | `config.ts:231` | `(s: string) => string` | 字符串→base64（btoa 包装，统一 UTF-8 处理） |
| `loadPMXFile` | `scene.ts:162` | `(filePath: string, asStage?: boolean) => Promise<void>` | HTTP 加载 PMX + MMD 运行时绑定 |
| `loadVMDMotion` | `scene.ts:266` | `(data: ArrayBuffer, name: string) => Promise<void>` | ArrayBuffer → VMD 解析 → 绑定 → 播放 |
| `loadVMDFromPath` | `scene.ts:314` | `(path: string) => Promise<void>` | `resolveFileUrl` → fetch → loadVMDMotion |
| `initLibrary` | `library.ts:407` | `() => Promise<void>` | 启动时加载配置 + 库索引 + 后台刷新 |
| `rescanAndSync` | `library.ts:453` | `(dir?: string) => Promise<LibraryModel[]>` | 重新扫描 + 同步状态；收拢 5 处重复 |
| `refreshLibrary` | `library.ts:460` | `() => Promise<void>` | rescanAndSync + 清缓存 + 状态提示 + 刷新弹窗 |
| `togglePopup` | `library.ts:123` | `() => void` | 打开/关闭模型库弹窗（已简化，删伪分支）|
| `removeModel` | `scene.ts:347` | `(id: string) => void` | 销毁单个模型并释放资源 |
| `focusModel` | `scene.ts:382` | `(id: string) => void` | 切换聚焦模型 + 相机对准 |
| `arrangeModels` | `scene.ts:406` | `() => void` | 重新排列所有已加载模型的位置 |
| `renderExternalList` | `settings.ts:20` | `() => void` | 渲染外部模型列表（库外目录扫描结果） |
| `closeAllOverlays` | `config.ts:248` | `() => void` | 统一关闭弹窗（modelPopup/motionPopup/external/settings） |
| `computeLibraryRef` | `config.ts:257` | `(filePath: string) => string\|null` | 计算可移植库标识符，用于场景序列化避免路径依赖 |
| `resolveLibraryRef` | `config.ts:280` | `(libraryRef: string) => string\|null` | 将库标识符解析为当前配置下的绝对路径 |
| `getLightState` | `scene.ts:117` | `() => LightState` | 获取当前灯光参数（hemi+dir 强度/方向） |
| `setLightState` | `scene.ts:126` | `(s: Partial<LightState>) => void` | 设置灯光参数，实时生效 |
| `serializeScene` | `scene.ts:497` | `() => SceneFile` | 序列化完整场景（模型/VMD/相机/灯光/队形） |
| `deserializeScene` | `scene.ts:516` | `(data: SceneFile) => Promise<void>` | 反序列化场景，按 libraryRef 优先解析路径 |
| `getCameraState` | `camera.ts:330` | `() => CameraState` | 导出相机状态（球坐标+position，支持所有模式） |
| `setCameraState` | `camera.ts:345` | `(s: CameraState) => void` | 恢复相机状态，ArcRotateCamera/UniversalCamera 双分支 |
| `focusedMmdModel` | `scene.ts:55` | `() => MmdWasmModel\|null` | 获取当前聚焦模型的 MMD 运行时对象 |
| `focusedModel` | `scene.ts:56` | `() => ModelInstance\|undefined` | 获取当前聚焦模型实例 |
| `tryRestoreLastScene` | `scene.ts:585` | `() => Promise<void>` | 启动时自动恢复上次保存的场景 |

---

## 更新规则

- 新增函数被第二个调用方使用时 → 记入此表
- 函数改名/移动 → 同步更新行
- 函数删除 → 移出行
