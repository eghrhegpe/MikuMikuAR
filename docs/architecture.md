# MikuMikuAR 架构与技术方案

基于 MikuMikuAR 的架构（Wails + Go 后端 + babylon-mmd 前端），下面是各环节技术方案的简要梳理：

### 1. Wails 应用骨架
- **技术**：Wails v3（Go + WebView2）
- **职责**：原生桌面壳，桥接 Go 后端与前端 TS
- **后端**：Go 处理文件 I/O（`internal/app/app.go`），暴露绑定方法给前端调用（读 PMX、列目录、解 zip、目录选择）

### 2. PMX 模型加载与渲染
- **技术**：Babylon.js + babylon-mmd 插件
- **流程**：`Scene` 搭建 → `ImportMeshAsync` HTTP 方式加载 PMX → `mmdRuntime.createMmdModel()` 创建带物理的模型
- **物理**：WASM Bullet（`MmdWasmRuntime`），独立线程跑刚体/柔体
  - **全局控制**：`setModelPhysics(id, enabled)` — 开关整模型物理
  - **按类别控制**：`setPhysicsCategory(id, cat, enabled)` — 按骨骼名正则分类（skirt/chest/hair/accessory），选择性关闭裙子/头发等刚体
  - **骨骼叠加**：`setModelBoneVis(id, show)` — 开关骨骼可视化（彩色线段 + 关节小球），物理骨/IK/付与等按类型分色
- **文件服务器**：Go 端 `StartFileServer` 在随机端口启动 HTTP 服务，绕过 Wails base64 桥接

### 3. VMD 动作播放
- **技术**：`VmdLoader.loadFromBufferAsync()` → `MmdWasmAnimation` → `mmdModel.createRuntimeAnimation()` → `mmdRuntime.playAnimation()`
- **实现**：Go 端 `ReadFileBytes` 读出 base64 → 前端 `atob` → `Uint8Array` → `ArrayBuffer` → `VmdLoader` 解析 → `MmdWasmAnimation` 传入 WASM 内存 → `setRuntimeAnimation` 绑定 → `seekAnimation(0)` + `playAnimation()`
- **关键 import**：`mmdWasmRuntimeModelAnimation` 以副作用方式将 `createWasmRuntimeModelAnimation` 挂到 `MmdWasmAnimation.prototype`，缺则抛 `animation is not MmdWasmAnimation` 错误
- **控制**：播放/暂停切换

### 4. 纹理加载
- **方案**：`StartFileServer` 以模型所在目录为 web root。babylon-mmd 加载 PMX 时自动通过相对 URL 请求贴图
- **basename 回退**：`basenameFallbackFS` 解决 PMX 内路径与实际路径不匹配的问题 — 文件名不区分大小写、忽略目录层级查找
- **注册加载器**：前端注册 BMP/TGA 等 babylon-mmd 原生不内置的格式加载器
- **前端工具链**：ESLint / Prettier / Vitest / Playwright 配置与 npm scripts 详见 [`frontend/AGENTS.md`](../frontend/AGENTS.md)

### 5. 模型库管理

#### 5.1 PMX Header 解析（`internal/util/pmx.go`）

只读 PMX 前 ~1.5 KB 提取元数据，不依赖全量解析器：

```
offset 0x00: 签名 4B → 校验 "PMX "
offset 0x04: 版本 float32 4B
offset 0x08: globalsCount 1B (= N)
offset 0x09: globals[N] → flags[0] = encoding (0=UTF-16LE, 1=UTF-8)
跳过 globals 后 → 4 段 text（每段: uint32 LE length + payload）:
  1. 模型名（本地）    2. 模型名（通用）
  3. 说明（本地）      4. 说明（通用）
```

- UTF-16LE 解码用 `unicode/utf16.Decode` 标准库（替代旧手写实现），UTF-8 直接 `string()`
- 失败返回空 `PMXMeta{}`，不阻断扫描

#### 5.2 库目录扫描（`internal/app/app.go:ScanModelDir`）

```go
type ModelEntry struct {
    Dir       string `json:"dir"`        // 模型目录（绝对路径）
    PMXPath   string `json:"pmx_path"`   // .pmx/.vmd 绝对路径；zip 条目为 zip 路径
    NameJp    string `json:"name_jp"`    // PMX header: 本地名
    NameEn    string `json:"name_en"`    // PMX header: 通用名；VMD 兜底 basename
    Comment   string `json:"comment"`    // PMX header: 说明（截断 200 字）
    HasThumb  bool   `json:"has_thumb"`  // 是否有缩略图（当前始终 false）
    Type      string `json:"type"`       // actor | motion | stage | dressing | bundle | effect | scene | other
    Format    string `json:"format"`     // pmx | vmd | zip
    Container string `json:"container"`  // file | zip
    ZipInner  string `json:"zip_inner"`  // zip 内相对路径（仅 container=zip）
    Category  string `json:"category"`   // DanceXR 分类目录名
}
```

**分类映射**：`dancexrCategories` 将 DanceXR 目录约定转为内部类型：

| 目录名 | 类型 | 说明 |
|--------|------|------|
| `actors/` | actor | 角色模型 |
| `motion/` `motions/` | motion | 动作文件 |
| `stage/` `stages/` | stage | 舞台/场景 |
| `dressing/` | dressing | 服装/配件 |
| `bundle/` `bundles/` | bundle | 捆绑包 |
| `effects/` | effect | 特效 |
| `scenes/` | scene | 场景预设 |

**扫描流程**：
1. 遍历 root 下级目录 → 识别 DanceXR 分类目录 → 递归扫描并打分类标签
2. 非分类目录 → 递归扫描 + type="other"
3. 同时扫描 root 自身的平铺文件（防漏）
4. 去重：PMXPath + ZipInner 联合键去重，优先保留分类扫描版本的条目

**文件类型处理**：
- `.pmx` → 调用 `ParsePMXHeader` 提取元数据，兜底用文件名
- `.vmd` → 用 basename 作为 NameEn
- `.zip` → `zip.OpenReader` 遍历条目，列出内部 .pmx/.vmd（不提取），container="zip"

#### 5.3 配置持久化

- **配置目录**：`os.UserConfigDir() + "/MikuMikuAR/"`（Windows = `%APPDATA%\MikuMikuAR\`）
- `config.json` — `{ "library_root": "..." }`
- `index.json` — `[]ModelEntry` 快照（上次扫描结果的 JSON 序列化）
- **启动流程**：前端 `GetConfig()` → 有 root → `GetLibraryIndex()` 秒开 → 后台 `ScanModelDir()` 刷新 → `SetLibraryRoot()` 重写 index

#### 5.4 前端弹窗 UI（`menus/library.ts` + `index.html`）

```
┌──────────────────────────────────┐
│         3D 视图                  │
│  ┌──────────────────────┐        │
│  │ 模型库 > 角色 > Miku ✕│        │  ← 面包屑
│  ├──────────────────────┤        │
│  │📁 Rin                      │        │  ← 文件夹可下钻
│  │📁 Len                      │        │
│  │🎭 初音未来           │        │  ← 点击加载
│  │🎭 鏡音リン   actor   │        │  ← 带分类标签
│  │💃 ヘイセイカタ       │        │  ← VMD 动作
│  └──────────────────────┘        │
│     🎵                           │  ← 底部入口图标
└──────────────────────────────────┘
```

- **入口**：底部 🎵 图标（`#bottomNav`），背景完全透明
- **弹窗**（`#modelPopup`）：280px 宽、max-height 400px，带 backdrop-filter 毛玻璃
- **面包屑**：路径分段可点击回退，popupStack 维护导航历史
- **列表**：竖向滚动，图标 + 标签 + 可选分类标签
- **导航**：文件夹行 → `navigateTo()` 推栈 → `renderPopup()` 刷新；面包屑 crumb 点击 → `popToLevel()` 按索引弹出
- **数据源**：`buildLevel(dir)` 从 flat `allModels[]` 中提取直接子模型 + 子文件夹列表，纯前端过滤，无需重复调用 Go

#### 5.x 体验增强功能

| 功能 | 实现文件 | 说明 |
|------|---------|------|
| 批量截图 | `menus/scene-menu.ts` + Go `SaveScreenshot` | 场景菜单 → 截图 → 截图当前 / 批量截图到目录，PNG 格式 |
| 近期播放 | `menus/library.ts` + Go `GetRecentModels`/`AddRecentModel` | 模型弹窗根菜单「最近打开」，最多 20 条，自动去重置顶 |
| 收藏 | `menus/library.ts` + Go `ToggleFavorite`/`GetFavorites` | 底层存储在标签系统（内置标签「收藏」），自动迁移旧数据 |
| 表情预览 | `menus/library.ts` + `scene/scene.ts` | 模型详情 → 表情预览，滑块调节所有 morph 权重 0~1，关闭弹窗自动重置 |
| 模型统计信息 | `menus/library.ts` | 模型详情 → 模型信息，显示顶点/面/骨骼/表情数等 PMX 元数据 |
| 导入文件 | `menus/library-core.ts` + `app.go` (`SelectImportFile`) | 模型库根菜单「导入文件」→ SAF 文件选择器（Android）/OS 对话框（桌面）→ 按扩展名自动路由：`.pmx` → `loadManager.load`，`.vmd` → `loadManager.load`，`.zip` → `ImportZip` + `refreshLibrary`。作为拖拽操作的触屏替代方案。 |

### 6. zip 容器

#### 6.1 解压流程

```
点击 zip 条目 → ExtractZip(zipPath, innerPath)
  ├─ cache 命中 → 直接返回解压后 PMX 路径
  └─ cache 未命中 → 全解到 cache → 写 manifest → 返回路径

→ loadPMXFile(解压后 PMX 路径)  →  StartFileServer(解压目录)  →  渲染
```

全解（而非只解目标文件）的原因：PMX 内贴图是相对路径，babylon-mmd 靠 HTTP 拉同目录下所有文件，必须保留完整目录结构。

#### 6.2 Cache 结构

```
%LOCALAPPDATA%\MikuMikuAR\extracted\
└── C__Users_models_miku_zip\    ← zipCacheName(源 zip 绝对路径转义)
    ├── manifest.json              ← {source, mtime, size}
    ├── model.pmx
    └── textures\                  ← zip 内目录结构完整保留
        └── face.bmp
```

- **cache 目录名**：`zipCacheName` 将绝对路径中的 `:` / `\` / 空格替换为 `_`
- **manifest 复用**：比对源 zip 的 mtime+size，一致则跳过解压直接返回缓存路径
- **清理**：`CleanOrphanCache` 遍历 extracted/ 下子目录，读 manifest → `os.Stat(source)` 失败 → 删除该 cache 目录

#### 6.3 安全防护

**zip slip 攻击防护**：解压每个条目前校验 `filepath.Join(dest, zf.Name)` 的绝对路径是否以 `dest` 为前缀。若发现 `../` 逃逸路径，跳过该条目并记录 warn 日志。

#### 6.4 复用链路

zip 解压后完全复用现有加载管道，零改动：
- `loadPMXFile(path)` — 解压后路径当普通 PMX 路径传入
- `StartFileServer(dir)` + `basenameFallbackFS` — 服务解压根目录
- `ParsePMXHeader` — 扫描时 zip 内 PMX 条目已读取元数据

#### 6.5 当前范围

| 场景 | 状态 |
|------|------|
| zip 内 PMX 解压加载 | ✅ 已实现 |
| zip 内 VMD 加载 | ❌ 暂未支持（VMD 常配特定模型，解压后链路与 PMX 不同） |
| zip 写入/打包 | ❌ 不在路线图中 |

### 7. 场景序列化（Week 8+）

#### 7.1 数据结构

场景保存为 `.mmascene`（JSON），包含：

```json
{
  "version": 1,
  "models": [
    {
      "filePath": "D:/lib/stages/stage.pmx",
      "libraryRef": "stages/stage.pmx",
      "name": "stage",
      "kind": "stage",
      "vmdPath": null,
      "vmdLibraryRef": null,
      "vmdName": "",
      "positionX": 0
    }
  ],
  "camera": { "mode": "orbit", "alpha": -1.57, "beta": 1.05, "radius": 16, ... },
  "lights": { "hemiIntensity": 0.8, "dirIntensity": 0.4, ... }
}
```

**库标识符（libraryRef）**：使用相对路径引用，主库模型为 `rel/path.pmx`，外部库模型为 `SourceName:rel/path.pmx`。加载时按当前配置解析，不依赖原始绝对路径。旧文件（无 libraryRef）仍通过 filePath 路径兜底。

#### 7.2 流程

```
保存：
  serializeScene()          → 从 modelRegistry/camera/lights 收集状态
  → JSON.stringify          → SelectSceneSaveFile() 选路径
  → SaveSceneFile(json, path)

加载：
  SelectSceneOpenFile()     → 选 .mmascene 文件
  → LoadSceneFile(path)     → JSON.parse
  → deserializeScene(data)
    ├─ 清空当前场景（逐个 removeModel）
    ├─ 逐模型：resolveLibraryRef() → filePath 兜底 → loadPMXFile
    ├─ 逐 VMD：resolveLibraryRef() → vmdPath 兜底 → loadVMDFromPath
    ├─ 恢复相机：setCameraState()
    └─ 恢复灯光：setLightState()

自动保存（后台防抖 2s）：
  场景变化 → triggerAutoSave() → SaveLastScene(JSON)
启动恢复：
  init() → tryRestoreLastScene() → LoadLastScene() → deserializeScene()
```

#### 7.3 自动保存

- **触发时机**：`arrangeModels()` 末尾（模型加载/删除/排序/动作加载后均调此函数）
- **防抖**：2 秒内多次变化只写一次，避免连续操作时频繁 IO
- **恢复**：app 启动时自动尝试恢复，失败静默（文件不存在/损坏/模型已被删除均不阻塞启动）

### 8. Stage 模型加载

stages/ 目录下的 PMX 加载为纯静态网格，不创建 MMD 运行时对象，不注册 WASM 物理引擎：

| 方面 | Actor | Stage |
|------|-------|-------|
| `mmdModel` | `MmdWasmModel` | `undefined` |
| `kind` | `"actor"` | `"stage"` |
| 物理 | ✅ WASM Bullet | ❌ |
| VMD 绑定 | ✅ | ❌（提示"舞台模型不支持 VMD"） |
| 场景图标 | 🎭 | 🏛️ |

视图层通过 `inst.kind` 区分，`mmdModel` 使用可选类型 `mmdModel?: MmdWasmModel`，所有访问处加 `?.` 安全调用。

### 9. 音乐播放系统（`outfit/audio.ts`）

原生 `HTMLAudioElement` 实现，不引入额外依赖。支持 MP3 / WAV / OGG。

#### 核心机制
- **VMD 同步**：`syncAudioPlayback(vmdTime, isPlaying, vmdDuration)` 每帧被 `runtime.onAnimationTickObservable` 调用，偏差 > 0.1s 时自动校正
- **音频偏移**：`audioOffset`（秒），正 = 音频先播，负 = 音频后播
- **循环**：VMD 循环时通过检测时间回退（`lastVmdTime > vmdTime + 0.5`）自动重置音频

#### 导出函数
| 函数 | 说明 |
|------|------|
| `loadAudioFile(path)` | 从本地路径加载音频 |
| `playAudio(url, name)` | 从 URL 播放 |
| `pauseAudio() / resumeAudio() / stopAudio() / clearAudio()` | 播放控制 |
| `setVolume(0-1) / getVolume()` | 音量 |
| `setAudioOffset(s) / getAudioOffset()` | 偏移 |
| `seekAudio(s) / getCurrentTime() / getDuration()` | 进度 |
| `isAudioPlaying() / getAudioName() / getAudioPath()` | 状态查询 |
| `syncAudioPlayback(time, playing, dur)` | VMD 同步（scene.ts 每帧调用） |

#### 场景序列化
音频状态（路径/音量/偏移/播放状态）写入 `SceneFile.audio`，支持 libraryRef 跨机器解析。

### 10. 相机 VMD（`scene/camera/camera.ts` + `scene/scene.ts`）

使用 babylon-mmd 内置的 `MmdCamera` 类，从 VMD 文件中提取相机轨道数据。

#### 相机模式：`vmd`
- 第 5 种相机模式，在现有 4 种（orbit/freefly/oneshot/concert）基础上新增
- 未加载相机 VMD 时切换到 vmd 模式会提示错误

#### 加载流程
```
VMD 文件 → VmdLoader → MmdAnimation → createRuntimeAnimation → MmdCamera
                                                           ↓
                                            animate(frameTime) 每帧更新
```

- **模型 VMD 加载时自动提取相机轨道**：`loadVMDMotion` 中顺带调用 `loadCameraVmd(mmdAnimation)`
- **也可单独加载**：`loadCameraVmdFromPath(path)` 从任意 VMD 文件加载相机轨道
- **清除**：`clearCameraVmd()` 移除 MmdCamera 并自动切回轨道相机

#### 时间同步
`scene.ts` 的 `onAnimationTickObservable` 每帧调用 `animateCameraVmd(runtime.currentTime * 30)`，把全局时间轴（秒）转成 30fps 帧号传给 MmdCamera。

#### 场景序列化
相机 VMD 写入 `SceneFile.cameraVmd`（path / name / active），支持 libraryRef。

### 12. 生态聚合（Week 7+）
- **DanceXR 共用**：扫描器已原生支持 DanceXR 8 种分类目录约定。外部库挂载已实现：通过 `Config.ExternalPaths` 配置多源联合扫描，弹窗根层显示 🔌 虚拟入口，下钻复用 `buildLevel` 导航链路。条目带 `Source` 标签区分来源。
- **下载目录监听**：fsnotify 监听下载目录新文件（.zip）→ 通知用户确认导入。原生 HTTP 下载拦截（早期计划中的方案 C）因 WebView2 限制未实现，不列入路线图。
- **Blender 唤起**：Wails `exec.Command` 启动本地 Blender + 传模型路径参数
- **Android**：发版测试中，全链路需兼容安卓端（Wails mobile 桥接 + 文件系统沙盒适配 + 触摸交互优化）

### 13. 目录结构

> 更新于 2026-07-17（ADR-113~121 新增模块）

```
MikuMikuAR/
├── internal/
│   ├── app/
│   │   ├── app.go             # ★ Go 后端入口（Wails Binding 核心）
│   │   ├── library.go         # 库扫描 + 配置持久化
│   │   ├── zipextract.go      # zip 解压 + 缓存 + 文件服务器
│   │   ├── watch.go           # 下载目录监听 + 自动导入
│   │   ├── proxy.go           # 模型广场反向代理 + Cookie 中继
│   │   ├── integration.go     # Blender/MMD 唤起 + 场景/环境预设
│   │   ├── render_preset.go   # 渲染预设
│   │   ├── scene_preset.go    # 场景预设
│   │   ├── model_preset.go    # 模型预设
│   │   ├── tags.go            # 标签系统
│   │   ├── thumbnail.go       # 缩略图 + 截图
│   │   ├── plaza_config.go    # 广场配置获取
│   │   ├── plaza_window.go    # 广场窗口管理
│   │   ├── update.go          # 版本更新检查
│   │   └── httpserver.go      # 文件服务器 + 安全隔离
│   └── util/
│       └── pmx.go             # PMX Header 二进制解析
├── main.go                 # Wails 应用入口
├── go.mod / go.sum         # Go 依赖
├── wails.json              # Wails 项目配置
└── frontend/
    └── src/
        ├── core/                     # ★ 基础设施
        │   ├── main.ts               # 应用入口（事件绑定 + 快捷键 + 初始化）
        │   ├── config.ts             # barrel re-export → types.ts / state.ts / dom.ts / utils.ts
        │   ├── types.ts              # 全局类型定义
        │   ├── state.ts              # UI/环境状态管理
        │   ├── fileservice.ts        # resolveFileUrl 统一文件 URL 解析
        │   ├── dialog.ts             # 通用对话框
        │   ├── reactivity.ts         # 简易响应式（signal / effect）
        │   ├── wails-bindings.ts     # Wails Go binding 类型封装（手维护）
        │   ├── audio-bus.ts          # 音效总线（ADR-088）
        │   ├── load-manager.ts       # 资源加载管理器
        │   ├── shortcut-registry.ts  # 快捷键注册表
        │   ├── status-bar.ts         # 状态栏组件
        │   ├── toast.ts              # Toast 提示
        │   ├── platform.ts           # 平台判断（桌面 vs Android）
        │   ├── icons.ts              # Iconify 图标创建
        │   ├── icons-bundle.ts       # 本地图标包
        │   ├── orbit.ts              # 轨道控制
        │   ├── ui-helpers.ts         # DOM 构建工具（slideRow / addToggleRow 等）
        │   ├── ui-types.ts           # UI 组件类型定义
        │   ├── ui-rows.ts            # 通用行组件
        │   ├── ui-slide-row.ts       # 滑块行
        │   ├── ui-advanced-rows.ts   # 高级行组件
        │   ├── ui-collapsible.ts     # 可折叠面板
        │   ├── ui-fullscreen-overlay.ts # 全屏覆盖层
        │   ├── ui-virtual-grid.ts    # 虚拟网格
        │   ├── ui-resource-panel.ts  # 资源面板（目录记忆，ADR-090）
        │   └── i18n/                 # 国际化（5 语言：zh-CN/zh-TW/ja/en/ko）
        │
        ├── scene/                    # 3D 场景（Babylon.js）
        │   ├── scene.ts              # ★ 场景编排入口
        │   ├── scene-bundle.ts       # 场景模块聚合导出
        │   ├── scene-serialize.ts    # 场景序列化
        │   ├── camera/               # 相机模式
        │   ├── render/               # 渲染管线
        │   │   ├── renderer.ts       # 渲染器
        │   │   ├── lighting.ts       # 灯光管理
        │   │   ├── lighting-presets.ts # 灯光预设
        │   │   ├── performance.ts    # 性能监控
        │   │   └── transform-gizmo.ts # 变换控制器
        │   ├── manager/              # 模型管理
        │   │   ├── model-manager.ts  # 模型管理器
        │   │   ├── model-loader.ts   # 模型加载器
        │   │   ├── model-ops.ts      # 模型操作
        │   │   └── material.ts       # 材质管理
        │   ├── motion/               # ★ 动作桥接层（ADR-079 感知层 + ADR-086 猫步）
        │   │   ├── perception.ts     # 感知层总入口（呼吸/眨眼/注视/表情/平衡/LipSync）
        │   │   ├── perception-balance.ts    # 平衡系统
        │   │   ├── perception-blinking.ts   # 眨眼系统
        │   │   ├── perception-breathing.ts  # 呼吸系统
        │   │   ├── perception-expression.ts # 表情系统
        │   │   ├── perception-gaze.ts       # 注视系统（总入口）
        │   │   ├── perception-gaze-js.ts    # 注视 JS 实现
        │   │   ├── perception-gaze-wasm.ts  # 注视 WASM 实现
        │   │   ├── perception-lipsync.ts    # LipSync 层
        │   │   ├── perception-shared.ts     # 共享工具
        │   │   ├── feet-adjustment.ts       # 脚部地面跟随（ADR-085）
        │   │   ├── footstep.ts              # 脚步声触发（ADR-088）
        │   │   ├── bone-override.ts         # 骨骼覆盖 → Motion Override（ADR-116）
        │   │   ├── vmd-layers.ts            # VMD 图层管理
        │   │   ├── wasm-layers-blender.ts   # WASM 图层混合器
        │   │   ├── wasm-layers-config.ts    # WASM 图层配置
        │   │   ├── vmd-loader.ts            # VMD 加载器
        │   │   ├── proc-motion-bridge.ts    # 程序化动作桥接
        │   │   ├── lipsync-bridge.ts        # LipSync 桥接
        │   │   ├── animation-retargeter.ts  # 骨骼映射 + 动作重定向（ADR-108）
        │   │   └── playback.ts              # 播放控制
        │   ├── physics/              # 物理（WASM Bullet）
        │   │   ├── skirt-analyzer.ts  # 裙装分析器（ADR-084）
        │   │   └── virtual-skirt.ts   # 虚拟裙骨（ADR-084）
        │   ├── env/                  # ★ 环境系统（ADR-091/092 贴图与反射统一）
        │   │   ├── env.ts             # 环境状态总入口
        │   │   ├── env-impl.ts        # 环境实现
        │   │   ├── env-bridge.ts      # 环境桥接
        │   │   ├── env-terrain.ts     # 地形（ADR-089 模式拆分）
        │   │   ├── env-texture.ts     # 纹理工厂（ADR-091）
        │   │   ├── env-water.ts       # 水面 + 平面反射（ADR-092）
        │   │   ├── env-clouds.ts      # 体积云（ADR-113 地平线延展 + 自适应步长 + 双瓣散射）
        │   │   ├── env-ground.ts      # 地面 PBR 材质 + 程序化木纹 + 反射模糊 + 接触阴影（ADR-114）
        │   │   ├── env-particles.ts   # 粒子
        │   │   ├── env-lighting.ts    # 环境灯光
        │   │   ├── accessory.ts       # 配件
        │   │   ├── props.ts           # 道具
        │   │   └── planar-reflection.ts # 平面反射引擎（ADR-092）
        │   ├── ar/                   # AR 场景（ADR-055）
        │   │   ├── ar-camera.ts
        │   │   └── ar-scene.ts
        │   └── pose/                 # 构图与水印
        │       ├── camera-angle.ts
        │       ├── composition-guide.ts
        │       └── watermark.ts
        │
        ├── menus/                    # ★ 声明式菜单系统（ADR-093 Schema 全量落地）
        │   ├── menu.ts               # 通用菜单导航组件
        │   ├── menu-schema.ts        # ★ 声明式 Schema 核心（ControlSpec / MenuNode / StatePath）
        │   ├── menu-factory.ts       # Schema 渲染器
        │   │
        │   │── library.ts            # 模型库主菜单
        │   │── library-core.ts       # 库核心（扫描/搜索/层级/标签）
        │   │── model-detail.ts       # 模型详情
        │   │── model-material.ts     # 材质编辑器
        │   │── model-preset.ts       # 预设管理
        │   │
        │   ├── env-menu.ts           # 环境菜单总入口
        │   │── env-feature-levels.ts # 环境功能层级
        │   │── env-preset-levels.ts  # 环境预设层级（ADR-120 分类化：天空/地面/水面/大气）
        │   │
        │   │── motion-popup.ts       # 动作菜单总入口
        │   │── motion-camera-levels.ts    # 相机控制
        │   │── motion-cloth-levels.ts     # 布料质量（ADR-084）
        │   │── motion-feet-levels.ts      # 脚部调整（ADR-085）
        │   │── motion-gaze-levels.ts      # 注视控制
        │   │── motion-override-levels.ts  # 骨骼覆盖
        │   │── motion-pose-levels.ts      # 姿势控制
        │   │── motion-procmotion-levels.ts # 程序化动作
        │   │
        │   │── scene-menu.ts         # 场景菜单总入口
        │   │── scene-physics-levels.ts    # 物理设置
        │   │── scene-prop-levels.ts       # 道具管理
        │   │── scene-render-levels.ts     # 渲染设置
        │   │── scene-render-presets.ts    # 渲染预设
        │   │── scene-stage-levels.ts      # 舞台设置
        │   │── scene-stage-lights.ts      # 舞台灯光
        │   │
        │   │── settings.ts           # 设置页总入口
        │   │── settings-appearance.ts     # 外观主题
        │   │── settings-audio.ts          # 音频设置
        │   │── settings-external.ts       # 外部库
        │   │── settings-filename.ts       # 文件命名
        │   │── settings-language.ts       # 语言
        │   │── settings-paths.ts          # 路径管理
        │   │── settings-performance.ts    # 性能设置
        │   │── settings-screenshot.ts     # 截图设置
        │   │── settings-shared.ts         # 共享配置
        │   │── settings-shortcuts.ts      # 快捷键
        │   │── settings-software.ts       # 软件管理
        │   │── settings-targets.ts        # 输出目标
        │   │
        │   │── outfit-ui.ts              # 换装 UI
        │   │── plaza.ts                  # 模型广场
        │   │── plaza-sites.ts            # 广场站点列表
        │   │── preset-list-viewer.ts     # 预设列表查看器
        │   │── resource-detail-helpers.ts # 资源详情辅助
        │   │── render-menu.ts            # 渲染菜单（遗留，待 ADR-093 迁移）
        │   │
        │   └── __tests__/              # 单元测试
        │
        ├── motion-algos/             # ★ 动作生成算法层（无 Babylon 依赖）
        │   ├── procedural-motion.ts  # barrel re-export → shared / idle / autodance / lifelike
        │   ├── proc-motion-shared.ts  # 类型定义 + 骨骼候选名 + 常量
        │   ├── proc-motion-idle.ts    # Idle VMD（呼吸+眨眼）
        │   ├── proc-motion-autodance.ts       # AutoDance 主流程
        │   ├── proc-motion-autodance-bones.ts       # 骨骼动作生成（骨架）
        │   ├── proc-motion-autodance-bones-limbs.ts # 四肢骨骼
        │   ├── proc-motion-autodance-bones-trunk.ts # 躯干骨骼
        │   ├── proc-motion-autodance-emotion.ts     # 情绪动作
        │   ├── proc-motion-lifelike.ts  # Lifelike（微动叠加层）
        │   ├── vmd-writer.ts            # VMD 二进制写入（Shift-JIS）
        │   ├── vmd-evaluator.ts         # VMD 多图层混合求值器
        │   ├── vpd-parser.ts            # VPD 姿势解析→VMD
        │   ├── beat-detector.ts         # 节拍检测（Web Audio API）
        │   ├── lipsync.ts               # 振幅→morph 权重
        │   ├── feet-adjustment-math.ts  # 脚部调整数学（ADR-085）
        │   ├── footstep-detect.ts       # 脚步声检测（ADR-088）
        │   └── pose-preset.ts           # 姿势预设
        │
        ├── outfit/                   # 换装系统
        │   ├── outfit.ts           # 加载/应用/重置 + 自动发现
        │   ├── outfit-overlay.ts   # 换装覆盖层
        │   └── audio.ts            # 音频播放 + VMD 同步 + 节拍检测
        │
        ├── physics/                  # 物理辅助（XPBD 已移除，布料由 WASM Bullet 驱动）
        │   ├── physics-bridge.ts   # 物理桥接
        │   └── wind-physics.ts     # 风场辅助函数
        │
        ├── __tests__/                # 测试夹具
        │   ├── mocks/
        │   └── setup-wails.ts
        │
        └── app.css                   # 全局样式（CSS 变量体系）
```

### 14. 视线追踪子系统（`scene/motion/proc-motion-bridge.ts`）

[doc:architecture] 视线追踪 — 骨骼变换覆写机制

实现头部跟随相机、眼球跟随相机的程序化动作。核心挑战是在 VMD 动画播放期间，安全地覆写特定骨骼的旋转向量，且不破坏骨骼层级传播。

#### 运行时切换

通过环境变量 `VITE_MMD_RUNTIME` 切换 MmdRuntime 实现：

| 值 | 运行时 | 物理 | 视线追踪 |
|----|--------|------|---------|
| 未设或非 `js` | `MmdWasmRuntime` | WASM Bullet | 不可用（双缓冲覆盖写入） |
| `js` | `MmdRuntime` | 无 | 可用 |

原因：WASM 版 `worldTransformMatrices` 采用双缓冲，`mmdRuntime.update()` 后任意写入都会在下一帧被还原。JS 版无此机制，写入可生效。切换点在 `scene/scene.ts:initScene`。

#### 变换覆写机制

直接写 `runtimeBone.worldMatrix` 无效——它是 `worldTransformMatrices` 的切片视图，但渲染管线读的是 `_computeTransformMatrices` 输出的 `targetMatrix`，且该函数在 `mmdRuntime.update()` 末尾的 `_markAsDirty` 时已经执行完毕，之后不会再跑。

正确做法是修改 `linkedBone.rotationQuaternion`（局部旋转），然后手动触发骨骼链重算：

```typescript
// 1. 计算目标世界旋转（头部朝向相机）
const lookDir = headPos.subtract(cam.position).normalize();
const targetWorldQ = Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly);
const blended = Quaternion.Slerp(oldHeadRotQ, targetWorldQ, 0.3);

// 2. 世界旋转 → 局部旋转（左乘父骨骼世界逆）
//    公式：worldRot = parentWorldRot × localRot → localRot = parentWorldRot⁻¹ × worldRot
const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
const localQ = parentInvQ.multiply(blended);  // 注意乘法顺序：父逆左乘

// 3. 写入 linkedBone（不是 worldMatrix）
headRuntime.linkedBone.rotationQuaternion = localQ;

// 4. 手动重算骨骼链（父骨骼影响子骨骼位置和旋转）
const updateBoneChain = (rb: IMmdRuntimeBone) => {
    (rb as any).updateWorldMatrix?.(false, false);
    for (const child of rb.childBones) updateBoneChain(child);
};
updateBoneChain(headRuntime);

// 5. 触发 skeleton 重算，把新 worldMatrix 刷到渲染矩阵
(mmdModel.mesh.metadata as any).skeleton?._markAsDirty?.();
```

#### 执行时序

```
onBeforeRenderObservable
  ├─ mmdRuntime.update()          // VMD 求解，写 worldTransformMatrices
  │   └─ skeleton._markAsDirty()  // 触发 _computeTransformMatrices（读旧值）
  └─ gaze observer（本子系统）    // 改 linkedBone → updateWorldMatrix → _markAsDirty
      └─ skeleton._markAsDirty()  // 再次触发 _computeTransformMatrices（读新值）
```

gaze observer 必须在 `mmdRuntime.update()` 之后注册，确保覆盖 VMD 写入的 `linkedBone.rotationQuaternion`。

#### 关键陷阱

| 陷阱 | 现象 | 原因 |
|------|------|------|
| 直接写 `worldMatrix` | 子骨骼位置留在原地 | 绕过骨骼层级，子骨骼 worldMatrix 不会基于新父骨骼值重算 |
| 四元数乘法顺序反 | 头部朝固定错误方向 | `blended × parentInv` ≠ `parentInv × blended`，后者才正确 |
| `lookDir` 方向反 | 头部背对相机 | `FromLookDirectionRH` 的 forward 是相机朝向，取 `headPos - camPos` 让物体朝相机看 |
| WASM 版写入 | 写入后被还原 | 双缓冲机制，`mmdRuntime.update()` 用后缓冲覆盖前缓冲 |

#### 涉及文件

| 文件 | 角色 |
|------|------|
| `scene/scene.ts` | 运行时切换（`VITE_MMD_RUNTIME`） |
| `scene/motion/proc-motion-bridge.ts` | gaze observer 实现 |
| `core/types.ts` | `RuntimeModel` 扩展类型（`IMmdModel` + `setRuntimeAnimation`/`createRuntimeAnimation`） |

### 15. 模块依赖关系

```
core/main.ts
 ├── core/state.ts
 ├── scene/scene.ts         initScene / tryRestoreLastScene
 ├── scene/camera/camera.ts freeflyInput / getCameraMode
 ├── menus/library.ts      initLibrary / togglePopup / showMotionPopup
 ├── menus/settings.ts     showSettings
 ├── menus/scene-menu.ts   showSceneMenu
 └── Wails Runtime         OnFileDrop / EventsOn

scene/scene.ts
 ├── core/state.ts + utils.ts    状态读写、工具函数
 ├── scene/camera/camera.ts      autoFrame / getCameraState / setCameraState / animateCameraVmd / ...
 ├── outfit/audio.ts             syncAudioPlayback / loadAudioFile / ...
 ├── core/fileservice.ts         resolveFileUrl
 └── Wails Binding               SaveThumbnail / SaveLastScene / LoadLastScene

outfit/audio.ts
 └── core/fileservice.ts   resolveFileUrl

menus/library.ts
 ├── core/state.ts + types.ts + utils.ts  状态、类型、工具
 ├── scene/scene.ts        loadPMXFile / loadVMDFromPath / focusModel / removeModel
 ├── outfit/audio.ts       loadAudioFile / setAudioOffset
 ├── menus/menu.ts          MenuStack
 └── Wails Binding          GetConfig / ScanModelDir / ExtractZip / ...

menus/settings.ts
 ├── core/state.ts        状态
 ├── menus/menu.ts          MenuStack
 ├── menus/library.ts       showPopup / rescanAndSync / reloadConfig
 └── Wails Binding          SetDisplayNamePriority / ...

menus/scene-menu.ts
 ├── core/state.ts + types.ts    状态、类型
 ├── menus/menu.ts                MenuStack
 ├── scene/camera/camera.ts      switchCameraMode / getCameraMode / hasCameraVmd / ...
 ├── scene/scene.ts               triggerAutoSave / serializeScene / deserializeScene / getRenderState / ...
 ├── outfit/audio.ts              loadAudioFile / pauseAudio / resumeAudio / ...
 └── Wails Binding                SelectSceneSaveFile / SaveSceneFile / SelectAudioFile / ...

scene/camera/camera.ts
 └── core/state.ts        focusedModelId

core/fileservice.ts
 └── Wails Binding    StartFileServer / IsolateModelDir
```

### 16. ~~XPBD 布料模拟~~（已移除）

> **状态**：已移除（commit 530af6e）。XPBD(TS) 布料系统与 PMX 内建 WASM Bullet 物理存在功能重叠，维护成本高于收益。布料/头发摆动由 WASM Bullet 刚体驱动，不再需要独立 XPBD 求解器。

### 17. 换装系统（Outfit System）

#### 17.1 概述

换装系统允许用户为同一 PMX 模型切换不同纹理贴图（多纹理变体），支持两种模式：

| 模式 | 说明 | 优先级 |
|------|------|--------|
| **显式配置** | `outfits.json` 精确指定变体/槽位/作用域 | 高（先检查） |
| **自动发现** | 扫描模型目录子目录，自动匹配同名纹理文件 | 低（无 json 时回退） |

#### 17.2 数据流

```
loadOutfits(id)
  ├─ 1. LoadOutfitFile(pmxPath) → 读取 <modelDir>/outfits.json
  │    └─ 解析成功 → 存入 inst.outfitFile → 返回
  └─ 2. 自动发现（outfits.json 不存在时）
       ├─ _collectOrigTextureBasenames(inst) — 从材质收集所有纹理 basename
       ├─ ListSubDirs(modelDir) — Go binding 列一级子目录
       └─ 对每子目录: HEAD 探测各槽位纹理 basename → 生成 OutfitVariant

applyOutfitVariant(id, variantName)
  ├─ 首次调用时备份 _origTextures（逐材质 × 5 槽位快照）
  ├─ 查找 variant → 三层混合优先级: byMaterial > byCategory > all
  ├─ _applySlot: dispose 旧非原始贴图 → 新 Texture / 恢复原始
  └─ 更新 inst.activeVariant → triggerAutoSave()
```

#### 17.3 变体配置格式（`outfits.json`）

参见 [outfits-spec.md](outfits-spec.md)。

#### 17.4 三层混合优先级

```
每槽位最终值 = byMaterial[name] ?? byCategory[cat] ?? all ?? 原始贴图
```

- `byMaterial` — 按材质名精确匹配（大小写不敏感）
- `byCategory` — 按部位分类（皮肤/头发/眼睛/服装，复用 `_catOf`）
- `all` — 全局覆盖所有材质
- 未指定的槽位保持原始贴图

#### 17.5 关键文件

| 文件 | 职责 |
|------|------|
| `internal/app/app.go:LoadOutfitFile` | Go binding: 读 outfits.json |
| `internal/app/app.go:ListSubDirs` | Go binding: 列子目录（自动发现） |
| `core/types.ts:OutfitFile/OutfitVariant/OutfitSlot` | 类型定义 |
| `outfit/outfit.ts:loadOutfits` | 加载 + 自动发现 |
| `outfit/outfit.ts:applyOutfitVariant` | 核心贴图替换（含 _origTextures 快照） |
| `outfit/outfit.ts:resetOutfit` | 回退原始贴图 |
| `menus/outfit-ui.ts:buildOutfitLevel` | UI 子菜单 |
| `menus/model-preset.ts:ModelPresetFile.outfitVariant` | 预设序列化 |
| `scene/scene-serialize.ts:SceneFile.model.outfitVariant` | 场景序列化 |

#### 17.6 序列化集成

| 载体 | 字段 | 说明 |
|------|------|------|
| `.mcupreset.json` | `outfitVariant` | 预设保存/加载时自动包含 |
| `.mmascene` | `models[].outfitVariant` | 场景保存/恢复时自动包含 |

#### 17.7 边界与限制

| # | 场景 | 处理 |
|---|------|------|
| 1 | 变体内贴图路径不存在 | 404 → 静默保持原贴图 |
| 2 | byMaterial 名大小写/空格不一致 | 当前精确匹配，未做归一化 |
| 3 | 切换变体后 dispose 旧贴图 | `_applySlot` 严格 dispose 非 orig 贴图 |
| 4 | zip 内模型无 outfits.json | 仅自动发现（需 zip 内包含子目录结构） |
| 5 | 多模型共享同纹理 | 各自 inst._origTextures 独立备份 |



### 18. VMD 图层系统（`scene/motion/vmd-layers.ts`）

#### 18.1 概述

VMD 图层系统允许在基础 VMD 之上叠加多个局部动作图层，通过 `MmdCompositeAnimation` 按权重混合骨骼变换。每个图层可指定 `boneFilter` 只控制特定骨骼，其余骨骼穿透到基础层。

#### 18.2 数据结构

```typescript
interface VmdLayer {
    id: string;              // crypto.randomUUID()
    name: string;            // 显示名称（通常是 VMD 文件名）
    path: string | null;     // 文件路径（null = 程序化生成）
    data: ArrayBuffer;       // VMD 二进制数据
    enabled: boolean;        // 是否参与混合
    weight: number;          // 混合权重 0~1
    boneFilter?: string[];   // 可选：只控制这些骨骼（其他穿透）
}

interface VmdLayerSerialized {
    path: string | null;
    name: string;
    weight: number;
    enabled: boolean;
    boneFilter?: string[];
}
```

图层数据存储在 `RuntimeModel.vmdLayers: VmdLayer[]`（`core/state.ts`）。

#### 18.3 核心函数

| 函数 | 说明 |
|------|------|
| `addVmdLayer(modelId, name, data, boneFilter?)` | 添加图层，自动 rebuild |
| `addVmdLayersFromPaths(modelId, paths, boneFilter?)` | 批量添加（一次 rebuild），供反序列化用 |
| `removeVmdLayer(modelId, layerId)` | 删除图层，自动 rebuild |
| `toggleVmdLayer(modelId, layerId, enabled)` | 开关图层 |
| `setVmdLayerWeight(modelId, layerId, weight)` | 调整权重 |
| `clearVmdLayers(modelId)` | 清除所有图层 |
| `_rebuildCompositeAnimation(modelId)` | 重建复合动画（核心函数） |

#### 18.4 Composite 混合机制（`_rebuildCompositeAnimation`）

三种路径，按条件选择：

| 条件 | 路径 | 行为 |
|------|------|------|
| 无图层 | 单 VMD | 回退到 `loadVMDMotion(inst.vmdData)` |
| 1 图层 + 无基础 VMD | 单 VMD（零拷贝优化） | 直接加载该图层 |
| 多图层 / 有基础 VMD | MmdCompositeAnimation | 构建 composite + 权重归一化 |

##### 权重归一化

```typescript
const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
const normalizedWeight = totalWeight > 0 ? src.weight / totalWeight : 0;
```

各 span 权重归一化到和 = 1.0，防止旋转插值溢出。

#### 18.5 boneFilter — 骨骼级过滤

##### 为什么不在 MmdBoneAnimationTrack 层面做

`MmdBoneAnimationTrack` 内部使用 typed array + 二进制布局，无公开 API 安全移除轨道。改写会破坏内存结构且不可逆。

##### VMD 二进制过滤方案

在 VMD 二进制层面过滤骨骼帧：

```
VMD 头部 (54B) — 签名(30) + 模型名(20) + 骨骼帧数(uint32)
  ├─ 骨骼帧 [0]  — 111B: 骨骼名(15) + 位置(12) + 旋转(16) + 插值曲线(68)
  ├─ 骨骼帧 [1]  — 111B
  ├─ ...
  ├─ 骨骼帧 [N-1] — 111B
  └─ 尾部 — morph 帧 + 相机/light/shadow/ik 数据
```

过滤流程：
1. 读骨骼帧数（offset 50）
2. 遍历每帧 111B，解码骨骼名（Shift-JIS → UTF-8）
3. 只保留匹配 `boneFilter` 的帧
4. 全匹配 → 返回原 `ArrayBuffer` 引用（零拷贝）
5. 部分匹配 → 重建二进制：头部(54B) + 新帧数 + 保留帧 + 完整尾部

**插值曲线完整保留**：每帧 111B 整块复制，68B 插值曲线不需要重新解析。

##### 解码依赖

`encoding-japanese` 库解码 Shift-JIS（VMD 标准编码）。

#### 18.6 WASM 运行时回退

`MmdWasmRuntime` 不支持 `MmdCompositeAnimation`。检测到 WASM 时：

```typescript
if (mmdRuntime instanceof MmdWasmRuntime) {
    console.warn(`[MotionLayers] WASM runtime: only primary layer supported`);
    // 只加载第一个源
    await loadVMDMotion(primarySrc.data, primarySrc.name, modelId);
    setStatus('⚠ WASM 仅支持单图层', false);
    return;
}
```

JS 运行时（`VITE_MMD_RUNTIME=js`）完整支持。

#### 18.7 场景序列化

图层配置存储在 `SceneFile` 的 `models[].vmdLayers` 数组：

```json
{
    "vmdPath": "base.vmd",
    "vmdLayers": [
        { "path": "handwave.vmd", "name": "handwave", "weight": 0.8, "enabled": true, "boneFilter": ["左手親指", "左手人指"] }
    ]
}
```

反序列化使用 `addVmdLayersFromPaths` 批量 API，避免 N 次 rebuild（详情见 [ADR-051](adr/adr-051-vmd-layers-bonefilter.md)）。

#### 18.8 与视线追踪的关系（参见 ADR-016）

视线追踪在 `onBeforeRenderObservable` 中覆写特定骨骼的局部旋转。VMD 图层的 boneFilter 则是在加载层面过滤骨骼帧，两者互补：
- **boneFilter**：让图层只控制指定骨骼，其他骨骼不动（适合左手/头/上半身等粗粒度区域）
- **视线追踪**：每帧动态覆写头部/眼球骨骼旋转（需要运行时交互）

---

