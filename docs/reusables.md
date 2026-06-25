# 🔧 复用函数索引

> 写新功能前先查此表。已有现成函数时不重复实现。

---

## Go（`MikuMikuAR/`）

| 函数 | 位置 | 签名 | 用途 |
|------|------|------|------|
| `ParsePMXHeader` | `pmx.go:20` | `(path string) (*PMXMeta, error)` | 读 PMX 签名/版本/编码/4段元数据；失败返空，非致命 |
| `decodeUTF16LE` | `pmx.go:91` | `(b []byte) string` | UTF-16LE → string；含 surrogate pair 处理，零依赖 |
| `decodeUTF16` | `pmx.go:104` | `(u16 []uint16) string` | decodeUTF16LE 的内部委托，也可独立用 |
| `truncate` | `app.go:734` | `(s string, n int) string` | 截断到 n 个 rune + "…"，rune 安全 |
| `corsMiddleware` | `app.go:744` | `(next http.Handler) http.Handler` | 注入 `Access-Control-Allow-Origin: *`，Wails WebView 必需 |
| `basenameFallbackFS` | `app.go:770` | `(root string, logFn func(string, ...interface{})) http.Handler` | HTTP 404 → 按文件名忽略目录/大小写回退；包在 corsMiddleware 内 |
| `ImportLocalFile` | `app.go:1020` | `(path string) (*ExtractResult, error)` | 本地 zip/pmx/vmd 导入模型库；zip 走 ExtractZip 链路 |
| `StartWatchDir` | `app.go:1057` | `(dir string) error` | fsnotify 目录监听；自动去重，支持 `.zip/.pmx/.vmd` 后缀过滤 |
| `StopWatchDir` | `app.go:1087` | `() error` | 停止目录监听；goroutine-safe |
| `SaveSceneFile` | `app.go:592` | `(jsonStr, path string) error` | 场景 JSON 写入 .mmascene 文件 |
| `LoadSceneFile` | `app.go:597` | `(path string) (string, error)` | 读取 .mmascene 文件内容 |
| `SelectSceneSaveFile` | `app.go:604` | `() (string, error)` | 保存场景文件对话框 |
| `SelectSceneOpenFile` | `app.go:620` | `() (string, error)` | 打开场景文件对话框 |
| `SaveLastScene` | `app.go:637` | `(jsonStr string) error` | 自动保存场景到 last_scene.json（配置目录） |
| `LoadLastScene` | `app.go:644` | `() (string, error)` | 读取 last_scene.json |

## TypeScript（`MikuMikuAR/frontend/src/`）

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
