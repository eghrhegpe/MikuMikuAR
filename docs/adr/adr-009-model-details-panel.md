# ADR-009: 模型详情面板 — 运行时模型实例控制

**日期**：2026-07-16
> **状态**: 已完成 — Phase 1-5 全部完成（动作绑定改为预设间接绑定）

---

## 背景

当前点击弹窗中的已加载模型条目仅切换焦点（相机对准），用户无法在 UI 中查看/修改模型的运行时属性。需要一种机制管理场景中的模型实例：位置、缩放、旋转、可见性、动作绑定、删除等。这与 MikuMikuAR 的「场景编排器」定位一致。

约束：
- 不是外观定制（那是 DanceXR 的领域），而是运行时实例控制
- 复用已有的 `MenuStack` 导航栈系统，不引入新弹窗框架
- 扩展 `ModelInstance` 类型以容纳新属性，不破坏向后兼容

## 决定

### 1. 模型详情子菜单（代替直接聚焦）

点击弹窗根层级中已加载模型的条目（`target: "scene:${id}"`），不再直接切换焦点，而是进入模型详情子菜单。

### 2. 详情菜单结构

```
模型名称
├── 📋 模型信息            ← 显示 PMX 元数据
├── 🎬 动作绑定            ← VMD 管理
├── 📐 变换                ← 位置/缩放/旋转
├── 👁 可见性              ← 显示/隐藏/半透明
├── 🎯 聚焦               ← 相机对准此模型
└── 🗑 移除               ← 从场景删除
```

### 3. 子功能实现方式

| 功能 | 实现 | 交互 |
|------|------|------|
| 📋 模型信息 | `renderCustom` 只读字段列表 | ModelInstance + GetModelMeta |
| 🎬 动作绑定 | `renderCustom` + 动作库选择 | 更换/暂停/重置/循环 |
| 📐 变换 | `renderCustom` slider 模式（同灯光控制） | 直接修改 mesh position/scaling/rotation |
| 👁 可见性 | `renderCustom` 单选按钮组 | 修改材质 alpha/visibility/wireframe |
| 🎯 聚焦 | 单按钮 action | 调 focusModel(id) |
| 🗑 移除 | 单按钮 action | 调 removeModel(id)，关闭弹窗 |

### 4. ModelInstance 扩展

```typescript
export type ModelInstance = {
    // ... 现有字段 ...
    visible: boolean;        // 默认 true
    opacity: number;         // 默认 1.0
    wireframe: boolean;      // 默认 false
    scaling: number;         // 默认 1.0（统一缩放）
    rotationY: number;       // 默认 0（弧度）
};
```

### 5. SceneFile 序列化扩展

`SceneFile.models[].positionX` 扩充为完整变换字段：
- `positionX`, `positionY`, `positionZ`
- `scaling`
- `rotationY`
- `visible`, `opacity`, `wireframe`

### 6. 交互增强

Ctrl+Delete 快速移除焦点模型（已在键盘快捷键中支持）。

### 7. 分阶段实现

| 阶段 | 功能 | 预估 |
|------|------|------|
| Phase 1 | 模型详情子菜单 + 聚焦 + 移除 + 动作绑定 | 2h |
| Phase 2 | 变换滑块（位置/缩放/旋转） | 1.5h |
| Phase 3 | 可见性（半透明/隐藏/线框） | 1h |
| Phase 4 | 模型信息面板 | 0.5h |
| Phase 5 | SceneFile 序列化扩展 | 0.5h |

## 影响

**正面**
- 用户可以在 UI 中管理场景中模型实例的运行时属性
- 复用 MenuStack 导航栈，无新弹窗框架
- 动作绑定支持多模型独立管理（不限于焦点模型）

**负面或风险**
- 扩展 ModelInstance 需要前端 + Go 端 SceneFile 同步修改
- Phase 1 需要重构当前「点击模型行→聚焦」行为为「点击模型行→进入详情」

## 技术细节

- **文件变更**：`config.ts`（ModelInstance 扩展）、`library.ts`（新增详情子菜单）、`scene.ts`（应用变换/可见性）
- **新增函数**：`buildModelDetailLevel`、`buildMotionBindingLevel`、`buildTransformLevel`、`buildVisibilityLevel`、`buildModelInfoLevel`
- **状态管理**：`syncModelTransform(id)`、`syncModelVisibility(id)` 在 scene.ts 中实现
- **序列化**：`serializeScene` / `deserializeScene` 扩展 transform/visibility 字段

## 后续演进（补记）

### 动作绑定间接化

ADR-009 中规划的「🎬 动作绑定」独立入口最终未实现。实际路径改为：通过**模型预设**（`ModelPresetFile.vmd` 字段）间接绑定动作 — 预设加载时自动恢复 VMD 路径和播放状态。模型详情 card3 的「加载预设」替代了独立的动作绑定 UI。

### Phase 1-5 完成状态

| Phase | 功能 | 状态 |
|-------|------|------|
| Phase 1 | 模型详情子菜单 + 聚焦 + 移除 + 动作绑定 | ✅ |
| Phase 2 | 变换滑块（位置/缩放/旋转） | ✅ |
| Phase 3 | 可见性（半透明/隐藏/线框） | ✅ |
| Phase 4 | 模型信息面板 | ✅ |
| Phase 5 | SceneFile 序列化扩展 | ✅ |
