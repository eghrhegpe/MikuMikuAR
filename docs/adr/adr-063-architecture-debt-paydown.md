# ADR-063: 架构债务集中清偿 —— EnvState 对齐 / App 拆分 / Scene 瘦身

> **状态**: 已实施（2026-07-08 三个阶段全部完成，build + 1128 tests 通过）
> **背景**: 架构审计发现三处长期技术债：① EnvState 三层定义不一致导致字段静默丢失；② Go App struct 136 方法呈上帝对象形态；③ scene.ts 既是编排器又是子系统函数容器，职责模糊。本次集中清偿，重点记录决策过程中的纠结点。
> **关联**: ADR-033（配置拆分去重）、ADR-022（预设治理）、ADR-055（AR 相机模式）

---

## 一、决策总览

| # | 决策 | 选项 | 最终选择 | 纠结度 |
|---|------|------|---------|--------|
| D1 | EnvState 不一致的根治方向 | A. Go 迁就前端 / B. 前端迁就 Go / C. 双向对齐至真源 | **C. Go struct 为唯一真源，前端被动跟随** | ⭐⭐⭐⭐ |
| D2 | App struct 拆分模式 | A. 彻底拆包 / B. Facade 薄包装 / C. 保持现状 | **B. Facade 薄包装 + 渐进式分包** | ⭐⭐⭐⭐⭐ |
| D3 | scene.ts 自有函数搬迁边界 | A. 全搬 / B. 只搬纯领域逻辑 / C. 不搬只重排 | **B. 纯领域逻辑搬出，跨子系统协调留在 scene.ts** | ⭐⭐⭐ |

---

## 二、D1 — EnvState 类型不一致的根治方向

### 2.1 问题现状

三层定义各有偏差：

| 层 | 文件 | 字段数 | 问题 |
|----|------|--------|------|
| Go 端 | `internal/app/app.go` | ~60 | 缺少前端独有的 25+ 字段（地形、云细节、光照预设等）；多出 `FoamAlphaInfluence`（已废弃但未删） |
| 绑定层 | `frontend/bindings/.../models.ts` | ~60 | 跟随 Go 生成，与 Go 一致 |
| 前端状态 | `frontend/src/core/types.ts` | ~85 | 前端实际使用的完整集合 |

**后果**：`SetEnvState(envState as unknown as EnvState)` 双转义调用——字段名不匹配时静默丢失，不报错。排查"为什么我设的云厚度不生效"类问题极其困难。

### 2.2 三个选项

#### 选项 A：Go 迁就前端 —— 把前端所有字段加到 Go 端

- **理由**：前端是字段的主要消费者，Go 只做持久化/序列化，字段丰富度应由前端决定
- **代价**：Go 结构体膨胀；部分前端字段（如 `debugClouds`）对 Go 来说是纯粹的透传数据，毫无业务意义

#### 选项 B：前端迁就 Go —— 前端只使用 Go 定义的字段

- **理由**：Go 是数据真源，前端不应持有 Go 不知道的状态
- **代价**：前端需要额外的"本地环境状态"层，与 EnvState 分裂；`SetEnvState` / `GetEnvState` 的语义不再完整

#### 选项 C：双向对齐 —— Go struct 为唯一真源，前端被动跟随

- **思路**：
  1. Go 端补齐所有前端在用的字段（哪怕 Go 本身不消费，只作持久化载体）
  2. 同时删除 Go 端已废弃的 `FoamAlphaInfluence`
  3. 前端 `core/types.ts` 的 EnvState 与 binding 模型对齐
  4. 消除 `as unknown as` 双转义，让类型系统发挥作用
- **代价**：Go struct 变成"持久化 DTO"，部分字段对 Go 业务无意义

### 2.3 纠结点

**纠结一：Go struct 应不应该承载纯前端字段？**

反方观点：Go 的 EnvState 应该只包含 Go 端需要持久化的业务字段。前端的 `debugClouds`、`lightingPresetName` 等是纯 UI 状态，应该存在前端本地状态里，跟 Go 无关。

正方观点：EnvState 的核心语义是"环境场景的完整可序列化状态"——用户保存场景文件时，所有影响环境呈现的参数都应该被持久化。`debugClouds` 虽然是调试开关，但用户关掉再打开时它应该恢复。把这些字段推回前端"本地状态"会导致"部分环境参数不随场景保存"的割裂体验。

**决策**：正方胜。**Go struct 是环境状态的唯一真源**，字段定义以"能否影响场景呈现"为标准，不以"Go 端是否消费"为标准。Go 端的角色是持久化载体，允许它持有"只存不用"的字段。

**纠结二：前端 EnvState 接口应该直接 import binding 类型，还是保留独立定义？**

- 直接 import：类型天然一致，零维护成本
- 保留独立定义：前端可以加额外字段/注释，不依赖自动生成代码

**决策**：保留独立定义，但**通过类型契约测试强制对齐**。理由：前端 EnvState 有 JSDoc 注释和语义化命名，直接用自动生成的 binding 类型会丢失这些文档价值；但必须有测试兜底，防止再次漂移。

### 2.4 最终方案

1. Go `EnvState` 结构体补齐 25+ 缺失字段，删除 `FoamAlphaInfluence`
2. 前端 `core/types.ts` 的 `EnvState` 与 Go 端字段名/类型一一对应
3. 消除 `env-bridge.ts` 中 5 处 `as unknown as` 双转义
4. 契约测试持续监督（当前 1 个历史遗留失败，见 §五.1）

---

## 三、D2 — App God Object 拆分模式

### 3.1 问题现状

`App` struct 横跨 13 个文件、136 个方法，职责包括：
- 配置读写（config.go）
- 文件对话框（file_dialog.go）
- 缩略图缓存（thumbnail.go）
- ZIP 解压（zipextract.go）
- 预设管理（presets.go + scene_presets.go + render_presets.go + model_presets.go）
- 模型库扫描（library.go + library_tags.go）
- HTTP 服务器（httpserver.go）
- 文件监听（watcher.go）
- 舞蹈组（dancesets.go）
- 最近/收藏（recents.go）
- 场景序列化（scene.go）
- ...

**后果**：
- 新人无法快速理解 App 的"核心职责"
- 单测困难——所有测试都得先构造完整 App 实例
- 模块间边界模糊（比如缩略图缓存和 ZIP 解压有什么关系？）

### 3.2 三个选项

#### 选项 A：彻底拆包 —— App 只留核心，方法散到各子包

- **思路**：每个领域一个包（dialogs / thumbnail / presets / library / ...），Wails 绑定直接注册到各包的结构体上
- **代价**：Wails v3 的绑定机制要求方法挂在 App struct 上（或显式注册到 Wails API）。彻底拆包意味着要么改 Wails 注册方式（风险高），要么每个子包都有自己的绑定结构体（API 碎片化）

#### 选项 B：Facade 薄包装 —— App 保留所有方法签名，但内部委托给子包

- **思路**：
  1. 业务逻辑搬到 `internal/dialogs/`、`internal/thumbnail/` 等子包
  2. App 方法只剩几行：获取依赖 → 调用子包函数 → 返回结果
  3. Wails 绑定契约完全不变
- **代价**：App 方法数量不变（136 → 还是 136），只是方法体变薄了。从"行数"看瘦身了，但从"方法数"看没变

#### 选项 C：保持现状 —— 只做文档和注释分区

- **思路**：不动代码，靠 `// ======== 分区 ========` 注释和架构文档来维持可读性
- **代价**：技术债继续累积；单测困难不变

### 3.3 纠结点

**纠结一：Facade 模式算不算"真拆分"？**

反方观点：App 还是有 136 个方法，还是上帝对象。只是把实现藏到了别的包里。这是"换汤不换药"。

正方观点：
1. **职责分离是真的**——业务逻辑从 App 移到了领域包，App 退化为"绑定入口 + 协调层"。这是 Facade 模式的标准用法。
2. **可测试性提升是真的**——`internal/thumbnail/` 的函数是纯函数，不依赖 App，可直接单测。
3. **契约不变是关键**——Wails 绑定是公共 API，不能随便动。Facade 模式在不破坏契约的前提下实现了内部分层。
4. **渐进式迁移**——一次只拆一个领域，风险可控。不像彻底拆包需要一次性重构所有绑定注册。

**决策**：正方胜。采用 **Facade 薄包装 + 渐进式分包**。App struct 的定位从"业务容器"变为"绑定入口 + 依赖组装器"。方法数可以多，但每个方法只能是薄包装。

**判断标准**：如果一个 App 方法超过 10 行且包含业务逻辑，它就该被拆分出去。

**纠结二：依赖注入 vs 包级单例**

子包的函数应该通过参数接收依赖（如 `thumbDir`），还是包内自己管（包级变量）？

- 依赖注入：更纯粹，易测试；但每个函数都多一个参数，调用方要自己解析路径
- 包级单例：调用简单；但需要 init 顺序，增加耦合

**决策**：**纯逻辑函数用依赖注入**（如 `thumbnail.Save(thumbDir, modelPath, base64PNG)`），**有状态的系统用包级单例 + init 函数**（如未来的 presets 包可能需要缓存）。
- 当前拆分的 dialogs / thumbnail 都是无状态的，用依赖注入
- App 方法负责把 Wails 上下文（路径、日志等）转换成子包函数的参数

**纠结三：拆到什么程度停手？**

136 个方法不可能一次拆完。哪里是边界？

**决策**：按"领域内聚性"分批，每次拆一个完整领域：
- 第一批（已完成）：文件对话框（7 个）、缩略图（4 个）+ SHA256 工具提升
- 第二批候选：预设管理（场景/模型/渲染 ~15 个方法）、模型库（扫描/标签/收藏 ~20 个）
- 第三批候选：ZIP 解压、HTTP 服务器、文件监听

**原则**：拆一个领域，验证一个领域，不追求一次性拆完。

### 3.4 最终方案

1. **模式**：Facade 薄包装 —— App 方法保留签名，内部委托给子包
2. **依赖**：子包函数通过参数接收依赖（依赖注入），App 方法负责组装
3. **进度**：渐进式拆分，每批一个领域，拆完即验证（build + test）
4. **第一批成果**：`internal/dialogs/`（7 方法）、`internal/thumbnail/`（4 方法）、`internal/util/hash.go`（SHA256 提升）

---

## 四、D3 — scene.ts 自有函数搬迁边界

### 4.1 问题现状

`scene/scene.ts` 定位为"3D 场景编排入口"，但实际混杂了：
- 核心实例（engine / scene / modelManager）
- 初始化组装（initScene）
- 跨子系统协调（setARMode —— 同时动 env / camera / proc-motion）
- 领域函数（focusedMmdModel / focusedModel —— 纯模型查询）
- 配置胶水（applyFrameControl —— UI 设置 → engine）
- 大量 re-export

**问题**：哪些该搬、哪些该留？搬的标准是什么？

### 4.2 三个选项

#### 选项 A：全搬 —— 所有自有函数都去子模块，scene.ts 只剩 init + re-export

- **思路**：6 个自有函数全部分别搬到对应子模块
- **代价**：`setARMode` 这种跨子系统协调函数没地方去 —— 它依赖 env、camera、proc-motion 三个子系统，放哪个都不合适

#### 选项 B：只搬纯领域逻辑 —— 跨子系统协调留在 scene.ts

- **思路**：
  - 纯模型查询（focusedMmdModel / focusedModel）→ `manager/model-ops.ts`
  - AR 场景级协调（setARMode / takeARScreenshot / isARModeActive）→ `ar/ar-scene.ts`
  - `applyFrameControl` 留在 scene.ts（UI→engine 的胶水，属于编排职责）
  - `initScene` / `getScene` 留在 scene.ts（barrel 正当职责）
- **代价**：还剩 3 个自有函数，scene.ts 不是"纯 barrel"

#### 选项 C：不搬只重排 —— 加清晰的分区注释，不动代码

- **思路**：通过注释分组让结构清晰，不做实际搬迁
- **代价**：函数实际还在 scene.ts 里，模块边界没有真正建立

### 4.3 纠结点

**纠结一：setARMode 应该放在哪里？**

- 放 `ar/ar-camera.ts`？不对，它不仅管摄像头，还管天空、视线追踪、清屏颜色
- 放 `scene.ts`？它是 AR 场景的核心逻辑，跟 camera.ts 配合最紧密
- 新建 `ar/ar-scene.ts`？一个文件只放 3 个函数会不会"为拆而拆"？

**决策**：新建 `ar/ar-scene.ts`。理由：
1. **语义清晰**：ar-camera 管"摄像头视频流"（低层），ar-scene 管"AR 场景集成"（高层）
2. **AR 子系统可独立发展**——未来 AR 有平面检测、锚点、光照估计等能力时，都有地方放
3. **3 个函数虽然少，但它们是独立的领域**——AR 不应该寄生在 scene.ts 里

**纠结二：applyFrameControl 算不算"渲染逻辑"？**

- 说它是渲染逻辑：它设置 `engine.maxFPS`，影响渲染帧率
- 说它是编排胶水：它读 `uiState.vsync` / `uiState.fpsLimit`，把 UI 配置映射到 engine 属性

**决策**：留在 scene.ts。理由：
1. 它本质是「UI 设置 → 引擎参数」的胶水函数，属于编排层职责
2. 搬到 renderer.ts 会让 renderer 依赖 uiState，破坏 renderer 的纯渲染定位
3. 只有 7 行，搬与不搬对架构的影响微乎其微

**纠结三：循环依赖能不能接受？**

`scene.ts` re-export 从 `model-ops.ts`，`model-ops.ts` 从 `scene.ts` 导入 `modelManager` —— 循环依赖。

- 反方：循环依赖是架构坏味道，应该避免
- 正方：ES modules 原生支持循环依赖（通过 live binding），而且这里的循环是"barrel re-export"型循环，不是业务逻辑互相调用。model-ops 只从 scene 拿一个实例引用，scene 只从 model-ops re-export 两个函数。运行时不会有初始化顺序问题。

**决策**：接受这种程度的循环依赖。理由：
1. scene.ts 作为 barrel，re-export 子模块的 API 是它的本职工作
2. 子模块从 scene.ts 导入核心实例（modelManager / scene）是既有模式（renderer 通过参数注入，model-ops 通过 import 取，二者模式不统一但都能工作）
3. 真正需要避免的是"业务逻辑互相调用"的循环，而不是"barrel re-export"型循环

### 4.4 最终方案

| 函数 | 去处 | 理由 |
|------|------|------|
| `focusedMmdModel` / `focusedModel` | `manager/model-ops.ts` | 纯模型查询，模型操作领域 |
| `setARMode` / `takeARScreenshot` / `isARModeActive` | `ar/ar-scene.ts` | AR 场景级协调，独立 AR 子系统 |
| `applyFrameControl` | 留在 scene.ts | UI→引擎的胶水，编排层职责 |
| `initScene` / `getScene` | 留在 scene.ts | 组装器 + barrel 正当职责 |

scene.ts 自有函数从 8 个降到 3 个（initScene / getScene / applyFrameControl）。

---

## 五、遗留事项与已知限制

### 5.1 契约测试的历史遗留失败

`app.contract.test.ts` 期望 110 个导出函数，但实际有 1 个函数不存在（测试端多写了）。本次重构未改动 Go 端绑定契约，此失败与本次工作无关，待后续单独修复。

### 5.2 未完成的拆分领域

第二批/第三批拆分（预设、模型库、ZIP、HTTP 等）尚未实施，已建立 Facade 模式后可按相同套路推进。

### 5.3 scene.ts 循环依赖

model-ops → scene → model-ops 的循环依赖在可接受范围内，但若未来发现更多循环依赖积累，需考虑引入显式的 "scene-context" 模块来持有共享实例，打破循环。

---

## 六、经验教训

1. **类型一致性需要测试兜底**——光靠代码审查防不住字段漂移，必须有自动化契约测试
2. **渐进式重构优于大爆炸**——每步都能 build + test，风险可控
3. **Facade 是框架约束下的务实选择**——Wails 绑定要求方法挂在 App 上，Facade 在此约束下最大化了内部分层
4. **跨子系统协调函数是编排层的正当职责**——不要为了"让 barrel 变纯"而硬把协调逻辑塞进某个子系统
