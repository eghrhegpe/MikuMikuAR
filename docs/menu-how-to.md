# MikuMikuAR — 菜单操作指南

> 所有弹窗统一使用 `SlideMenu` 导航栈模式（`menu.ts`）。
> 添加新功能 = 在对应的根菜单加一行，然后实现路由分发。
> **声明式 Schema 为推荐主路径**，详见 [design.md](./design.md) 与 [ADR-093](./adr/adr-093-menu-declarative-schema.md)。

---

## 弹窗入口文件位置

```
frontend/src/menus/
├── menu.ts                      # SlideMenu 核心类（导航栈 + 动画 + dispose）
├── menu-schema.ts               # MenuNode 声明式 schema 类型 + StatePath 解析器（ADR-093）
├── render-menu.ts               # 单渲染器 renderMenu()，遍历 MenuNode[] 分发到 ui-helpers
├── menu-factory.ts              # registerPopupMenu 注册范式（get/refresh/show 统一）
│
├── library-core.ts              # 模型库核心（扫描/搜索/层级/标签）
├── library.ts                   # barrel re-export
├── model-detail.ts              # 模型详情（信息/变换/可见性/表情）
├── model-material.ts            # 逐材质 + 分类调参
├── model-preset.ts              # 模型预设保存/加载/库管理
├── outfit-ui.ts                 # 服装变体子菜单
├── preset-list-viewer.ts        # 通用预设列表渲染后端
├── resource-detail-helpers.ts    # 资源详情页辅助
│
├── scene-menu.ts                 # 场景弹窗入口 + 路由器
│   ├── scene-render-levels.ts    #   后处理/预设场景
│   ├── scene-render-presets.ts   #   渲染预设（滤镜/快照）
│   ├── scene-stage-levels.ts     #   舞台
│   ├── scene-stage-lights.ts    #   舞台灯光
│   ├── scene-prop-levels.ts      #   道具系统
│   └── scene-physics-levels.ts   #   物理（碰撞/WASM/调试）
│
├── env-menu.ts                  # 环境弹窗入口 + 导航
│   ├── env-sky-levels.ts        #   天空
│   ├── env-ground-levels.ts     #   地面
│   ├── env-water-levels.ts      #   水面
│   ├── env-wind-levels.ts       #   风
│   ├── env-cloud-levels.ts      #   云
│   ├── env-fog-levels.ts        #   雾
│   ├── env-shadow-levels.ts     #   阴影
│   ├── env-experimental-levels.ts#  实验功能
│   ├── env-level-helpers.ts     #   公共助手
│   ├── env-menu-state.ts        #   状态模块
│   └── env-preset-levels.ts     #   环境预设
│
├── motion-popup.ts              # 动作弹窗入口
│   ├── motion-camera-levels.ts  #   相机控制/行为双轴 + 参数面板（ADR-100）
│   ├── motion-procmotion-levels.ts # 程序化动作
│   ├── motion-override-levels.ts #  骨骼覆盖
│   ├── motion-pose-levels.ts    #   姿态工作室
│   ├── motion-cloth-levels.ts   #   布料参数面板
│   ├── motion-feet-levels.ts    #   脚部贴地
│   └── motion-gaze-levels.ts    #   视线追踪/感知层
│
├── settings.ts                  # 设置页（SlideMenu）
│   ├── settings-shared.ts       #   共享类型 + 工具
│   ├── settings-language.ts     #   语言选择（纯 items）
│   ├── settings-targets.ts      #   目标设置
│   ├── settings-performance.ts  #   性能
│   ├── settings-screenshot.ts   #   截图
│   ├── settings-audio.ts        #   音频
│   ├── settings-appearance.ts   #   外观
│   ├── settings-external.ts     #   外部库
│   ├── settings-filename.ts     #   文件名
│   ├── settings-shortcuts.ts    #   快捷键
│   ├── settings-paths.ts        #   路径
│   ├── settings-about.ts        #   关于
│   └── settings-software.ts     #   软件管理
│
├── plaza-browser.ts             # 模型广场入口（showPlaza/renderHome/renderEmbed）
├── plaza-state.ts               # 广场模块级状态 + closePlaza/stopProxy
├── plaza-download.ts            # 下载代理（handlePlazaDownload/installDownloadListener）
├── plaza-thumbnail.ts           # 缩略图
└── plaza-sites.ts                # 广场站点列表
```

**代码入口**：
- 场景 → `showSceneMenu()`（`scene-menu.ts`）
- 环境 → `showEnvMenu()`（`env-menu.ts`）
- 动作 → `showMotionPopup()`（`motion-popup.ts`）
- 模型库 → `showModelPopup()`（`library-core.ts`，经 `library.ts` barrel 导出）
- 设置 → `showSettings()`（`settings.ts`）
- 下载 → 见「设置」页「下载监控目录 / 自动导入」（由 Go 绑定 `SetDownloadWatchDir` 等驱动，无顶层入口函数）

---

## 添加一行菜单的标准流程

> **推荐：声明式 Schema**（ADR-093）。仅当为纯导航或渲染后端工具时才用命令式。

1. 确定功能归属弹窗（场景/环境/动作/模型/设置）
2. 找到对应入口文件
3. 如果是**独立功能域**（300+ 行），新建子文件：`<menu>-<feature>-levels.ts`
4. 在文件中新增 `buildXxxSchema(): MenuNode[]` 工厂函数
5. 导出 `buildXxxLevel(): PopupLevel` 包装 `renderMenu(buildXxxSchema(), container)`
6. 在根菜单的 `items` 中加 `PopupRow` 导航项（`target: '<domain>:<feature>'`）
7. 在路由函数（`sceneOnFolderEnter` / `onFolderEnter`）中处理新 `target`
8. barrel re-export 新文件的 `build*Level` 函数
9. `npm run check` 确认零新错误

### 示例：场景弹窗加「景深」功能（Schema 方式）

```typescript
// scene-render-levels.ts 添加 schema 工厂
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function buildDepthOfFieldSchema(): MenuNode[] {
    return [
        {
            id: 'dof:focus',
            kind: 'slider',
            label: 'scene.dofFocus',
            icon: 'lucide:aperture',
            control: { bind: 'render.dofFocus', min: 0, max: 50, step: 0.5 },
        },
        {
            id: 'dof:aperture',
            kind: 'slider',
            label: 'scene.dofAperture',
            icon: 'lucide:circle-dot',
            control: {
                bind: 'render.dofAperture',
                min: 0, max: 8, step: 0.1,
                onChange: () => reRenderSceneMenu(),  // 复合状态副作用
            },
        },
    ];
}

export function buildDepthOfFieldLevel(): PopupLevel {
    return {
        label: t('scene.dof'), dir: '', items: [],
        renderCustom: (container) => {
            renderMenu(buildDepthOfFieldSchema(), container);
        },
    };
}

// scene-menu.ts 的路由表中加条目
case 'scene:render:dof':
    return buildDepthOfFieldLevel();

// buildSceneRoot 的 items 中加导航行
items.push({
    kind: 'folder',
    label: t('scene.dof'),
    icon: 'lucide:aperture',
    target: 'scene:render:dof',
});
```

### 命令式示例（仅用于 `custom` 节点内部或纯导航）

```typescript
// custom 节点内部用 slideRow 渲染动态列表
{
    id: 'list:dynamic',
    kind: 'custom',
    renderCustom: (c) => {
        cardContainer(c, (inner) => {
            for (const item of getDynamicList()) {
                slideRow(inner, item.icon, item.label, true,
                    () => getSceneMenu()!.push(buildItemDetailLevel(item.id)));
            }
        });
    },
}
```

---

## 路由器分发规则

每个主菜单文件的 `onFolderEnter`（或 `sceneOnFolderEnter`）函数根据 `row.target` 字符串路由到子文件的 `build*Level`：

```typescript
function sceneOnFolderEnter(row: PopupRow): PopupLevel | null {
    switch (row.target) {
        case 'scene:postprocess': return buildPostProcessLevel();
        case 'scene:stage':       return buildStageLevel();
        case 'scene:props':       return buildPropLevel();
        // ...
    }
    return null;
}
```

**路由约定**：`<domain>:<feature>[:<sub>]`，如 `env:sky`、`scene:render:dof`。

---

## 功能域归属规则

> **硬规则**：文件名前缀 = 功能域。

| 前缀 | 域 | 职责 | 禁止放入 |
|------|----|------|---------|
| `scene-*` | 场景 | 保存/加载/预设/舞台/灯光/道具/截图/后处理/相机 | 程序化动作、LipSync、布料 |
| `motion-*` | 动作 | 程序化动作/LipSync/布料/重力/动作绑定 | 保存/加载场景、渲染预设 |
| `env-*` | 环境 | 天空/水面/风/粒子/云/地面/环境预设 | 相机参数、截图 |
| `model-*` | 模型 | 模型详情/材质/预设/换装 | 动作绑定、布料 |
| `library-*` | 模型库 | 模型库浏览/搜索/缩略图 | 模型详情面板 |

**违规检查**：`scene-*` 不得 import `motion-*`/`env-*` 的 builder；跨域复用仅通过 barrel re-export。

---

## 关键 API

`SlideMenu` 是导航栈类（`menu.ts`），其方法为**实例方法**，需通过各域的菜单实例调用，不能当静态方法用。

**取菜单实例（按域）**：
```typescript
getSceneMenu()!    // 场景栈（scene-menu.ts 导出）
getEnvMenu()!      // 环境栈（env-menu.ts 导出）
getMotionMenu()!   // 动作栈（motion-popup.ts 导出）
stackRegistry.modelStack   // 模型库栈（注册表直接字段，core/utils.ts）
```

**实例方法**（下面 `stack` 为上面任一实例）：
```typescript
stack.push(level)        // 推入新层（动画进入）
stack.pop()              // 退回上一层
stack.popTo(index)       // 退回到指定层级
stack.reset(rootLevel)   // 清空全部层，显示根层
stack.setLevel(i, lvl)   // 替换指定层级
stack.reRender()         // 全部重建
```

**推荐导航模式**：菜单行带 `target`，`onFolderEnter` 返回 `PopupLevel`，框架自动 push，无需手动调用：
```typescript
// scene-menu.ts 的 sceneOnFolderEnter
case 'scene:render:dof': return buildDepthOfFieldLevel();
```

**文件浏览类层级**：用工厂 `stackRegistry.buildLevel!(domain, label, filter, menuWrapper)`，第 4 参传目标栈实例：
```typescript
const level = stackRegistry.buildLevel!('environment', t('env.skyTexture'),
    (m) => ['png','jpg','hdr','dds'].includes(m.format), getEnvMenu()!);
getEnvMenu()!.push(level);
```

PopupLevel 和 PopupRow 类型见 `menu.ts`，行 kind 支持 `folder`/`action`/`model`/`divider`/`slider`/`toggle`/`modeSlider`/`chips`。

跨弹窗复用从子文件直接 import：`import { buildCameraLevel } from './motion-camera-levels'`

---

## 重要规则

- **新增菜单优先用 Schema**（ADR-093）。`MenuNode` + `renderMenu()` 是推荐主路径；命令式 `slideRow` / `addSliderRow` 仅用于 `custom` 节点内部或纯导航 `items`
- **schema `folder` ≠ 导航项**：`folder` kind 用 `children` 展开折叠子节点；纯导航用 `PopupRow` items + `target` 路由
- **StatePath 绑定优先**：能用 `env.` / `render.` / `light.` / `ui.` / `perception.` 前缀表达的，不要用 `custom` 节点
- **`custom` 节点须返回 dispose**：内部创建的 DOM/监听器/计时器在层级卸载时要释放，否则泄漏（ADR-093 §5 P1）
- `extraButtonFactory` 必须是工厂函数，每次返回新 DOM 节点
- 设置项用 `kind: "action"`，不画 `>` 箭头
- 表单类内容用 `renderCustom`（或 `custom` 节点）
- 缩略图通过 `thumbnailCache` 单独管理，不要触发 `reRender`
