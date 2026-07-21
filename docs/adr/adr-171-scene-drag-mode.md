# ADR-171 — 场景级拖拽模式：快捷开关 + 收纳文件夹

> **状态**: 已完成
> **日期**: 2026-07-22
> **关联**: ADR-126（TransformAdapter Registry）、ADR-049（Gizmo 拖拽取代滑块）、ADR-093（声明式菜单 Schema）

## 1. 问题陈述

当前拖拽定位入口**深藏于每个对象的详情页**：

| 对象类型 | 入口路径 | 层级深度 |
|----------|---------|---------|
| 角色/舞台模型 | 模型库 → 模型详情 → 拖拽操控卡片 | 3 层 |
| 道具 | 场景 → 道具 → 道具详情 → 拖拽卡片 | 4 层 |
| 舞台 | 场景 → 舞台 → 舞台详情 → 拖拽卡片 | 4 层 |
| 灯光 | 场景 → 灯光 → 灯光详情 → 拖拽卡片 | 4 层 |

**缺陷**：

| 场景 | 表现 |
|------|------|
| 摆拍多对象（角色 + 道具 + 灯） | 每调一个对象都要钻进各自详情页开关 Gizmo，来回切换 |
| 用户想"先选对象再拖" | 不支持——必须先开 Gizmo 再拖，心智模型倒置 |
| 网格吸附等全局偏好 | 藏在详情卡片里，发现性差 |
| 快捷关闭 | 拖完想退出拖拽模式，得回到刚才那个详情页点退出 |

**根因**：拖拽是**对象级功能**（per-object Gizmo attach），但用户的操作心智是**场景级模式**（"我现在要摆东西了"）。

**转机**：ADR-126 的 TransformAdapter Registry 已提供跨 kind 统一抽象——`attachGizmoForKind(kind, id)` 一行即可挂载任意对象的 Gizmo。缺的只是一个**场景级入口 + 命中→kind 解析层**。

## 2. 设计目标

| # | 目标 | 验收标准 |
|---|------|---------|
| G1 | 场景菜单一级入口：文件夹 + headerToggle 快捷开关（与地面/水面同级模式） | 场景弹窗根级可见「拖拽定位」行，右侧开关一键启停 |
| G2 | 开启后点击场景任意可拖对象，自动挂载 Gizmo | 点角色→挂角色 Gizmo；点道具→挂道具 Gizmo；点灯→挂灯 Gizmo |
| G3 | 点击空白处或再点开关 → 退出拖拽模式 | Gizmo 卸载，指针恢复正常轨道控制 |
| G4 | 文件夹内收纳全局拖拽偏好 | 网格吸附开关 + 步长、拖拽模式说明 |
| G5 | 详情页拖拽卡片保持可用（向后兼容） | 旧路径不受影响；两处状态同步（详情卡片反映场景级 Gizmo 状态） |
| G6 | 不可拖对象有明确反馈 | 点击地面/水面/天空盒等 → 状态栏提示"该对象不支持拖拽" |
| G7 | 多对象切换无残留 | 点 A 再点 B → A 的 Gizmo 自动卸载，B 挂载（单 Gizmo 原则不变） |

## 3. 方案设计

### 3.1 状态定义

在 `scene/transform/transform-mode.ts`（新文件）中定义场景级拖拽模式状态：

```typescript
// scene/transform/transform-mode.ts
import { signal } from '../../core/reactivity';

/** 场景级拖拽模式开关（唯一状态源） */
export const dragModeEnabled = signal(false);

export function setDragMode(enabled: boolean): void {
    dragModeEnabled.value = enabled;
    if (!enabled) {
        detachGizmo(); // 退出时卸载当前 Gizmo
    }
}

export function isDragModeEnabled(): boolean {
    return dragModeEnabled.value;
}
```

**状态同步契约**：
- `buildTransformCard` 中的 Gizmo 状态判断（`isGizmoActive() && getGizmoTargetId() === id`）不变——它反映的是"当前哪个对象挂了 Gizmo"，与模式开关正交。
- 场景菜单 headerToggle 绑定 `dragModeEnabled`，通过 `bind()` 自动同步。

### 3.2 命中解析：Pointer → Kind → Adapter

新增 `scene/transform/transform-pick.ts`：

```typescript
// scene/transform/transform-pick.ts
import type { Scene, AbstractMesh } from '@babylonjs/core';

export interface DragPickResult {
    kind: TransformKind;  // 'actor' | 'stage' | 'prop' | 'light'
    id: string;
}

/** 从 Babylon 命中结果解析出可拖拽对象的 kind + id */
export function resolveDragTarget(scene: Scene, pointerInfo: PointerInfo): DragPickResult | null {
    const mesh = pointerInfo.pickInfo?.pickedMesh;
    if (!mesh) return null;

    // 沿父链向上查找携带元数据的根节点
    let node: AbstractMesh | null = mesh;
    while (node) {
        const meta = node.metadata as { modelId?: string; propId?: string; lightId?: string; stageId?: string } | undefined;
        if (meta?.modelId) {
            // 区分 actor vs stage：查 modelRegistry 的 kind 字段
            const kind = modelRegistry.get(meta.modelId)?.isStage ? 'stage' : 'actor';
            return { kind, id: meta.modelId };
        }
        if (meta?.propId) return { kind: 'prop', id: meta.propId };
        if (meta?.lightId) return { kind: 'light', id: meta.lightId };
        if (meta?.stageId) return { kind: 'stage', id: meta.stageId };
        node = node.parent as AbstractMesh | null;
    }
    return null;
}
```

**元数据注入点**（现有代码已有 metadata 挂载的位置，实施时逐一确认）：
- 模型：`model-loader.ts` 加载完成后对根 mesh 设置 `metadata.modelId`
- 道具：`props.ts` 创建道具 mesh 时设置 `metadata.propId`
- 灯光：`lighting-stage.ts` 创建灯光代理 mesh 时设置 `metadata.lightId`
- 舞台：`scene-stage-levels.ts` / `env-terrain.ts` 舞台 mesh 设置 `metadata.stageId`

若某类对象尚未注入 metadata，Phase 1 实施时补齐（每处 1-3 行）。

### 3.3 场景级指针监听

在 `scene/scene.ts` 的 `onPointerObservable` 中注册（与水面涟漪点击同模式）：

```typescript
// scene/scene.ts — initScenePointerHandling() 内追加
scene.onPointerObservable.add((pointerInfo) => {
    if (!isDragModeEnabled()) return;
    if (pointerInfo.type !== PointerEventTypes.POINTERUP) return;
    // Gizmo 自身拖拽事件不拦截（Gizmo 内部已消费）
    if (isGizmoDragging()) return;

    const target = resolveDragTarget(scene, pointerInfo);
    if (target) {
        attachGizmoForKind(target.kind, target.id);
        setStatus(t('scene.dragModeAttached', { name: target.id }), false);
    } else {
        // 点空白 → 退出拖拽模式
        setDragMode(false);
        setStatus(t('scene.statusExitDrag'), true);
    }
});
```

**与 Gizmo 拖拽的互斥**：`transform-gizmo.ts` 需暴露 `isGizmoDragging(): boolean`（拖拽 observable 起止标记），避免 Gizmo 拖拽结束的 POINTERUP 被误判为"点空白退出"。

### 3.4 场景菜单入口

`menus/scene-menu.ts` — `buildSceneRootItems()` 追加（位于灯光之后、地面之前，高频操作区）：

```typescript
items.push({
    kind: 'folder',
    label: t('scene.dragMode'),
    icon: 'lucide:move-3d',
    target: 'scene:dragMode',
    headerToggle: {
        value: isDragModeEnabled(),
        onChange: (v: boolean) => setDragMode(v),
        bind: () => isDragModeEnabled(),
    },
});
```

`SCENE_FOLDER_ROUTES` 追加：

```typescript
'scene:dragMode': buildDragModeLevel,
```

### 3.5 文件夹内容（buildDragModeLevel）

新文件 `menus/scene-drag-levels.ts`：

```typescript
export function buildDragModeLevel(): PopupLevel {
    return {
        label: t('scene.dragMode'),
        dir: 'scene:dragMode',
        items: [],
        itemBuilder: (container) => {
            // 1. 模式开关行（与 headerToggle 同源）
            addToggleRow(container, t('scene.dragModeEnable'), isDragModeEnabled(), (v) => {
                setDragMode(v);
            }, 'lucide:move-3d');

            // 2. 网格吸附（从 buildTransformCard 提取为共享构建器）
            buildSnapSettings(container);

            // 3. 操作说明（i18n 富文本）
            addHintRow(container, t('scene.dragModeHint'));
        },
    };
}
```

**共享提取**：`resource-detail-helpers.ts` 中的吸附设置 UI（`getGizmoSnapConfig` / `setGizmoSnapDistance` 相关行）提取为 `buildSnapSettings(container)` 公共函数，详情卡片与文件夹共用——消除重复（审核维度：显著重复检查）。

### 3.6 i18n 键

5 语言（zh-CN / zh-TW / ja / en / ko）新增：

| key | zh-CN |
|-----|-------|
| `scene.dragMode` | 拖拽定位 |
| `scene.dragModeEnable` | 启用拖拽模式 |
| `scene.dragModeHint` | 开启后点击场景中的模型、道具或灯光即可拖动调整位置，点击空白处退出 |
| `scene.dragModeAttached` | 已挂载拖拽：{name} |
| `scene.dragModeUnsupported` | 该对象不支持拖拽 |

## 4. 实施计划

| Phase | 内容 | 涉及文件 |
|-------|------|---------|
| P1 | 状态层 + 命中解析 | `scene/transform/transform-mode.ts`（新）、`scene/transform/transform-pick.ts`（新）、metadata 注入点补齐 |
| P2 | 指针监听 + Gizmo 互斥 | `scene/scene.ts`、`scene/render/transform-gizmo.ts`（暴露 `isGizmoDragging`） |
| P3 | 菜单入口 + 文件夹 | `menus/scene-menu.ts`、`menus/scene-drag-levels.ts`（新）、`menus/resource-detail-helpers.ts`（提取 `buildSnapSettings`） |
| P4 | i18n + 测试 + 文档 | `core/i18n/locales/*`、`menus/__tests__/scene-drag-levels.test.ts`（新）、`docs/status.md` 更新 |

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 模型 mesh 父链无 metadata（旧加载路径） | 点击无响应 | P1 逐一排查 metadata 注入点；resolveDragTarget 返回 null 时静默忽略（不误退出模式）——仅点**空白**才退出 |
| Gizmo 拖拽结束事件与模式退出竞态 | 拖完松手误触发退出 | `isGizmoDragging()` 守卫 + POINTERUP 延迟一帧判断（`requestAnimationFrame`） |
| 水面涟漪点击与拖拽模式冲突 | 开模式后点水面触发涟漪而非退出 | resolveDragTarget 优先判断；水面 mesh 无 metadata → 走空白退出路径（涟漪仍触发，两者不互斥） |
| 详情卡片与场景级开关状态不同步 | 用户困惑 | 卡片判断基于 `getGizmoTargetId()`（事实源），headerToggle 基于 `dragModeEnabled`（意图源），语义正交不冲突 |
| AR 模式下指针语义不同 | 拖拽模式在 AR 中行为异常 | P2 实施时检查 `ar-scene.ts` 指针路径，AR 模式下禁用拖拽模式入口 |

## 6. 不做什么

- **不做多选拖拽**：单 Gizmo 原则（ADR-126）不变，一次只操作一个对象
- **不做拖拽历史/撤销**：场景撤销（ADR-065 体系）已有独立机制，不在此扩展
- **不替换详情页卡片**：旧路径保留，场景级入口是**增量**而非替代
- **不做快捷键**（如 D 切换）：可后续 ADR 扩展，本期聚焦菜单入口
