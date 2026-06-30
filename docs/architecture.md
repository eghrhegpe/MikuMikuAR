# MikuMikuAR 架构与技术方案

基于 MikuMikuAR 的架构（Wails + Go 后端 + babylon-mmd 前端），下面是各环节技术方案的简要梳理：

### 1. Wails 应用骨架
- **技术**：Wails v2（Go + WebView）
- **职责**：原生桌面壳，桥接 Go 后端与前端 TS
- **后端**：Go 处理文件 I/O（`app.go`），暴露绑定方法给前端调用（读 PMX、列目录、解 zip、目录选择）

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

### 4.5 前端工具链

#### ESLint + Prettier
- **ESLint 8** + `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`（规则详情见 `.eslintrc.cjs`）
- **Prettier 3** 统一格式化：单引号、4 空格缩进、LF 换行、`trailingComma: "es5"`
- **集成方式**：`eslint-config-prettier` 关闭与 Prettier 冲突的 ESLint 规则；`eslint-plugin-prettier` 将 Prettier 作为 ESLint 规则运行
- **npm scripts**：
  ```
  npm run lint         # ESLint 检查
  npm run lint:fix     # 自动修复
  npm run format       # Prettier 格式化全部文件
  npm run format:check # CI 中检查格式
  ```

#### 测试
- **Vitest 4**（单元/集成测试）：`npm run test` / `npm run test:watch`
- **Playwright 1.61**（E2E 测试）：`npm run test:e2e` / `npm run test:e2e:headed`

### 5. 模型库管理

#### 5.1 PMX Header 解析（`pmx.go`）

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

#### 5.2 库目录扫描（`app.go:ScanModelDir`）

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

#### 5.4 前端弹窗 UI（`library.ts` + `index.html`）

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
| 批量截图 | `scene-menu.ts` + Go `SaveScreenshot` | 场景菜单 → 截图 → 截图当前 / 批量截图到目录，PNG 格式 |
| 近期播放 | `library.ts` + Go `GetRecentModels`/`AddRecentModel` | 模型弹窗根菜单「最近打开」，最多 20 条，自动去重置顶 |
| 收藏 | `library.ts` + Go `ToggleFavorite`/`GetFavorites` | 底层存储在标签系统（内置标签「收藏」），自动迁移旧数据 |
| 表情预览 | `library.ts` + `scene.ts` | 模型详情 → 表情预览，滑块调节所有 morph 权重 0~1，关闭弹窗自动重置 |
| 模型统计信息 | `library.ts` | 模型详情 → 模型信息，显示顶点/面/骨骼/表情数等 PMX 元数据 |

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

### 8. 场景序列化（Week 8+）

#### 8.1 数据结构

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

#### 8.2 流程

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

#### 8.3 自动保存

- **触发时机**：`arrangeModels()` 末尾（模型加载/删除/排序/动作加载后均调此函数）
- **防抖**：2 秒内多次变化只写一次，避免连续操作时频繁 IO
- **恢复**：app 启动时自动尝试恢复，失败静默（文件不存在/损坏/模型已被删除均不阻塞启动）

### 9. Stage 模型加载

stages/ 目录下的 PMX 加载为纯静态网格，不创建 MMD 运行时对象，不注册 WASM 物理引擎：

| 方面 | Actor | Stage |
|------|-------|-------|
| `mmdModel` | `MmdWasmModel` | `undefined` |
| `kind` | `"actor"` | `"stage"` |
| 物理 | ✅ WASM Bullet | ❌ |
| VMD 绑定 | ✅ | ❌（提示"舞台模型不支持 VMD"） |
| 场景图标 | 🎭 | 🏛️ |

视图层通过 `inst.kind` 区分，`mmdModel` 使用可选类型 `mmdModel?: MmdWasmModel`，所有访问处加 `?.` 安全调用。

### 13. 音乐播放系统（`audio.ts`）

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

### 14. 相机 VMD（`camera.ts` + `scene.ts`）

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

### 15. 舞蹈套装（`library.ts` + Go `DanceSet`）

套装 = VMD 动作 + 音频 + 偏移 + 描述，一键加载。

#### 数据结构（Go）
```go
type DanceSet struct {
    Name        string  // 套装名称
    VmdPath     string  // VMD 文件路径
    AudioPath   string  // 音频文件路径
    AudioOffset float64 // 音频偏移（秒）
    Description string  // 描述
    Thumbnail   string  // 缩略图 base64
    Source      string  // 来源库名
}
```
存储在 `Config.DanceSets`（map[string]DanceSet）。

#### Go Binding
- `GetDanceSets() []DanceSet`
- `SaveDanceSet(id, ds) error`
- `DeleteDanceSet(id) error`
- `ImportDanceSet(vmdPath, audioPath, name) (string, error)`

#### 前端
- 模型库根菜单 → 「舞蹈套装」入口
- 列表页 → 详情页 → 一键加载
- 一键加载：VMD → 当前聚焦模型 + 音频自动播放 + 偏移应用

### 7. 生态聚合（Week 7+）
- **DanceXR 共用**：扫描器已原生支持 DanceXR 8 种分类目录约定。外部库挂载已实现：通过 `Config.ExternalPaths` 配置多源联合扫描，弹窗根层显示 🔌 虚拟入口，下钻复用 `buildLevel` 导航链路。条目带 `Source` 标签区分来源。
- **模之屋下载接管**：拦截下载链接 → Wails 走原生 HTTP 下载 → 落库到模型目录（绕开浏览器下载）
- **Blender 唤起**：Wails `exec.Command` 启动本地 Blender + 传模型路径参数
- **Android**：远期，考虑 Wails mobile 或 React Native + JS 端重做渲染

### 10. 目录结构

```
MikuMikuAR/
├── app.go                  # ★ Go 后端入口（Wails Binding 核心）
├── pmx.go                  # PMX Header 二进制解析
├── main.go                 # Wails 应用入口
├── go.mod / go.sum         # Go 依赖
├── wails.json              # Wails 项目配置
└── frontend/
    └── src/
        ├── core/
        │   ├── main.ts         # ★ 前端入口（初始化 + 事件绑定）
        │   ├── config.ts       # 共享状态 + DOM 引用 + 工具函数
        │   ├── fileservice.ts  # 统一文件 URL 解析层
        │   ├── ui-helpers.ts   # DOM 构建函数
        │   └── icons.ts        # Iconify 图标注册表
        ├── scene/
        │   ├── scene.ts        # 3D 场景 + 模型加载 + 播放控制
        │   ├── scene-model.ts  # ModelManager（模型注册表 + 生命周期）
        │   ├── scene-material.ts  # 材质系统
        │   ├── scene-vmd.ts    # VMD 加载
        │   ├── scene-playback.ts  # 播放 UI
        │   ├── camera.ts       # 相机模式管理
        │   └── env-lighting.ts # 环境光照
        ├── menus/
        │   ├── menu.ts         # MenuStack 通用导航栈
        │   ├── library.ts      # 模型库弹窗 + 搜索
        │   ├── library-core.ts # 模型库核心逻辑
        │   ├── model-detail.ts # 模型详情子菜单
        │   ├── model-material.ts  # 材质调参子菜单
        │   ├── model-preset.ts # 模型预设
        │   ├── motion-popup.ts # 动作库弹窗
        │   ├── scene-menu.ts   # 场景弹窗
        │   ├── env-menu.ts     # 环境弹窗
        │   ├── outfit-ui.ts    # 换装子菜单
        │   └── settings.ts     # 设置页 + 外部库管理
        ├── motion/
        │   ├── procedural-motion.ts  # 程序化动作
        │   ├── vmd-writer.ts   # VMD 二进制写入
        │   ├── vpd-parser.ts   # VPD 姿势解析
        │   ├── beat-detector.ts  # 音乐节拍检测
        │   └── lipsync.ts      # LipSync 口型同步
        ├── physics/
        │   ├── xpbd-solver.ts    # XPBD 核心引擎
        │   ├── xpbd-collider.ts  # SDF 胶囊碰撞器
        │   ├── xpbd-cloth.ts     # 程序化布料网格
        │   └── xpbd-renderer.ts  # 调试可视化
        ├── outfit/
        │   ├── outfit.ts       # 换装系统
        │   └── audio.ts        # 音乐播放 + VMD 同步
        └── app.css             # 全局样式（CSS 变量体系）
```

### 11. 模块依赖关系

```
main.ts
 ├── config.ts
 ├── scene.ts         initScene / tryRestoreLastScene
 ├── camera.ts       freeflyInput / getCameraMode
 ├── library.ts      initLibrary / togglePopup / showMotionPopup
 ├── settings.ts     showSettings
 ├── scene-menu.ts   showSceneMenu
 └── Wails Runtime   OnFileDrop / EventsOn

scene.ts
 ├── config.ts        状态读写、工具函数
 ├── camera.ts        autoFrame / getCameraState / setCameraState / animateCameraVmd / ...
 ├── audio.ts         syncAudioPlayback / loadAudioFile / ...
 ├── fileservice.ts   resolveFileUrl
 └── Wails Binding    SaveThumbnail / SaveLastScene / LoadLastScene

audio.ts
 └── fileservice.ts   resolveFileUrl

library.ts
 ├── config.ts        状态、类型、工具
 ├── scene.ts         loadPMXFile / loadVMDFromPath / focusModel / removeModel
 ├── audio.ts         loadAudioFile / setAudioOffset
 ├── menu.ts          MenuStack
 └── Wails Binding    GetConfig / ScanModelDir / ExtractZip / GetDanceSets / ...

settings.ts
 ├── config.ts        状态
 ├── menu.ts          MenuStack
 ├── library.ts       showPopup / rescanAndSync / reloadConfig
 └── Wails Binding    SetDisplayNamePriority / ...

scene-menu.ts
 ├── config.ts        状态、类型
 ├── menu.ts          MenuStack
 ├── camera.ts        switchCameraMode / getCameraMode / hasCameraVmd / ...
 ├── scene.ts         triggerAutoSave / serializeScene / deserializeScene / getRenderState / ...
 ├── audio.ts         loadAudioFile / pauseAudio / resumeAudio / ...
 └── Wails Binding    SelectSceneSaveFile / SaveSceneFile / SelectAudioFile / ...

camera.ts
 └── config.ts        focusedModelId

fileservice.ts
 └── Wails Binding    StartFileServer / IsolateModelDir
```

### 17. XPBD 布料模拟（Phase 9）

#### 17.1 概述

基于 XPBD (Extended Position Based Dynamics) 算法的纯 TypeScript 布料模拟系统，不依赖 WASM Bullet，与 PMX 内建刚体链独立运行。

核心参考：Miles Macklin "XPBD: Position-Based Simulation of Compliant Constrained Dynamics"

#### 17.2 模块架构

```
physics/
├── xpbd-solver.ts      # XPBD 核心引擎（Verlet 积分 + 子步约束求解）
├── xpbd-collider.ts    # SDF 胶囊碰撞器（身体碰撞体积）
├── xpbd-cloth.ts       # 程序化网格生成 + 骨骼锚定 + Mesh 更新
└── xpbd-renderer.ts    # 调试可视化（粒子/约束/胶囊）

scene/scene-model.ts    # ModelManager 集成（getBoneWorldMatrix / addCloth / removeCloth）
```

#### 17.3 数据流

```
createCloth(scene, config, collider?)
  ├─ 粒子放置：从锚骨 Y=0 向下生成 ringCount × ringSize 环状粒子
  │   半径 = innerRadius + t * length * tan(slopeDeg)  （锥形裙摆）
  ├─ 约束建立：
  │   ├─ 距离约束：水平同层相邻 + 垂直上下层
  │   └─ 弯曲约束：水平 skip-1 + 垂直 skip-1
  ├─ 地面碰撞：默认 Y = -5
  └─ Babylon.js Mesh：程序化生成三角网格 + StandardMaterial

buildClothUpdateFn(cloth, anchorMatrixFn, collider?)
  └─ 每帧回调（注册到 onBeforeRenderObservable）：
     1. 锚定粒子跟随骨骼世界位置（matrix * localPos）
     2. SDF 胶囊碰撞求解（身体穿透检测）
     3. solver.step(dt) — Verlet 积分 + 4 子步约束求解
     4. 更新 Mesh 顶点 + ComputeNormals 重算法线

ModelManager 集成
  └─ getBoneWorldMatrix(boneName) → 从 runtimeBones 获取世界矩阵
  └─ addCloth(modelId, cloth, updateFn) → 注册 + 启动观察者
  └─ removeCloth(modelId) → disposeCloth + 注销观察者（空集时）
```

#### 17.4 XPBD 求解器

| 步骤 | 说明 |
|------|------|
| Verlet 积分 | `v = (p - prev) * damping / dt` → `v += gravity * dt` → `p += v * dt` |
| 子步约束求解 | 每个子步遍历所有约束，用 XPBD 公式矫正：`Δλ = -(C + α̃λ) / (∇C·M⁻¹·∇C + α̃)` |
| 速度更新 | `v = (p - prev) / dt`，固定粒子置零 |

约束类型：
- **距离约束**（2 粒子）：`C = |p_i - p_j| - restLength`
- **弯曲约束**（3 粒子 skip-1）：`C = |p_i - p_k| - restLength`
- **体积约束**（4 粒子四面体）：`C = 6·V - restVolume`，梯度 `grad_i = -1/6·((p_j-p_k)×(p_l-p_k))`

#### 17.5 SDF 胶囊碰撞器

用 13 个胶囊体近似身体碰撞体积（头/颈/胸/腰/臀 + 四肢×2）：

- 胶囊 SDF：`distance = |point - nearestPointOnSegment| - radius`
- 碰撞响应：推送穿透粒子（×stiffness） + 摩擦切向衰减
- 每帧从骨骼世界矩阵更新胶囊端点（`updateMatrices`）

#### 17.6 默认布料配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `anchorBone` | `"腰"` | 锚定骨骼名 |
| `topology` | `"skirt"` | 拓扑（skirt/tube/cape/rope） |
| `innerRadius` | `0.15` | 腰部开口半径 |
| `length` | `0.6` | 裙长 |
| `slope` | `15°` | 裙摆角度 |
| `segmentsH × segmentsV` | `24 × 12` | 网格密度（288 粒子，~2000 约束） |
| `compliance` | `0.001` | 布料柔度 |
| `bendCompliance` | `0.005` | 弯曲柔度（= compliance × 5） |
| `damping` | `0.96` | 速度阻尼 |
| `particleRadius` | `0.03` | 粒子碰撞半径 |
| `solver.substeps` | `4` | 子步数 |

预期性能：~288 粒子 + ~2000 约束 + 4 子步 → CPU 约 0.5~1ms/帧。

#### 17.7 生命周期

```
模型加载 → createCloth() → modelManager.addCloth(id, cloth, updateFn)
                             └── 自动注册 onBeforeRenderObservable
                             └── 每帧: dt = scene.deltaTime/1000 → cloth.updateFn(dt)

模型删除 → modelManager.remove(id) → removeCloth(id) → disposeCloth(cloth)

应用关闭 → modelManager.dispose() → 遍历所有 clothInstances → disposeCloth
```

渲染观察者按需管理：首个布料创建时注册，最后一个移除时注销，零布料时零开销。

#### 17.8 调试渲染

`XpbdRenderer` 提供三种可视化：
- 粒子小球：绿色半透明球体显示粒子位置
- 约束线条：蓝色线条显示距离/弯曲约束拓扑
- 胶囊碰撞体：红色线框显示身体碰撞体积

调试阶段可启用，上线后关闭（`showParticles(false)` 等）。

#### 17.9 后续可选优化

- LOD：相机远时降低 segmentsH/V
- 风场：step 前给粒子速度加随机方向扰动
- 混合碰撞器：布料与 PMX 刚体顶点混合碰撞检测
- 体积约束：当前未用于裙子，已预置（四面体软体用）

### 12. 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Space` | 播放/暂停 |
| `Escape` | 关闭所有弹窗 |
| `←` | seek -5s |
| `→` | seek +5s |
| `W/A/S/D` | 自由飞行移动（相机模式=freefly 时） |
| `Q/E` | 升降（相机模式=freefly 时） |
| `Ctrl+1` | 打开模型库 / 执行菜单第 1 项 |
| `Ctrl+2` | 打开动作库 / 执行菜单第 2 项 |
| `Ctrl+3` | 打开场景菜单 / 执行菜单第 3 项 |
| `Ctrl+4` | 执行菜单第 4 项 |
| 鼠标拖拽 | 旋转视角（orbit 模式） |
| 滚轮 | 缩放 |

### 16. 换装系统（Outfit System）

#### 16.1 概述

换装系统允许用户为同一 PMX 模型切换不同纹理贴图（多纹理变体），支持两种模式：

| 模式 | 说明 | 优先级 |
|------|------|--------|
| **显式配置** | `outfits.json` 精确指定变体/槽位/作用域 | 高（先检查） |
| **自动发现** | 扫描模型目录子目录，自动匹配同名纹理文件 | 低（无 json 时回退） |

#### 16.2 数据流

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

#### 16.3 变体配置格式（`outfits.json`）

参见 [outfits-spec.md](outfits-spec.md)。

#### 16.4 三层混合优先级

```
每槽位最终值 = byMaterial[name] ?? byCategory[cat] ?? all ?? 原始贴图
```

- `byMaterial` — 按材质名精确匹配（大小写不敏感）
- `byCategory` — 按部位分类（皮肤/头发/眼睛/服装，复用 `_catOf`）
- `all` — 全局覆盖所有材质
- 未指定的槽位保持原始贴图

#### 16.5 关键文件

| 文件 | 职责 |
|------|------|
| `app.go:LoadOutfitFile` | Go binding: 读 outfits.json |
| `app.go:ListSubDirs` | Go binding: 列子目录（自动发现） |
| `config.ts:OutfitFile/OutfitVariant/OutfitSlot` | 类型定义 |
| `scene.ts:loadOutfits` | 加载 + 自动发现 |
| `scene.ts:applyOutfitVariant` | 核心贴图替换（含 _origTextures 快照） |
| `scene.ts:resetOutfit` | 回退原始贴图 |
| `model-detail.ts:buildOutfitLevel` | UI 子菜单 |
| `model-detail.ts:ModelPresetFile.outfitVariant` | 预设序列化 |
| `scene.ts:SceneFile.model.outfitVariant` | 场景序列化 |

#### 16.6 序列化集成

| 载体 | 字段 | 说明 |
|------|------|------|
| `.mcupreset.json` | `outfitVariant` | 预设保存/加载时自动包含 |
| `.mmascene` | `models[].outfitVariant` | 场景保存/恢复时自动包含 |

#### 16.7 边界与限制

| # | 场景 | 处理 |
|---|------|------|
| 1 | 变体内贴图路径不存在 | 404 → 静默保持原贴图 |
| 2 | byMaterial 名大小写/空格不一致 | 当前精确匹配，未做归一化 |
| 3 | 切换变体后 dispose 旧贴图 | `_applySlot` 严格 dispose 非 orig 贴图 |
| 4 | zip 内模型无 outfits.json | 仅自动发现（需 zip 内包含子目录结构） |
| 5 | 多模型共享同纹理 | 各自 inst._origTextures 独立备份 |

---
