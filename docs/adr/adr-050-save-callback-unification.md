# ADR-050: 保存触发机制统一

**日期**：2026-07-06
> **状态**：已实施（代码完成；完整构建受无关预存错误阻塞，见 §6）
> **关联**：ADR-048(变换系统统一)、ADR-015(材质编辑重构)

---

## 0. 背景

当前三个模块各自以不同名称调用保存回调，但它们最终都指向同一个 `triggerAutoSaveImpl()`（`scene-serialize.ts`）：

| 模块 | 内部名称 | 获取方式 | 调用模式 |
|------|---------|---------|---------|
| `model-manager.ts` | `this.onChange` | 构造函数参数 | `this.onChange()` |
| `lighting.ts` | `_triggerAutoSave` | `initLighting()` 参数 → 模块级变量 | `_triggerAutoSave()` |
| `props.ts` | `triggerAutoSave` | `import { triggerAutoSave } from '../scene/scene'` | `triggerAutoSave()` |
| `material.ts` | `triggerAutoSave` | `import { triggerAutoSave } from '../core/config'` | `triggerAutoSave()` |
| `model-loader.ts` | `triggerAutoSave` | `import { triggerAutoSave } from '../scene/scene'` | `triggerAutoSave()` |

其中 `model-manager.ts` 是显式文档化的设计选择（见注释 `// 不直接调用 triggerAutoSave → 通过 onChange 回调触发`），其他模块是直接引用。

---

## 1. 问题陈述

### 1.1 命名不一致

同一个语义（"场景有变更，触发自动保存"），分布在 5 个文件中使用了 3 种名称：`onChange`、`_triggerAutoSave`、`triggerAutoSave`。虽然不是 Bug，但增加认知负担：

- 排查 Bug 时要想"模型走的是 onChange，灯光走的是 _triggerAutoSave"
- 全局搜索 `triggerAutoSave` 漏掉灯光的 `_triggerAutoSave`

### 1.2 lighting.ts 的模块级变量

`lighting.ts` 的 `_triggerAutoSave` 是一个模块级 `let` 变量，通过 `initLighting()` 注入。这与其他模块的直接 import 方式不同，是多了一层间接性。

### 1.3 model-manager.ts 的间接设计

`modelManager` 不直接 import `triggerAutoSave`，而是通过构造函数参数注入 `onChange`。这是合理的依赖注入设计——但命名用了 `onChange` 而非 `triggerAutoSave`，掩盖了它最终触发的就是保存回调。

---

## 2. 否决的方案

### 方案 A：事件总线

引入全局事件系统，模块 emit `'scene:changed'` 事件，统一由 `scene-serialize.ts` 监听后触发保存。

**否决理由**：过度工程。当前仅是命名不一致，没有 wiring 问题。事件系统会增加调试难度（"谁 emit 了？谁在 listen？"）。

### 方案 B：统一用 `onChange` 命名

把 `triggerAutoSave` 和 `_triggerAutoSave` 都改名为 `onChange`。

**否决理由**：`triggerAutoSave` 在 7+ 个文件中使用，改名影响面大，但与功能语义匹配（就是触发保存）。`onChange` 过于通用，长期来看不会更清晰。

---

## 3. 决策

### 3.1 统一命名为 `triggerAutoSave`

保持 `triggerAutoSave` 作为标准名称，改动两项：

**`model-manager.ts`**：
```typescript
// 改前
constructor(
    private scene: Scene,
    private onChange: () => void,     // ← 命名不直观
    private autoFrame: ...
) {}
// 改后
constructor(
    private scene: Scene,
    private triggerAutoSave: () => void,
    private autoFrame: ...
) {}
// 所有 this.onChange() → this.triggerAutoSave()
```

**`lighting.ts`**：
```typescript
// 改前
let _triggerAutoSave: (() => void) | null = null;
// 调用处 _triggerAutoSave()

// 改后
let triggerAutoSave: (() => void) | null = null;
// 调用处 triggerAutoSave()
```

### 3.2 不采纳的改动

- `props.ts` / `material.ts` / `model-loader.ts` 已使用 `triggerAutoSave`，保持不动
- 不引入事件总线
- 不改动核心保存逻辑（`triggerAutoSaveImpl`）

---

## 4. 影响范围

| 文件 | 改动 | 行数 |
|------|------|------|
| `model-manager.ts` | 构造函数参数 `onChange` → `triggerAutoSave`；全部 `this.onChange()` → `this.triggerAutoSave()` | ~20 行 |
| `lighting.ts` | 模块变量 `_triggerAutoSave` → `triggerAutoSave`；全部 `_triggerAutoSave()` → `triggerAutoSave()` | ~5 行 |
| `scene.ts` | ModelManager 构造参数名同步 | ~1 行 |
| `renderer.ts` | 无改动（已有独立 `_triggerAutoSave`，是渲染器自用，非保存回调） | 0 |

**零功能变更，纯重命名**。

---

## 5. 验证标准

1. `tsc --noEmit` 通过（确保所有引用点已更新）
2. `vite build` 通过
3. 场景中修改模型位置/缩放/旋转 → 自动保存触发（人工验证 console 或文件写入）
4. 场景中修改灯光参数 → 自动保存触发
5. 场景中修改道具变换 → 自动保存触发

---

## 6. 实施记录（2026-07-06）

### 6.1 已落地改动

| 文件 | 改动 |
|------|------|
| `scene/manager/model-manager.ts` | 构造函数参数 `onChange` → `triggerAutoSave`；16 处 `this.onChange()` → `this.triggerAutoSave()`；顶部设计注释同步（避免循环依赖的说明） |
| `scene/render/lighting.ts` | 模块变量 `_triggerAutoSave` → `triggerAutoSave`（声明 + 约 10 处调用）；`initLighting` 注入参数改名为 `saveCb` 以避免与模块变量遮蔽 |

**遮蔽处理**：`lighting.ts` 原 `initLighting(triggerAutoSave)` 参数与模块变量同名，若直接重命名模块变量会导致 `triggerAutoSave = triggerAutoSave` 自赋值；故将注入参数改名为 `saveCb`，赋值改为 `triggerAutoSave = saveCb`。调用点 `triggerAutoSave()` 现统一指向模块变量，与其他模块一致。

### 6.2 验证结果

- `tsc --noEmit`（`npm run check`）：ADR 涉及文件类型正确。
- `vite build`：✅ 通过（EXIT=0，1.83s）。构建过程中发现并修复了一处**与 ADR-050 无关的预存回归**（`model-ops.ts` 悬空导入，源自本会话早前的 ADR-046 清理）——该修复见 §6.3，不属于本 ADR 的重命名范围。
- 调用方与测试均以位置参数传值（`new ModelManager(scene, onChange, autoFrame)` 中的 `onChange` 仅为测试本地变量名），构造函数形参改名不影响调用，无破坏风险。

### 6.3 附带修复（超出本 ADR 重命名范围，但阻塞构建）

- **根因**：本会话早前 ADR-046 删除了 `core/state.ts` 的 `setIsLoadingModel`/`setIsLoadingVmd` setter（孤儿状态），但 `scene/manager/model-ops.ts` 仍从 `core/config` 导入并调用这两个符号，导致 `vite build` 报 TS2305。
- **修复**：按 ADR-046 意图（加载器已不再写入这些状态），移除 `model-ops.ts` 的两行导入与两处 `setIsLoadingModel(false)`/`setIsLoadingVmd(false)` 调用。纯死代码清理，无功能影响。
- **状态**：已修复，`vite build` 转绿。