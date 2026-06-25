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

- UTF-16LE 手写解码（BMP 平面够用，含 surrogate pair 处理），UTF-8 直接 `string()`
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

### 7. 生态聚合（Week 7+）
- **DanceXR 共用**：扫描器已原生支持 DanceXR 8 种分类目录约定。外部库挂载已实现：通过 `Config.ExternalPaths` 配置多源联合扫描，弹窗根层显示 🔌 虚拟入口，下钻复用 `buildLevel` 导航链路。条目带 `Source` 标签区分来源。
- **模之屋下载接管**：拦截下载链接 → Wails 走原生 HTTP 下载 → 落库到模型目录（绕开浏览器下载）
- **Blender 唤起**：Wails `exec.Command` 启动本地 Blender + 传模型路径参数
- **Android**：远期，考虑 Wails mobile 或 React Native + JS 端重做渲染

---

**当前进展**：第 1-6 环节全部完成，DanceXR 外部库挂载已实现。下一步：模之屋下载接管 + Blender 唤起。
