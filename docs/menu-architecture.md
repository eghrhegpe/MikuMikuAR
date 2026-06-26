# MikuMikuAR — 菜单架构设计

> 所有弹窗统一使用 `MenuStack` 导航栈模式（`menu.ts`）。
> 添加新功能 = 在对应的根菜单加一行，然后实现 `onItemClick` 或 `onFolderEnter`。

---

## 核心机制

`MenuStack` 类管理一个导航栈（`levels: PopupLevel[]`），每个层级是一个独立浮层（`.popup-layer`），浮层之间用淡入淡出 + 偏移实现卡片堆叠效果。

### 关键 API

```
MenuStack.reset(level)       — 清空全部层，显示根层（无动画）
MenuStack.push(level)        — 推入新层（动画进入）
MenuStack.pop()              — 退回上一层（动画离开）
MenuStack.popTo(index)       — 退回到指定层级
MenuStack.reRender()         — 全部重建（名称优先级切换等）
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
    kind: "folder" | "model" | "action";
    label: string;
    icon: string;
    target: string;      // 用于识别行类型
    sublabel?: string;   // 灰色小字
    model?: LibraryModel;
};
```

### 三种行类型

| kind | 箭头 | 点击行为 | 用途 |
|------|------|---------|------|
| `folder` | > | 调用 `onFolderEnter` → 返回下一级 `PopupLevel` → `push()` | 导航到子菜单或文件浏览器 |
| `action` | 无 | 调用 `onItemClick` | 设置项、切换、操作 |
| `model` | 无 | 调用 `onItemClick` | 加载模型/动作文件 |

---

## 弹窗结构

### 🎵 模型弹窗

```
模型                        ← 根菜单
├── 🎯 加载模型            → 第二层：PMX 文件夹浏览（buildLevel + pmx 过滤）
├── 📷 相机                → 子菜单：轨道/自由飞行/镜头预设/演唱会
├── ⏱ 动作倍率            → 预留（reserved:speed）
├── ✨ 角色定制            → 预留（reserved:customize）
├── 📊 模型信息            → renderCustom 面板：顶点/材质/骨骼/文件数
├── 😊 表情预览            → 子菜单：Facial morph 滑块列表  
├── 📸 批量截图            → action：触发批量缩略图
├── 📤 导出到 MMD          → action：调用 OpenInMMD binding
└── 🔄 重新扫描            → action，触发 refreshLibrary
```

### ⚙ 设置弹窗

```
设置                        ← 根菜单
├── 🎨 显示                → action: 日文名 / 英文名 / 文件名
├── ⬇ 下载                → action: 监听目录 / 自动导入
├── ⚙ 系统                → action: 清除缓存
└── 🔌 外部库              → action，打开外部库管理面板
```

**添加新功能**：在 `showPopup()` 的 `rootItems` 数组加一行。

**示例 — 添加「物理设置」功能**：
```typescript
// library.ts showPopup() 中
const rootItems: PopupRow[] = [
    { kind: "folder", label: "🎯 加载模型", icon: "📁", target: "models:browse" },
    { kind: "folder", label: "🔧 物理设置", icon: "🔧", target: "models:physics" },  // ← 新增
    // ... 保留其他项
];

// makeModelStack() 的 onFolderEnter 中
if (row.target === "models:physics") {
    return { label: "物理设置", dir: "", items: [
        { kind: "action", label: "重力", icon: "⬇", target: "set:gravity" },
        { kind: "action", label: "布料模拟", icon: "🧵", target: "set:cloth" },
    ]};
}
```

---

### 💃 动作弹窗

```
动作                        ← 根菜单
├── 💃 加载动作            → 第二层：VMD 文件夹浏览（buildLevel + vmd 过滤）
├── 🎵 加载音乐            → 文件选择：MP3/WAV/OGG/M4A/AAC
│   └── ⏱ 音频偏移        → 滑块：-5s~+5s
├── 🎵🎬 舞蹈套装          → 子菜单：VMD+音频捆绑文件夹浏览
└── ⏱ 动作倍率            → 滑块：0.25x~2x
```

**代码入口**：`showMotionPopup()` → `motionStack.reset(rootItems)`

---

### 🎬 场景弹窗

```
场景 ← 根菜单
├── 📷 相机模式 → 子菜单：轨道/自由飞行/镜头预设/演唱会
├── 💡 灯光 → 子菜单：环境光强度/方向光强度/方向光角度XZ
├── 🎨 材质 → 子菜单：皮肤/头发/眼睛/衣服（各含滑块）
│   └── 🖌 单独材质编辑 → renderCustom 面板，逐材质独立调参
├── ✨ 后处理 → 子菜单：Bloom/轮廓线/色彩校正/景深/SSS/锐化/暗角/FXAA
├── 🎬 舞台 → 子菜单：反射地面/色调映射/曝光/FOV/背景色/网格线
├── 🎭 渲染预设 → action：展开预设列表（标准/卡通/写实/暖光/赛博朋克/etc）
├── ⏱ 动画速度 → 滑块：0.1x~3x
├── ⬇ 重力 → 滑块：衣物/头发物理摆动强度
├── 🎥 加载相机VMD → 文件选择
├── 📸 截图 → action：单帧截图 / 批量截图
└── 🔲 显示 → 子菜单：线框/骨骼/地面 toggle
```

**代码入口**：`showSceneMenu()` → `sceneStack.reset(rootItems)`（`scene-menu.ts`）

**特别注意**：场景弹窗从 2 项暴增到 10+ 项，根菜单过长时考虑把「渲染」相关归入一个 `🎨 渲染设置` 文件夹分类。

---

### ⚙ 设置弹窗

```
设置                        ← 根菜单
├── 🎨 显示                → action: 日文名（name_jp）/ 英文名（name_en）/ 文件名（filename）
├── ⬇ 下载                → action: 监听目录 / 自动导入
├── 🧰 软件管理            → 子菜单：扫描 software/ 目录，列出可执行程序
├── 🌐 语言                → action：简体中文 / English
├── ⚙ 系统                → action: 清除提取缓存
└── 🔌 外部库              → action，打开外部库管理面板
```

**代码入口**：`showSettings()` → `settingsStack.reset(rootLevel)`

**特点**：所有叶子菜单项用 `kind: "action"`，通过 `handleSettingsAction()` 分发。

---

### 🌐 下载弹窗

```
下载                        ← 根菜单
├── 资源网站               → 自定义渲染（renderCustom: 网站列表）
└── 直链下载               → 自定义渲染（renderCustom: URL 输入表单）
```

**代码入口**：`initDownloadManager()` → `downloadStack.reset(rootLevel)`

---

## 如何添加新功能（标准流程）

1. 打开 `library.ts`（或对应弹窗的文件）
2. 在 `showXxx()` 的 `rootItems` 数组中加一行 `PopupRow`
3. 如果是 **导航到子菜单**（`folder`）：在 `makeXxxStack()` 的 `onFolderEnter` 中处理新 `target`
4. 如果是 **直接操作**（`action`）：在 `onItemClick` 中处理，或加专用回调函数
5. 重建确认无 TypeScript 错误

### 示例：在模型弹窗加「物理设置」

```typescript
// Step 1: 加菜单项
const rootItems: PopupRow[] = [
    { kind: "folder", label: "🎯 加载模型", icon: "📁", target: "models:browse" },
    { kind: "folder", label: "🔧 物理设置", icon: "🔧", target: "models:physics" },  // +
    { kind: "folder", label: "📷 相机", ... },
    ...
];

// Step 2: 处理导航
onFolderEnter: (row) => {
    if (row.target === "models:browse") { ... }
    if (row.target === "models:physics") {                       // +
        return { label: "物理设置", dir: "", items: [           // +
            { kind: "action", label: "重力", icon: "⬇", target: "set:gravity" },
            { kind: "action", label: "布料模拟", icon: "🧵", target: "set:cloth" },
        ]};
    }
    ...
}
```

---

## 重要规则

- `extraButtonFactory` **必须是工厂函数**，每次返回新 DOM 节点（否则 `appendChild` 会移动旧节点）
- 设置项用 `kind: "action"`，不画 `>` 箭头，走 `onItemClick` 而不是 `onFolderEnter`
- 表单类内容用 `renderCustom`，不要用 `cloneNode(true)`（丢失状态和事件）
- 缩略图通过 `thumbnailCache` 单独管理，不要因为缩略图加载触发 `reRender`
