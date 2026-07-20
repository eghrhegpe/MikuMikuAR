# ADR-093: 菜单声明式 Schema —— 单一数据源 + 单渲染器，根治「大」与「AI 难改」

> **状态**: 已完成 P0+P1+P2（57 个面板迁移完成，env/motion/scene/model/settings 全域覆盖；library/language 为动态列表/纯导航性质，非面板类面板，无需 schema 化）；P3 收尾（移除死 builder、删除 barrel 兼容 re-export、全量类型化）待推进

## 1. 背景

`frontend/src/menus/` 当前 **16,345 行 / 41 个文件**，全部为命令式 `build*Level()` builder：
`document.createElement` + `addSliderRow` / `slideRow` + 内联 `onChange` 绑定 `envState` / `renderState` + Wails 调用 + toast，一锅烩。

用户诉求触发本 ADR：**「UI 菜单非常大」+「让 AI 重写菜单难度极大」**。经静态分析与代码核查，二者根因不同，需分别定性：

### 1.1 「菜单大」= 模板膨胀（实现层缺陷，非功能过多）

每个功能行都重复同一套脚手架（label / getter / onChange / icon / i18n key）。菜单结构本可用数据描述，却以命令式代码逐行拼出，行数随功能线性膨胀。

### 1.2 「AI 难重写」= 方案级缺陷：缺中间表示 + 导航双机制未统一

> 下表经 2026-07-12 代码核查（`scene-menu.ts` / `env-menu.ts` / `motion-popup.ts` / `menu-factory.ts`）修正，原 ADR 的「双源路由契约 / switch/case 须手写同步」表述已**过时**。

| # | 缺陷 | 证据（核查后） | 后果 |
|---|------|------|------|
| 1 | **无声明式 schema / 单一数据源** | 菜单树 = 35+ 个 `build*Level()` 的执行结果，无任何一份数据描述「有哪些菜单」 | AI 想整体重排/重写，必须先 trace 全部文件才能还原当前树 |
| 2 | **导航双机制未统一于 schema** | `scene/env/motion` 三域**已**用 `Record<string, () => PopupLevel>` 路由表（`SCENE_FOLDER_ROUTES` scene-menu.ts:201 / `ENV_FOLDER_ROUTES` env-menu.ts:591 / `MOTION_FOLDER_ROUTES` motion-popup.ts:397），**无 switch/case**；但另有一类 `getXMenu()?.push(buildX(id))` 内联下钻（如 env-feature-levels.ts:122/261、motion-popup.ts:113/138/186/358、scene-prop-levels.ts:33 等），用于「点具体实例→建其详情层」的**动态实例下钻** | 静态 `target` 路由与动态内联 `push` 是两套代码路径，均未从同一份 schema 派生；内联 `push` 路径**不享受**路由表路径自动挂的 `itemBuilder`（i18n 热刷新需手写），且两种写法语义重叠、AI 难判别该用哪种 |
| 3 | **控件↔状态绑定内联** | `setEnvState(...)` 散落各 builder 闭包，无 `bind → state path` 映射表 | 无法安全重命名 / 批量改；改一个控件要全网搜其 onChange |
| 4 | **魔法字符串 target** | `scene:render:dof` 等无类型保护 | 拼写错无提示 |

> **关于「push 旁路」的纠正**：审查报告将 `getXMenu()?.push(...)` 定性为「绕过路由表的旁路 / 幽灵路径」。**此定性不准确**——`push(level)` 是 SlideMenu 的合法导航原语，专门用于携带实例 id 的动态下钻（路由表无法表达「未知数量的实例子层」）。它不是 bug，也非「绕过」路由表，而是与 `target` 路由表**并存的第二种合法机制**。真正要根治的不是「消灭 push」，而是让两种机制都从**同一份声明式 schema** 派生（静态 `children` + 动态 `dynamic` 节点），从而统一 i18n 热刷新与可审计性。

> 参见 ADR-022 §4「菜单架构重组（混乱）」——本问题已记录、未根治，属存量技术债。
> 参见 ADR-065「i18n 热刷新」——路由表路径已通过 `itemBuilder` 自动重绑实现热刷新，schema 须保证动态节点同等覆盖。

**一句话定性：意图正确（SlideMenu 导航栈 UX 无问题），缺数据层，且导航存在 map-route 与 inline-push 两套写法未统一。**

## 2. 决策

照搬项目一贯的「单一路径」哲学（ADR-091/092），对菜单做两层统一：**菜单即数据（schema）+ 单一渲染器**。命令式 builder 降级为「自定义层渲染后端」，仅表单类特殊层保留。

### 2.1 声明式菜单节点 `MenuNode`

```ts
// 状态路径：类型化字符串，由 schema 引擎按前缀解析到已存在的 reactive 访问器
//   'env.*'   → envState（core/state.ts 中已是 reactive<EnvState>）
//   'render.*'→ getRenderState()
//   'ui.*'    → uiState
// 避免退化为内联 { get, set } 闭包，保证可审计 / 可安全重命名。
type StatePath = `${'env' | 'render' | 'ui' | 'motion'}.${string}`;

type MenuKind =
    | 'folder'      // 静态子层，children 展开
    | 'action'      // 执行 action
    | 'divider'
    | 'slider'
    | 'toggle'
    | 'modeSlider'
    | 'chips'
    | 'dynamic';    // 运行时由 childrenResolver 生成子项（列表/预设等）

interface MenuNode {
    id: string;                       // 稳定唯一 id，路由由此派生（取代魔法字符串 target）
    kind: MenuKind;
    label: string;                    // i18n key，渲染时经 t() 解析
    icon?: string;
    children?: MenuNode[];            // folder 静态子层
    childrenResolver?: (ctx: MenuCtx) => MenuNode[];  // dynamic 节点运行时子项
    control?: ControlSpec;            // slider/toggle/modeSlider/chips 的参数 + 状态绑定
    action?: (ctx: MenuCtx) => void | Promise<void>;  // action 行；须用 ctx.setStatus/toast 反馈
    confirm?: string;                 // i18n key；存在时复用 showConfirm 做破坏性操作防呆
    renderCustom?: (ctx: MenuCtx) => { el: HTMLElement; dispose?: () => void } | void;  // 表单类逃生舱
    visibleWhen?: (ctx: MenuCtx) => boolean;   // 平台/状态守卫（如 Android 隐藏外部程序）
    emptyHint?: string;               // dynamic 节点无子项时的空状态文案 i18n key
}

interface ControlSpec {
    type: 'slider' | 'toggle' | 'modeSlider' | 'chips';
    bind: { state: StatePath; get?: (s: any) => any; set?: (s: any, v: any) => void };  // 类型化 state path
    min?: number; max?: number; step?: number; unit?: string;
    options?: Array<{ label: string; value: string }>;  // modeSlider/chips
}
```

**逃生舱 `renderCustom` 的 dispose 契约（回应审查 P2）**：签名改为返回 `{ el, dispose? }`；内部创建的任何子控件**必须**通过 `ctx.registerControl(update)` 注册（复用 `SlideMenu._controls` 现有机制，menu.ts:325/695/744），使 `SlideMenu.dispose()` 能级联释放。未返回 `dispose` 且未注册控件的逃生舱，其创建的 DOM/监听器在层级切换时泄漏——此点列入 §5 风险与 §6 验证。

### 2.2 单渲染器 `renderMenu(schema, ctx)`

- 走查 `MenuNode` 树，按 `kind` 复用**现有** `ui-helpers`（`addSliderRow` / `addToggleRow` / `addModeRow` / `slideRow` …）生成 DOM——渲染后端不变，只是被数据驱动。
- **控件绑定自更新**：`renderMenu` 对每个 `control.bind` 调用 `ctx.registerControl(() => update(getState(bind.state)))`，接入现有 `reactive` 订阅 + `registerControl` 管线（core/reactivity.ts、ui-rows.ts:127），状态变化自动刷新，**无需新增订阅系统**。
- **导航统一**：`folder` 行点击 → `push(renderMenu(node.children))`；`dynamic` 节点在进入时调用 `childrenResolver` 生成子层并 `push`。由此**静态 `target` 路由与动态实例下钻都派生自 schema 单一来源**，根除缺陷 #2 的双机制分裂，并让动态节点同样获得 `itemBuilder` 式 i18n 热刷新。
- `renderCustom` 作为逃生舱，承接无法数据化的表单层（如材质列表、预设快照）；其 `dispose` 由 `renderMenu` 收集并在层级卸载时调用。

### 2.3 迁移路径（分阶段，禁止大爆炸）

| 阶段 | 内容 | 前置 | 说明（核查后修正） |
|------|------|------|------|
| **P0 快赢** | 引入 `MenuNode` + `renderMenu` + `registerNode(id, node)`（复用 `registerPopupMenu` 既有注册范式），并在**一个试点叶子**落地；同时将路由表模式扩展到仍重度依赖内联 `push` 的 `model` / `settings` / `library` 域（对齐 scene/env/motion 已落地的 `*_FOLDER_ROUTES`） | — | **非**「替掉 switch/case」（三域已无 switch/case）；**非**「消灭 push」（push 是合法动态下钻，将转为 schema 的 `dynamic` 节点而非删除） |
| **P1 PoC** | 单叶子层（`scene:render:dof` 景深）改为 `MenuNode` + `renderMenu`，验证 i18n 热切换 / 状态绑定自更新 / dispose 级联无泄漏 | P0 | 补单测：各 `kind` 渲染 + `visibleWhen` 守卫 + `renderCustom` dispose 级联 |
| **P2 域迁移** | 按域推进：scene → env → motion → model → settings → library，每域迁完保留 `ui-helpers` 作渲染后端，旧 builder 逐步退役 | P1 | 以「域」为原子迁移单位，一域一 commit，迁完即验证构建 |
| **P3 收尾** | 移除 barrel 兼容 re-export，删除死 builder，类型化 `MenuNode` 树全量 | P2 | — |

#### P2 域迁移进展（截至 2026-07-12）

| 域 | 面板 | 状态 | 备注 |
|------|------|------|------|
| env | 天空（sky） | ✅ 全 schema（已接路由） | modeSlider/colorSlider/toggle + visibleWhen 守卫 + custom 贴图选择；schema 版 buildSkyLevel 已替代命令式 buildEnvUnifiedLevel |
| env | 环境光照（lighting） | ✅ 全 schema | custom 节点（preset chips DOM-direct + sunAngle 模块级变量 bind，非 StatePath）|
| env | 粒子（particle） | ✅ 全 schema | modeSlider + 3 slider + toggle（StatePath 绑定）+ custom 节点（贴图文件选择 + 清除按钮）|
| env | 地面基础（ground:base） | ✅ 全 schema | folder + slider/colorSlider 组合 |
| env | 地面贴图（ground:texture） | ✅ 全 schema | headerToggle + custom 预设芯片 |
| env | 地面装饰（ground:deco） | ✅ 全 schema | headerToggle（get/set 值映射）+ modeSlider |
| env | 地形（ground:terrain） | ✅ 全 schema | headerToggle（boolean↔string 映射）|
| env | 地面增强（ground:enhance） | ✅ 全 schema | visibleWhen 条件渲染 |
| env | 地面反射（ground:reflection） | ✅ 全 schema | modeSlider + slider + toggle |
| env | 水面（water） | ✅ 全 schema | custom 预设 + folder 分组 |
| env | 水面反射（water:reflection） | ✅ 全 schema | onChange 副作用（disposeWater+createWater）|
| env | 风（wind） | ✅ 全 schema | get/set 值转换（角度↔向量）|
| env | 云（cloud） | ✅ 全 schema | slider + get 默认值处理 |
| env | 雾（fog） | ✅ 全 schema | visibleWhen 条件渲染（按 fogMode）|
| env | 阴影（shadow） | ✅ 全 schema | headerToggle + custom 质量预设 |
| env | 实验功能（experimental） | ✅ 全 schema | custom 渲染（条件禁用 + hint）|
| motion | 视线追踪/感知层（gaze） | ✅ 全 schema | `perception.` 状态前缀 + modeRow + onChange 副作用（activatePerception）|
| settings | 性能（performance） | ✅ 全 schema | toggle get/set（undefined→boolean 默认值）+ custom 性能模式 + visibleWhen custom 渲染开关 |
| settings | 截图（screenshot） | ✅ 全 schema | 3 个 custom 节点（格式选择 registerControl 增量更新 / 质量 slider get/set 值转换 0-1↔50-100 / 保存目录文件操作）|
| settings | 音频（audio） | ✅ 全 schema | custom 节点（状态源分散于 audio/audio-bus/proc-motion-bridge 模块，无法用 StatePath）|
| settings | 外观（appearance） | ✅ 全 schema | custom 节点（状态源为 CSS 变量 + Wails bindings，无法用 StatePath）|
| settings | 外部库（external） | ✅ 全 schema | custom 节点（模块级状态 externalPaths + Wails bindings，列表渲染 + actionIcons）|
| settings | 文件名（filename） | ✅ 全 schema | custom 节点（uiState 模块级状态 + 动态列表渲染）|
| settings | 快捷键（shortcuts） | ✅ 全 schema | custom 节点（动态分组渲染 + 键盘事件监听 + 冲突检测）|
| settings | 关于（about） | ✅ 全 schema | custom 节点（异步数据加载 + 缓存统计 + 更新检查 + 导入/导出/重置）|
| settings | 软件（software） | ✅ 全 schema | custom 节点（动态列表 + 详情页双分支 managed/auto + 异步扫描）|
| motion | 布料物理（cloth） | ✅ 全 schema | custom 节点 + visibleWhen（模块级 skirtConfig 状态 + 防抖重建）|
| motion | 脚部贴地（feet） | ✅ 全 schema | custom 节点（模型实例级 feet 状态 + 空状态守卫）|
| motion | 姿态工作室（poseStudio） | ✅ 全 schema | custom 节点（构图辅助 + 姿态预设 + DOF + 相机预设 + 水印）|
| settings | 路径（paths） | ✅ 全 schema | sectionTitle kind + custom 节点 + visibleWhen（Android/桌面端分支 + 下载监听条件渲染）|
| scene | 后处理（postprocess） | ✅ 全 schema | folder headerToggle（Bloom）+ slider onChange 复合状态写入（dofAperture+dofEnabled）+ custom 节点（antialiasing 复合状态 / toneMapping number modeSlider）+ visibleWhen 条件渲染（SSR/SSAO 子参数）|
| motion | 骨骼覆盖（boneOverride） | ✅ 全 schema | custom 节点 + visibleWhen（模型实例级 boneOverrides 数组 + 运行时 API 读写 + 动态列表渲染）|
| motion | 程序化动作（procMotion） | ✅ 全 schema | custom 节点 + folder 折叠 + visibleWhen（模块级 procMotion 状态 + 骨骼分类动态渲染）|
| motion | 相机（camera） | ✅ 全 schema | custom 节点 + visibleWhen（多模式参数条件渲染 + 模块级 expanded 状态 + VMD 操作）|
| scene | 舞台（stage） | ✅ 全 schema | custom 节点（舞台列表 + 道具列表 + 功能入口，动态列表渲染 + 可见性切换 + 导航 push）|
| scene | 道具（prop） | ✅ 全 schema | custom 节点（道具列表 + 加载入口，propRegistry 动态列表渲染）|
| scene | 渲染预设（renderPresets） | ✅ 全 schema | custom 节点 + visibleWhen（内置预设芯片组 + 用户预设条件渲染 + 保存对话框）|
| scene | 舞台灯光（stageLight） | ✅ 全 schema | custom 节点 + visibleWhen（动态灯光实例 bind 回调 + 按类型条件渲染 spot/point/directional 参数 + 阴影条件渲染 + 多灯删除守卫）|
| motion | 播放速度（playbackSpeed） | ✅ 全 schema | custom 节点（模块级 _playbackSpeed 状态 + mmdRuntime.timeScale 同步）|
| motion | 最近动作（recentMotions） | ✅ 全 schema | custom 节点（getRecentMotions 动态列表 + 空状态守卫）|
| motion | 动作音乐（actionMusic） | ✅ 全 schema | custom 节点 + visibleWhen（音频加载/移除条件渲染）|
| motion | 动作绑定（actionBinding） | ✅ 全 schema | custom 节点 + visibleWhen（动态模型实例 + 物理分类 bind 回调 + VMD 图层列表 + 权重滑条 registerControl + 图层启用/删除 + 聚焦/清除操作）|
| scene | 预设场景（presetScenes） | ✅ 全 schema | custom 节点（异步 GetPresetScenes 加载 + loading 占位 + 导出/导入场景包 + presetListContent 列表渲染）|
| scene | 碰撞（collision） | ✅ 全 schema | custom 节点（地面/身体碰撞 toggle + bind 回调）|
| scene | 物理调试（physicsDebug） | ✅ 全 schema | custom 节点（线框/骨骼线/骨骼关节 toggle + bind 回调）|
| scene | WASM 物理（wasmPhysics） | ✅ 全 schema | custom 节点（运行时切换 modeSlider + 重力 slider + 物理总开关 toggle + 类别 toggles + 空模型守卫 + 调试入口 slideRow 导航）|
| model | 打开方式（openWith） | ✅ 全 schema | custom 节点（async 操作用 void IIFE 包裹）|
| model | 模型详情（model） | ✅ 全 schema | custom 节点 + folder 子节点（外观/拖拽操控/工具折叠组）|
| model | 模型信息（modelInfo） | ✅ 全 schema | custom 节点 |
| model | 模型标签（modelTags） | ✅ 全 schema | custom 节点（收藏卡片 + 标签选择器卡片）|
| model | 表情预览（morphPreview） | ✅ 全 schema | custom 节点 |
| model | 骨骼层级（boneHierarchy） | ✅ 全 schema | custom 节点 |
| model | 材质批量（matBatch） | ✅ 全 schema | custom 节点（分类折叠 + headerToggle bind + 10 参数 slider + override 提示）|
| model | 单材质（perMat） | ✅ 全 schema | custom 节点（参数微调 slider + 重置按钮条件渲染）|
| model | 材质根（matRoot） | ✅ 全 schema | custom 节点（材质组折叠列表 + toggle 增量更新 + _paramCardEl 增量渲染 + 重置全部）|
| model | 材质列表（matList） | ✅ 全 schema | custom 节点（mat-row 列表 + toggle + 导航 push perMat）|
| model | 替换纹理（outfit） | ✅ 全 schema | custom 节点（异步 loadOutfits + 变体列表 iconFactory + _loading 状态守卫 + 递归 _render 切换后刷新）|
| — | schema 系统测试 | ✅ | menu-schema.test.ts: 各 kind 渲染 + visibleWhen 守卫 + renderCustom dispose 级联 |

**已迁移面板数：57 个 | tsc 零错误 | 1313 测试全绿**

#### 迁移过程中 schema 系统的能力扩展

| 扩展 | 变更文件 | 说明 |
|------|------|------|
| `perception.` 状态前缀 | menu-schema.ts | 支持感知层状态（eyeTracking/headTracking/breath/blink 等）的读写 |
| `modeRow` kind | menu-schema.ts, render-menu.ts | 横向按钮组（emotion 选择），补充 modeSlider 无法覆盖的场景 |
| `sectionTitle` kind | menu-schema.ts, render-menu.ts | 分组标题，纯展示无交互 |
| ControlSpec.get/set 泛化 | menu-schema.ts | 参数/返回值从 `number` 改为 `unknown`，支持 boolean 等任意类型转换（toggle 的 undefined→true 默认值处理）|
| toggle 支持 get/set/onChange | render-menu.ts | toggle 渲染器从直接 `as boolean` 改为支持 get/set 转换 + onChange 副作用 |

## 3. 备选方案（未采纳）

| 方案 | 能否解决「大」 | 能否解决「AI 难改」 | 未采纳理由 |
|------|------|------|------|
| **B. 仅注册表路由** | ❌ | 🟡 部分 | 消除双机制但仍命令式、仍膨胀。降级为本方案 P0 的注册表底座 |
| **C. 整体换框架（React/Solid）** | ✅ | ✅ | 16k 生产代码 + Babylon canvas + WebView2 集成，单步风险极高（🔴），不作为第一步 |

## 4. 影响

| 文件 | 变更 |
|------|------|
| `frontend/src/menus/menu-schema.ts` | 新增 `MenuNode` / `ControlSpec` / `MenuCtx` / `StatePath` 类型定义 |
| `frontend/src/menus/render-menu.ts` | 新增 `renderMenu(schema, ctx)` 单渲染器（接入 `registerControl` 自更新 + 收集 `renderCustom.dispose`） |
| `frontend/src/menus/menu-factory.ts` | 新增 `registerNode(id, node)`（P0）；复用既有 `registerPopupMenu` 注册范式 |
| `frontend/src/menus/scene-*.ts` 等 | 分阶段：`build*Level` → `MenuNode` 数据；表单层保留 `renderCustom` |
| `frontend/src/core/ui-helpers.ts` | 不变，作为渲染后端复用 |
| `frontend/src/core/reactivity.ts` | 不变；`renderMenu` 经 `registerControl` 接入既有 reactive 管线 |
| `docs/menu-how-to.md` | P2 起同步更新「添加一行菜单」流程为「加一个 `MenuNode`」 |

## 5. 风险

| 文件 | 观察 | 建议 |
|------|------|------|
| 🔴 极高P1 | render-menu.ts | `renderCustom` 逃生舱若未返回 `dispose` 且未 `registerControl`，其 DOM/监听器在层级切换时泄漏 | §2.1 强制契约 + §6 泄漏检查；Review 时限定逃生舱仅用于真正无法数据化的表单层 |
| 🟠 高P2 | render-menu.ts | 单渲染器成为全菜单单点，走查逻辑缺陷会全域炸 | P1 PoC 阶段补单元测试覆盖各 `kind` 渲染 + 路由派生 + `dynamic` 解析 |
| 🟠 高P2 | 迁移期 | 新旧两套并存，同域混用易状态错乱 | 以「域」为原子迁移单位，一域一 commit，迁完即验证构建 |
| 🟡 中P3 | 动态节点 i18n | `dynamic` 节点若跳过 `itemBuilder` 式重绑，i18n 热切换会漏刷 | `renderMenu` 对 `childrenResolver` 结果同样挂 `itemBuilder` 重绑（复用 ADR-065 机制） |
| 🟡 中P3 | renderCustom 逃生舱 | 逃生舱滥用会架空 schema 收益 | Review 时限定逃生舱仅用于真正无法数据化的表单层 |

## 6. 验证

- P1 PoC：景深层数据化后，`npm run check` 零新错误 + `npm run test` 菜单相关用例通过 + 手动验证 i18n 热切换 / 滑块绑定自更新 / dispose 无泄漏。
- **i18n 热切换 e2e（ADR-065 核心收益）**：PoC 阶段追加 vitest/e2e 覆盖 `t()` 热刷新、各 `kind` 渲染、`visibleWhen` 守卫、`dynamic` 子项生成。
- **内存泄漏检查**：PoC 追加 vitest 验证 `renderMenu` 卸载时级联调用 `renderCustom.dispose` 与所有 `registerControl` 注册的清理，断言无残留 DOM 节点 / 监听器（对应 §5 P1）。
- 每域迁移后重跑 `npm run build` + `npm run test`，与迁移前行为逐项对账（AGENTS.md 拆分须与后续重构对账）。

---

## 附录：审核回应（2026-07-12）

对外部审查报告的 6 项建议逐项处置。核查命令：`grep` 于 `frontend/src/menus/` 与 `frontend/src/core/`。

| # | 审查建议 | 处置 | 依据 |
|---|----------|------|------|
| P1 | 缺陷 #2 重定性为「getMenu().push 旁路绕过路由表」、P0 聚焦消灭 push 旁路 | **已纠正（非采纳）** | `getXMenu()?.push(buildX(id))` 是合法的动态实例下钻导航原语，非旁路/幽灵路径；三域路由表已是 `Record` map（scene-menu.ts:201 / env-menu.ts:591 / motion-popup.ts:397），无 switch/case。已重写 §1.2 缺陷 #2 与 §2.3 P0 说明。 |
| P2 | `StateBinding` 改类型化 state-path 字符串，复用 reactive 订阅 | **采纳** | `envState` 已是 `reactive`（core/state.ts:281）；`getRenderState()` 存在（motion-pose-levels.ts:47）；`ControlSpec.bind` 改为 `{ state: StatePath; get?; set? }`。 |
| P2 | `renderCustom(container, ctx)` 缺 dispose 语义 | **采纳** | 签名改为 `(ctx) => { el, dispose? } | void`，并须 `ctx.registerControl`；对应 `SlideMenu._controls`（menu.ts:325/695/744）级联释放。 |
| P2 | 迁移路径重排（P0=消灭 push） | **已纠正** | 见 P1 处置；P0 改为「引入 MenuNode/registerNode 试点 + 扩展路由表模式到 model/settings/library」。 |
| P3 | §6 缺 i18n 热切换 e2e 与内存泄漏检查 | **采纳** | 已在 §6 增补 i18n 热切换 e2e（ADR-065 收益）与 dispose 级联/泄漏 vitest。 |
| P4 | `MenuKind` 缺 `renderCustom`/`dynamic` | **采纳** | `renderCustom` 保留为节点字段（逃生舱）；`MenuKind` 增补 `'dynamic'`（运行时 `childrenResolver` 生成子项）。 |

**状态**：已进入「已完成 P0+P1+P2」。env 域全部面板、motion 域全部面板、scene 域全部面板、model 域 11 个面板（打开方式/模型详情/模型信息/模型标签/表情预览/骨骼层级/材质批量/单材质/材质根/材质列表/替换纹理）、settings 域全部面板已迁移为 schema 驱动。tsc 零错误，测试全绿。剩余 P3 收尾：移除死 builder、删除 barrel 兼容 re-export、全量类型化。settings 域 language 等纯 items 面板（纯 PopupRow 导航，不需 schema 化）、model-preset 预设库面板（使用 generic preset-list-viewer 渲染后端）、library 域（buildLevel 为动态列表渲染后端，非面板性质）均为 P3 范围。
