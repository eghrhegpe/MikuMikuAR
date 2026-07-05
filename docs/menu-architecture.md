# MikuMikuAR — 菜单架构设计

> 所有弹窗统一使用 `SlideMenu` 导航栈模式（`menu.ts`）。
> 添加新功能 = 在对应的根菜单加一行，然后实现 `onItemClick` 或 `onFolderEnter`。

---

## 文件目录（2026-07 拆分后）

```
frontend/src/menus/
├── menu.ts                      # SlideMenu 核心类（导航栈 + 动画 + dispose）
├── library.ts                   # barrel：re-export model/motion popup 入口
├── library-core.ts              # 模型库核心（扫描/搜索/层级/标签）
├── model-detail.ts              # 模型详情（信息/变换/可见性/表情）
├── model-material.ts            # 逐材质 + 分类调参
├── model-preset.ts              # 模型预设保存/加载/库管理
├── outfit-ui.ts                 # 服装变体子菜单
│
├── scene-menu.ts                # 场景弹窗入口 + 路由器（~320 行）
│   ├── scene-render-levels.ts   #   后处理/舞台/渲染预设
│   └── scene-prop-levels.ts     #   道具系统
│
├── env-menu.ts                  # 环境弹窗入口 + 导航（~290 行）
│   ├── env-feature-levels.ts    #   天空/地面/水面/风/云/实验功能
│   ├── scene-prop-levels.ts     #   道具系统（从 env 迁入）
│   └── env-preset-levels.ts     #   环境预设（内置 + 用户保存）
│
├── motion-popup.ts              # 动作弹窗入口 + 动作绑定/音乐/相机
│   ├── motion-camera-levels.ts  #   相机模式 + 参数面板
│   ├── motion-procmotion-levels.ts # 程序化动作 + LipSync
│   └── motion-cloth-levels.ts   #   布料参数面板
│
└── settings.ts                  # 设置页（MenuStack）
    └── settings-software.ts     #   软件管理子菜单
```

> 每个主文件（scene-menu / env-menu / motion-popup）负责根级导航 + 入口 + barrel re-export。
> 子文件是纯叶子模块，只导出 `build*Level` 函数，不持有菜单实例。

---

## 核心机制

`SlideMenu` 类管理一个导航栈（`levels: PopupLevel[]`），每个层级是一个独立面板（`.slide-panel`），层级之间用淡入淡出 + 上下偏移实现切换效果。

### 关键 API

```
SlideMenu.reset(level)       — 清空全部层，显示根层（无动画）
SlideMenu.push(level)        — 推入新层（动画进入）
SlideMenu.pop()              — 退回上一层（动画离开）
SlideMenu.popTo(index)       — 退回到指定层级
SlideMenu.reRender()         — 全部重建（名称优先级切换等）
```

### PopupLevel 结构

```typescript
type PopupLevel = {
    label: string;        // 面包屑显示名
    dir: string;          // 目录（模型树用）
    items: PopupRow[];    // 菜单项
    renderCustom?: (container: HTMLElement) => void; // 自定义渲染（表单等）
};

type PopupRow = {
    kind: "folder" | "model" | "action" | "divider"
        | "slider" | "toggle" | "modeSlider" | "chips";
    label: string;
    icon: string;
    target: string;      // 用于识别行类型
    sublabel?: string;   // 灰色小字
    model?: LibraryModel;
    catTag?: string;     // 分类标签（如「脸部」「身体」）
    editable?: boolean;  // 是否可编辑标签名
    favRef?: string;     // 收藏/取消收藏关联的 libraryRef
    onAddClick?: () => void;     // 右侧「+」按钮点击
    onDetailClick?: () => void;  // 右侧「详情」按钮点击
    rowKey?: string;     // 稳定标识 key，用于增量渲染 row diff
    // folder + headerToggle：右侧渲染开关（与 slideRow headerToggle 一致）
    headerToggle?: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean; ... };
    // slider kind
    sliderValue?, sliderMin?, sliderMax?, sliderStep?: number;
    onSliderChange?, onSliderDragEnd?: (v: number) => void;
    // toggle kind
    toggleValue?: boolean; onToggleChange?: (v: boolean) => void;
    // modeSlider kind
    modeOptions?: { value: string | number; label: string }[];
    modeValue?: string | number; onModeChange?: (v: string | number) => void;
    // chips kind：横向预设芯片组
    chips?: { label: string; active?: boolean; onClick: () => void }[];
};
```

### 行类型

| kind | 箭头 | 点击行为 | 用途 |
|------|------|---------|------|
| `folder` | > | 调用 `onFolderEnter` → 返回下一级 `PopupLevel` → `push()` | 导航到子菜单或文件浏览器 |
| `folder` + `headerToggle` | > | 行点击进子菜单；右侧 toggle 切换开关 | 带启用开关的功能入口（水面/粒子/风/布料） |
| `action` | 无 | 调用 `onItemClick` | 设置项、切换、操作 |
| `model` | 无 | 调用 `onItemClick` | 加载模型/动作文件 |
| `divider` | 无 | 不可点击 | 视觉分组分隔线 |
| `slider` | 无 | 拖拽滑块 → `onSliderChange(v)` | 内嵌数值滑块（物理重力等） |
| `toggle` | 无 | 切换 → `onToggleChange(v)` | 独立开关行 |
| `modeSlider` | 无 | 拖拽 → `onModeChange(v)` | 离散模式滑块（粒子类型/天空模式等） |
| `chips` | 无 | 点击芯片 → `chip.onClick()` | 横向预设芯片组（环境氛围预设等） |

---

## 弹窗结构

### 🎵 模型弹窗

```
模型                        ← 根菜单（library-core.ts）
├── 已加载模型列表          → 点击进模型详情子菜单
│
├── 📁 加载模型             → 第二层：PMX 文件夹浏览（buildLevel + pmx 过滤）
├── 🔄 重新扫描             → action，触发 refreshLibrary
│
├── 🕐 最近打开             → 子菜单：最近加载的模型列表（最多 20 条）
├── 🏷 标签                 → 子菜单：标签概览（收藏 / 自定义标签）
│
├── 模型详情（选中模型后）   ← model-detail.ts（buildModelDetailLevel）
│
│   card1:
│   ├── 📋 模型信息         → renderCustom：顶点/面/骨骼/表情数
│   ├── 📐 变换             → renderCustom：位置 X/Y/Z + 缩放 + 旋转 Y 滑块
│   ├── 👁 可见性           → renderCustom：显示/半透明/隐藏 + 线框 + 骨骼显示 + 物理分类开关
│   ├── 🎨 材质调节         → model-material.ts（buildMatRootLevel）
│   ├── 🏷 模型标签         → renderCustom：收藏 + 标签管理
│   └── 😊 表情预览         → renderCustom：morph 滑块列表
│
│   card2:
│   ├── 🎯 聚焦             → action：相机对准此模型
│   └── 🗑 移除             → action：从场景删除
│
│   card3:
│   ├── 💾 保存预设         → model-preset.ts（buildPresetListLevel）
│   └── 📂 加载预设         → 子菜单：预设库浏览
│
│   card4:
│   └── 🔗 用…打开          → buildOpenWithLevel：外部软件列表
```

### ⚙ 设置弹窗

```
设置                        ← 根菜单（settings.ts）
├── 🎨 显示                → action: 日文名（name_jp）/ 英文名（name_en）/ 文件名（filename）
├── 🎨 界面                → 子菜单：UI 缩放 / 高级设置（弹窗宽度/动画开关/背景模糊/主题色/字体/恢复默认）
├── ⬇ 下载                → action: 监听目录 / 自动导入
├── 🧰 软件管理            → settings-software.ts：MMD/Blender/自定义软件路径设置
├── 🌐 语言                → action：简体中文 / English
├── ⚙ 系统                → action: 清除提取缓存
├── 📊 性能                → 子菜单：性能降级/质量设置
└── 🔌 外部库              → action，打开外部库管理面板
```

**代码入口**：`showSettings()` → `settingsMenu.reset(rootLevel)`

**特点**：
- 所有叶子菜单项用 `kind: "action"`，通过 `handleSettingsAction()` 分发。
- 「界面」子菜单使用 `renderCustom` 渲染滑块（UI 缩放 0.8~1.3）、主题色预设（6 色块 + 自定义 hex）、字体切换（系统/思源黑体/微软雅黑）、toggle 开关（动画/模糊）。

---

### 💃 动作弹窗

```
动作 ← 根菜单（motion-popup.ts）
├── [已加载模型列表]     → 点击进动作绑定子菜单（更换动作/清除/调试）
├── 🕐 最近使用          → 子菜单：最近使用动作列表
├── 🎵 音乐              → 子菜单：音频加载/偏移/音量
├── 📷 相机模式          → 子菜单：相机参数（motion-camera-levels）
├── 🌬 程序化动作        → 子菜单：待机呼吸/自动舞蹈/强度/速度（motion-procmotion-levels）
├── ⬇ 物理重力          → 滑块：0~2
├── 🧵 布料参数          → 子菜单：布料预设/形状/物理/碰撞
├── 📦 舞蹈套装          → 子菜单：舞蹈套装浏览/详情/应用
├── 🎯 线框/骨骼/关节    → 调试开关
└── 🧊 碰撞胶囊          → 调试可视化开关
```

**子文件拆分**：

| 子文件 | 职责 | 函数 |
|--------|------|------|
| `motion-procmotion-levels.ts` | 程序化动作 + LipSync | `buildProcMotionLevel`, `buildProcMotionModeLevel`, `buildLipSyncLevel` |
| `motion-dance-sets.ts` | 舞蹈套装数据 + UI | `DanceSet` 类型, `loadDanceSets`, `buildDanceSetsOverviewLevel`, `buildDanceSetDetailLevel` |
| `motion-cloth-levels.ts` | 布料参数面板 | `buildClothParamsLevel` |

**跨文件复用**：`motion-popup.ts` 从 `motion-camera-levels` 直接导入相机面板，避免重复实现。

**代码入口**：`showMotionPopup()` → `motionMenu.reset(motionRootLevel)`（`motion-popup.ts`，items-based 根级）

---

### 🎬 场景弹窗

```
场景 ← 根菜单（scene-menu.ts）
├── 📋 预设场景 → 子菜单：预设场景浏览/加载/保存/删除
├── ✨ 后处理 → 子菜单：Bloom/轮廓线/色彩校正/景深/SSS/锐化/暗角/FXAA
├── 🎬 舞台 → 子菜单：色调映射/曝光/FOV/背景色/网格线
├── 🎭 渲染预设 → 子菜单：内置预设 + 用户保存预设
├── 💡 舞台灯光 → 子菜单：灯光参数面板
├── 📦 舞台道具 → 子菜单：道具加载/变换/列表
└── 📸 截图 → 子菜单：单帧/批量截图
```

**子文件拆分**（按功能域，解决 1700+ 行巨型文件问题）：

| 子文件 | 职责 | 函数 |
|--------|------|------|
| `motion-camera-levels.ts` | 相机模式 + 参数 | `buildCameraLevel`, `buildCameraParamsLevel` |
| `scene-render-levels.ts` | 后处理/舞台/渲染预设 | `buildPostProcessLevel`, `buildStageLevel`, `buildPresetsLevel`, `buildStageLightLevel` |

> 程序化动作 / LipSync 已迁移到 motion 域（`motion-procmotion-levels.ts`），见动作弹窗章节。

**代码入口**：`showSceneMenu()` → `sceneMenu.reset(rootItems)`（`scene-menu.ts`）

**路由机制**：`sceneOnFolderEnter()` 统一路由，根据 `row.target` 分发到子文件的 `build*Level`。

---

### 🌍 环境弹窗

```
环境 ← 根菜单（env-menu.ts）
├── ☀️ 天空 → 子菜单：天空模式/颜色/光照/太阳角度 + 环境预设
├── 🌊 水面 → 子菜单：水面开关/预设/Gerstner波浪参数
├── ✨ 粒子 → 子菜单：粒子类型/数量/速度/大小
├── 💨 风 → 子菜单：风向/风速/强度
├── 🧪 实验功能 → 子菜单：实验性环境功能
└── 📋 系统预设 → 子菜单：内置环境预设 + 用户保存预设
```

**子文件拆分**：

| 子文件 | 职责 | 函数 |
|--------|------|------|
| `env-feature-levels.ts` | 天空/地面/水面/风/云/实验功能 | `buildSkyLevel`, `buildGroundLevel`, `buildWaterLevel`, `buildWindLevel`, `buildCloudLevel`, `buildExperimentalLevel` |
| `env-preset-levels.ts` | 环境预设（内置 + 用户保存） | `buildPresetLevel`, `renderUserEnvPresets`, `snapshotCurrentEnvPreset` |
| `scene-prop-levels.ts` | 道具系统（从 env 迁入） | `buildPropLevel`, `buildPropDetailLevel` |

**代码入口**：`showEnvMenu()` → `envMenu.reset(rootItems)`（`env-menu.ts`）

---

### 🌐 下载弹窗

```
下载                        ← 根菜单
├── 资源网站               → 自定义渲染（renderCustom: 网站列表）
└── 直链下载               → 自定义渲染（renderCustom: URL 输入表单）
```

**代码入口**：`initDownloadManager()` → `downloadMenu.reset(rootLevel)`

---

## 功能域归属规则

> **硬规则**：文件名前缀 = 功能域。AI 判断代码归属依据文件名前缀。

| 前缀 | 域 | 职责 | 禁止放入 |
|------|----|------|---------|
| `scene-*` | 场景 | 保存/加载/预设/舞台/灯光/道具/截图/后处理/相机 | 程序化动作、LipSync、布料（属 motion 域）；天空/水面/粒子（属 env 域） |
| `motion-*` | 动作 | 程序化动作/LipSync/布料/重力/动作绑定/舞蹈套装 | 保存/加载场景、渲染预设（属 scene 域） |
| `env-*` | 环境 | 天空/水面/风/粒子/云/地面/环境预设 | 相机参数、截图（属 scene 域） |
| `model-*` | 模型 | 模型详情/材质/预设/换装 | 动作绑定、布料（属 motion 域） |
| `library-*` | 模型库 | 模型库浏览/搜索/缩略图 | 模型详情面板（属 model 域） |

### 违规检查

- `scene-*` 文件中**不得 import** `motion-*` / `env-*` 的 builder 函数
- `motion-*` 文件中**不得 import** `scene-render-levels` / `env-feature-levels` 的 builder 函数
- 跨域复用仅允许通过 barrel re-export（`scene-menu.ts` / `env-menu.ts` / `motion-popup.ts`）

### 迁移记录（2026-07）

- `motion-procmotion-levels.ts`（程序化动作归位 motion 域）
- `scene-menu.ts` 移除环境入口路由（环境功能仅从 `env-menu.ts` 访问）
- `scene-menu.ts` 移除动作路由（程序化动作/LipSync 仅从 `motion-popup.ts` 访问）

---

## renderCustom → items 渐进迁移

### 何时用 items vs renderCustom

| 场景 | 推荐方式 | 原因 |
|------|---------|------|
| 纯导航行（folder/action/model） | `items` | 支持增量 patch，reRender 不丢失焦点 |
| 内嵌滑块/开关/芯片组 | `items`（slider/toggle/modeSlider/chips kind） | 声明式，createRow 统一渲染 |
| 复杂表单（collapsible + 多控件） | `renderCustom` | 灵活，但 reRender 全量重建 |
| 动态列表（模型库/预设库） | `renderCustom` | 数据异步加载 |

### 已迁移到 items 的根级

| 文件 | 原 renderCustom | 新 items 结构 |
|------|----------------|--------------|
| `motion-popup.ts` | 模型列表 + 最近 + 音乐/程序化 + 重力滑块 + 布料 toggle | folder × N + divider + slider + folder+headerToggle |
| `env-menu.ts` | 预设芯片 + 天空/水面/粒子/风/实验 + 系统预设 | chips + divider + folder × 5（部分带 headerToggle）+ divider + folder |

### items-based 根级刷新模式

```typescript
// 持久根级对象
const rootLevel: PopupLevel = { label: '...', dir: '', items: [] };

// 动态 items 构建器
function buildRootItems(): PopupRow[] { /* 反映当前状态 */ }

// 刷新：重算 items + reRender
export function refreshRoot(): void {
    rootLevel.items = buildRootItems();
    menu?.reRender();
}

// 入口
export function showMenu(): void {
    if (menu) {
        rootLevel.items = buildRootItems();
        menu.resetToRoot();
        menu.reRender();
        return;
    }
    menu = makeMenu(wrapper);
    rootLevel.items = buildRootItems();
    menu.reset(rootLevel);
}
```

---

## 如何添加新功能（标准流程）

1. 确定功能属于哪个弹窗（场景 / 环境 / 动作 / 模型 / 设置）
2. 找到对应入口文件：
   - 场景 → `scene-menu.ts`（路由器 + 根级）
   - 环境 → `env-menu.ts`（导航 + 根级）
   - 动作 → `motion-popup.ts`（入口 + 动作绑定）
   - 模型 → `library-core.ts`（模型库）或 `model-detail.ts`（模型详情）
   - 设置 → `settings.ts`
3. 如果是**独立功能域**（300+ 行），新建子文件：`<menu>-<feature>-levels.ts`
4. 在入口文件的根级 `renderCustom` 中加一行 `slideRow`
5. 在路由器（`sceneOnFolderEnter` / `onFolderEnter`）中处理新 `target`
6. barrel re-export 新文件的 `build*Level` 函数
7. `npx tsc --noEmit` 确认零新错误

### 示例：在场景弹窗加「景深」功能

```typescript
// Step 1: 在 scene-render-levels.ts 添加 buildDepthOfFieldLevel()
export function buildDepthOfFieldLevel(): PopupLevel {
    return {
        label: '景深',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSliderRow(c, '焦距', ...);
                addSliderRow(c, '光圈', ...);
            });
        },
    };
}

// Step 2: 在 scene-menu.ts 的 sceneOnFolderEnter 中加路由
case 'scene:render:dof':
    return buildDepthOfFieldLevel();

// Step 3: 在 buildSceneRoot 或 buildPostProcessLevel 中加菜单行
slideRow(c, 'lucide:aperture', '景深', true, () =>
    sceneMenu.push(buildDepthOfFieldLevel())
);
```

### 跨弹窗复用

如果动作弹窗需要某个场景弹窗的面板（如相机模式），直接从子文件导入：

```typescript
// motion-popup.ts
import { buildCameraLevel } from './motion-camera-levels';
```

---

## 重要规则

- `extraButtonFactory` **必须是工厂函数**，每次返回新 DOM 节点（否则 `appendChild` 会移动旧节点）
- 设置项用 `kind: "action"`，不画 `>` 箭头，走 `onItemClick` 而不是 `onFolderEnter`
- 表单类内容用 `renderCustom`，不要用 `cloneNode(true)`（丢失状态和事件）
- 缩略图通过 `thumbnailCache` 单独管理，不要因为缩略图加载触发 `reRender`
