# ADR-127: 场景级破坏性操作撤销 — Memento 快照 + 撤销 Toast

**日期**: 2026-07-18
> **状态**: 已实现
> **背景**: motion 相关的 5 项破坏性操作（清除全部 VMD、删除 VMD 图层、删除单条骨骼覆盖、清除全部骨骼覆盖、清除相机 VMD）此前既无二次确认、也无撤销途径——状态改了直接烘焙且落盘覆盖，误操作后无可回退。用户明确反对用强制确认弹窗打断操作（"定位看角色的软件已经足够了且弹窗确认的设计太烂"），要求改为"保存后弹撤销"。

---

## 一、与 ADR-125 的边界

本 ADR 与 ADR-125（动作覆盖撤销/重做）是**两套互补方案**，切勿混淆：

| 维度 | ADR-125（规划中） | 本 ADR-127（已实现） |
|------|-------------------|----------------------|
| 粒度 | 参数级（拦截模块层 `setParam`） | 场景级（整场景 `serializeScene`） |
| 方向 | 双向 undo/redo + 游标 | 单向撤销，无 redo |
| 触发点 | 每次滑块调参 | 5 项离散破坏性操作 |
| 存储 | per-model 历史栈，上限 50 | 全局环形快照栈，上限 5 |
| 恢复 | `_applySnapshot` 逐模块烘焙 | `deserializeScene` 整场景反序列化 |
| UI | 撤销/重做按钮 + Ctrl+Z | 撤销 toast（8s 自动消失） |

两者可共存：ADR-125 管"调参回退"，ADR-127 管"破坏性操作兜底"。ADR-127 不依赖 ADR-125，先行落地。

---

## 二、问题

### 当前操作路径

```
清除全部 VMD / 删除图层 / 清除骨骼覆盖 …
  → 直接改 inst 状态 → triggerAutoSave() 落盘覆盖 → 无法回退
```

### 为何不用强制确认弹窗

| 操作 | 可逆性 | 结论 |
|------|--------|------|
| 清除相机 VMD | 重新拖入即恢复 | 弹窗属过度防御 |
| 卸载模型 / 舞台 / 道具 | 从场景移除非删文件，可重新加载 | 撤销即可 |
| 清除/删除 VMD、骨骼覆盖 | 绑定/关键帧被覆盖，磁盘文件仍在 | 撤销即可 |

弹窗会污染 9 个交互点且伤害体验。撤销 toast 是更优雅的兜底。

---

## 三、方案：Memento 快照栈

### 核心洞察

撤销 ≠ 重写自动保存。当前自动保存是**单文件覆盖**（`SaveLastScene(json)` 整体覆写 `last_scene.json`，500ms 防抖）。撤销走**独立的内存快照栈**，`SaveLastScene`/`LoadLastScene` 一行不动。

### 数据结构（`scene-serialize.ts`）

```ts
const UNDO_LIMIT = 5;
const _undoStack: string[] = [];   // 整场景序列化 JSON 字符串，环形
```

### 调用链

```
破坏性操作 click
  ├─ const snap = pushUndoSnapshot()   // 变更前抓 serializeScene() 压栈
  ├─ doDestructiveOp()                 // 改 inst 状态
  ├─ triggerAutoSave()                 // 落盘新状态（沿用现有）
  └─ offerSceneUndo(msg, snap, onUI)   // 弹 info toast + 撤销按钮

点击撤销：offerSceneUndo 内部 → restoreUndoSnapshot(snap)
  ├─ cancelPendingAutoSave()
  ├─ setSuppressAutoSave(true)
  ├─ deserializeScene(snap, skipEnv=true)   // 与自动恢复同一路径
  ├─ saveSceneImmediate(true)               // 把恢复态落盘
  ├─ finally: setSuppressAutoSave(false)    // 三出口统一复位（见 P1 修复）
  └─ onRestored()                            // 调用点仅做 UI reRender
```

### 关键正确性

| 点 | 说明 |
|----|------|
| 快照时机 | 变更**前** `pushUndoSnapshot()`，闭包持有 `snap` |
| 多 toast | 每个 toast 闭包持有各自快照串，非全局 LIFO——连点两次破坏性操作各自恢复正确历史态 |
| 防级联 | 恢复期 `setSuppressAutoSave(true)`，防 `deserializeScene` 触发 auto-save 覆盖刚恢复态（与 `tryRestoreLastScene` 同款） |
| suppress 复位 | 用 `finally` 兜底三条出口路径（malformed return / success / catch），杜绝泄漏 |
| skipEnv | 撤销 motion 操作时不扰动 env（env 独立链路管理） |

---

## 四、三个子选项的裁定

用户曾设想改自动保存逻辑，裁定如下：

| 设想 | 裁定 | 理由 |
|------|------|------|
| 保存 1~5 覆盖最旧 | ✅ 采用 | 即 `UNDO_LIMIT=5`，与自动保存文件数无关 |
| 保存有最小间隔 | ❌ 不采用 | 快照只在离散破坏性点击时压栈，非每次 auto-save tick；加间隔反而吞掉"连续两次破坏性操作"中的第一次 |
| 分类保存 | ❌ 不采用 | `deserializeScene` 是整场景恢复，无局部反序列化；整场景快照永远一致，分类部分恢复会引入状态不同步 |

---

## 五、落点清单

| 文件 | 改动 |
|------|------|
| `core/toast.ts` | 新增 `info` 中性变体（蓝边框）；`showErrorToast` 降级为 `showToast` 包装，向后兼容；新增 `showInfoToast` |
| `scene/scene-serialize.ts` | 撤销段：`pushUndoSnapshot` / `restoreUndoSnapshot` / `offerSceneUndo` / `canUndo`（环形上限 5） |
| `scene/scene.ts` | 再导出上述 4 函数 |
| `core/i18n/locales/*`（5 语种） | 新增 `motion.undoApplied` |
| `menus/motion-popup.ts` | 清除全部场景动作（ADR-167「场景级清除」替代了原「清除全部 VMD」） |
| `menus/motion-detail-ui.ts` | 删除 VMD 图层（`removeVmdLayer` + 撤销 toast） |
| `menus/motion-override-levels.ts` | 删除单条骨骼覆盖、清除全部骨骼覆盖 |
| `menus/motion-camera-levels.ts` | 清除相机 VMD |

---

## 六、遗留（技术债，非正确性缺陷）

| 级别 | 位置 | 说明 |
|------|------|------|
| 🟡 P3 | `scene-serialize.ts` `_undoStack`/`canUndo` | 栈只 push 不 pop，`canUndo()` 未接 UI，属死代码。因 toast 持闭包快照，栈仅供未来 `canUndo` 用。二选一：接 UI 或删除 |
| 🟢 P4 | `pushUndoSnapshot` | 快照存 `vmdPath` 引用非二进制，撤销依赖磁盘文件仍在——本 5 项只清绑定，成立，属隐式契约 |
| 🟢 P4 | `restoreUndoSnapshot` | 并发点两个 toast 撤销时，首个 `finally` 复位 suppress 时第二个可能仍在 `deserializeScene`。v1 可接受（撤销低频）；严谨方案用重入计数替代布尔 suppress |

---

## 七、验证

- `tsc --noEmit` EXIT=0
- `perception.test.ts` 51 项通过（序列化模块无回归）
