# MikuMikuAR — 菜单操作指南

> 所有弹窗统一使用 `SlideMenu` 导航栈模式（`menu.ts`）。
> 添加新功能 = 在对应的根菜单加一行，然后实现路由分发。

---

## 弹窗入口文件位置

```
frontend/src/menus/
├── menu.ts                      # SlideMenu 核心类（导航栈 + 动画 + dispose）
├── library-core.ts              # 模型库核心（扫描/搜索/层级/标签）
├── model-detail.ts              # 模型详情（信息/变换/可见性/表情）
├── model-material.ts            # 逐材质 + 分类调参
├── model-preset.ts              # 模型预设保存/加载/库管理
├── outfit-ui.ts                 # 服装变体子菜单
│
├── scene-menu.ts                # 场景弹窗入口 + 路由器
│   ├── scene-render-levels.ts   #   后处理/舞台/渲染预设
│   └── scene-prop-levels.ts     #   道具系统
│
├── env-menu.ts                  # 环境弹窗入口 + 导航
│   ├── env-feature-levels.ts    #   天空/地面/水面/风/云/实验功能
│   ├── scene-prop-levels.ts     #   道具系统
│   └── env-preset-levels.ts     #   环境预设
│
├── motion-popup.ts              # 动作弹窗入口
│   ├── motion-camera-levels.ts  #   相机模式 + 参数面板
│   ├── motion-procmotion-levels.ts # 程序化动作 + LipSync
│   └── motion-cloth-levels.ts   #   布料参数面板
│
└── settings.ts                  # 设置页（MenuStack）
    └── settings-software.ts     #   软件管理子菜单
```

**代码入口**：
- 场景 → `showSceneMenu()`（`scene-menu.ts`）
- 环境 → `showEnvMenu()`（`env-menu.ts`）
- 动作 → `showMotionPopup()`（`motion-popup.ts`）
- 模型库 → `showModelLibrary()`（`library-core.ts`）
- 设置 → `showSettings()`（`settings.ts`）
- 下载 → `initDownloadManager()`

---

## 添加一行菜单的标准流程

1. 确定功能归属弹窗（场景/环境/动作/模型/设置）
2. 找到对应入口文件
3. 如果是**独立功能域**（300+ 行），新建子文件：`<menu>-<feature>-levels.ts`
4. 在根级 items 或 `renderCustom` 中加一行 `slideRow`
5. 在路由函数（`sceneOnFolderEnter` / `onFolderEnter`）中处理新 `target`
6. barrel re-export 新文件的 `build*Level` 函数
7. `npm run check` 确认零新错误

### 示例：场景弹窗加「景深」功能

```typescript
// scene-render-levels.ts 添加 buildDepthOfFieldLevel()
export function buildDepthOfFieldLevel(): PopupLevel {
    return {
        label: '景深', dir: '', items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSliderRow(c, '焦距', ...);
                addSliderRow(c, '光圈', ...);
            });
        },
    };
}

// scene-menu.ts 的 sceneOnFolderEnter 中加路由
case 'scene:render:dof':
    return buildDepthOfFieldLevel();

// buildSceneRoot 或 buildPostProcessLevel 中加菜单行
slideRow(c, 'lucide:aperture', '景深', true, () =>
    sceneMenu.push(buildDepthOfFieldLevel())
);
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
| `motion-*` | 动作 | 程序化动作/LipSync/布料/重力/动作绑定/舞蹈套装 | 保存/加载场景、渲染预设 |
| `env-*` | 环境 | 天空/水面/风/粒子/云/地面/环境预设 | 相机参数、截图 |
| `model-*` | 模型 | 模型详情/材质/预设/换装 | 动作绑定、布料 |
| `library-*` | 模型库 | 模型库浏览/搜索/缩略图 | 模型详情面板 |

**违规检查**：`scene-*` 不得 import `motion-*`/`env-*` 的 builder；跨域复用仅通过 barrel re-export。

---

## 关键 API

```typescript
SlideMenu.reset(level)       // 清空全部层，显示根层
SlideMenu.push(level)        // 推入新层（动画进入）
SlideMenu.pop()              // 退回上一层
SlideMenu.popTo(index)       // 退回到指定层级
SlideMenu.reRender()         // 全部重建
```

PopupLevel 和 PopupRow 类型见 `menu.ts`，行 kind 支持 `folder`/`action`/`model`/`divider`/`slider`/`toggle`/`modeSlider`/`chips`。

跨弹窗复用从子文件直接 import：`import { buildCameraLevel } from './motion-camera-levels'`

---

## 重要规则

- `extraButtonFactory` 必须是工厂函数，每次返回新 DOM 节点
- 设置项用 `kind: "action"`，不画 `>` 箭头
- 表单类内容用 `renderCustom`
- 缩略图通过 `thumbnailCache` 单独管理，不要触发 `reRender`
