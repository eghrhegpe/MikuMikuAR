---
kind: menu_ui_system
name: 菜单与UI系统架构（SlideMenu_声明式Schema_状态绑定）
category: menu_ui_system
scope:
    - frontend/src/menus/
    - frontend/src/menus/menu-schema.ts
    - frontend/src/menus/menu.ts
---

## SlideMenu 引擎

`SlideMenu`（menu.ts, 1080 行）实现栈式导航菜单，支持子菜单推入/弹出、面包屑回退、hover 预览：

```typescript
class SlideMenu {
    private _renderingStack: MenuNode[] = [];  // 当前渲染路径
    private _container: HTMLDivElement;

    push(node: MenuNode) { this._renderingStack.push(node); this._render(); }
    pop() { this._renderingStack.pop(); this._render(); }
    backToRoot() { this._renderingStack = [this._root]; this._render(); }
}
```

**渲染上下文**：每次 `_render()` 从栈顶节点开始，生成面包屑 + 当前级菜单项。

## 声明式 Schema（menu-schema.ts）

菜单结构通过 `MenuNode` 声明式定义，不硬编码 DOM：

```typescript
interface MenuNode {
    id: string;
    label: string;
    icon?: string;
    children?: MenuNode[];        // 子菜单
    items?: MenuItem[];           // 叶子节点
    visibleWhen?: () => boolean;  // 动态显隐
    onEnter?: () => void;         // 进入回调
}

interface MenuItem {
    id: string;
    label: string;
    type: 'action' | 'toggle' | 'slider' | 'select';
    statePath?: StatePath;        // 绑定状态路径
    onClick?: () => void;
    min?: number; max?: number;   // slider 范围
    options?: string[];           // select 选项
}
```

## StatePath 类型化绑定

```typescript
// 路径前缀路由到不同状态对象
type StatePath = `env.${string}` | `render.${string}` | `ui.${string}`;

function getStateValue(path: StatePath): any {
    if (path.startsWith('env.')) return getNestedValue(envState, path.slice(4));
    if (path.startsWith('render.')) return getNestedValue(renderState, path.slice(7));
    if (path.startsWith('ui.')) return getNestedValue(uiState, path.slice(3));
}

function setStateValue(path: StatePath, value: any) {
    // 反向写入 → 触发持久化链路
}
```

## 菜单文件组织（64 个文件）

```
frontend/src/menus/
├── menu.ts              — SlideMenu 引擎核心
├── menu-schema.ts       — MenuNode/MenuItem 类型定义
├── menu-factory.ts      — 工厂函数（创建各类菜单项）
├── env-menu.ts          — 环境菜单总入口
├── motion-popup.ts      — 动作菜单总入口
├── scene-menu.ts        — 场景菜单总入口
├── settings.ts          — 设置页总入口
├── ...（其他菜单文件）
└── __tests__/           — 单元测试
```

## 回调钩子

```typescript
// SlideMenu 支持外部注入行为
menu.onItemClick = (item: MenuItem) => { ... };
menu.onFolderEnter = (node: MenuNode) => { ... };
menu.onHover = (item: MenuItem) => { ... };
menu.onAfterRender = () => { ... };
```

## visibleWhen 动态显隐

```typescript
// 菜单项根据运行时条件动态显示/隐藏
{
    id: 'ground-settings',
    label: '地面设置',
    visibleWhen: () => envState.ground.enabled,
    children: [...]
}
```

每次 `_render()` 重新求值 `visibleWhen`，不满足条件的节点被跳过。

## 开发者规则

| 规则 | 说明 |
|------|------|
| 新增菜单项 | 在对应菜单文件（如 `env-menu.ts`、`motion-popup.ts`）中用 `MenuNode` 声明 |
| 绑定状态 | 使用 `statePath: 'env.xxx'` 自动双向绑定 |
| 动态显隐 | 用 `visibleWhen: () => boolean`，不手动操作 DOM |
| 不直接操作 DOM | 通过 Schema 声明 + 引擎渲染，保持数据驱动 |
