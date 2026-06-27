# ADR-014: 模型加载预设库（角色设置快照）

**日期**：2026-06-27

---

## 背景

模型加载预设（角色设置快照）功能允许用户将角色设置组合（材质调参、VMD 动作、可见性、transform 等）保存为可复用的预设文件，支持跨相似模型复用。

前期已实现的基础设施：
- **Go 端**：`SaveModelPreset` / `LoadModelPreset` / `SelectPresetSaveFile` / `SelectPresetOpenFile` 4 个 binding
- **前端**：`serializeModelPreset` / `applyModelPreset` / `ModelPresetFile` 接口 + 20 个单元测试
- **UI**：模型详情 card3「保存预设」/「加载预设」入口
- **数据格式**：`ModelPresetFile` v1，含 model/transform/visibility/vmd/audio/material 六段

以上实现仅覆盖「自由文件路径」模式，缺三个核心能力：
1. **预设库管理** — 无统一目录索引，无法列表/搜索/自动匹配
2. **跨模型复用** — `applyModelPreset` 只作用于已加载模型，不触发 PMX 加载
3. **自动匹配** — 加载模型时不查找匹配预设

## 决策

### 决策 A：预设存储模式 → A2 预设库

使用 `presets/models/` 目录（与场景预设 `presets/scenes/` 同一层级），每个预设存为独立 `.mcupreset.json` 文件。Go 端管理 CRUD（List/Save/Delete/Rename），按文件名索引。

保留现有 `SaveModelPreset` / `LoadModelPreset` 用于「导出/导入外部文件」场景。

### 决策 B：复用触发时机 → B3 自动匹配 + 手动覆盖

加载 PMX 成功后自动按 `libraryRef` 匹配库内预设，命中后 toast 提示并应用；用户在模型详情可手动覆盖或禁用自动匹配。

### 决策 C：跨模型字段过滤 → C1 智能过滤

跨模型应用时默认跳过 transform（不同骨架缩放/位置不通用），其余字段（material/visibility/vmd/audio）全部应用。同模型时（预设 `model.filePath` 匹配当前模型）transform 也应用。

### 决策 D：加载预设里模型 → D2 双模式

预设库列表行点击时：
- 场景中无匹配模型 → 自动 `loadPMXFile(preset.model.filePath)` + 应用
- 已有匹配模型 → 直接 `applyModelPreset(模型ID, json)`

### 决策 E：自动匹配默认开关 → `autoApply=false`

默认关闭自动匹配，避免误判。用户在预设编辑或模型详情中手动开启。

## 方案概要

### 1. Go 端新增 4 个 binding

| 函数 | 签名 | 说明 |
|------|------|------|
| `GetModelPresets` | `() []ModelPresetEntry` | 列出 `presets/models/*.mcupreset.json` |
| `SaveModelPresetToLib` | `(name, jsonStr string) error` | 写入库（同名覆盖） |
| `DeleteModelPreset` | `(name string) error` | 删除 |
| `RenameModelPreset` | `(oldName, newName string) error` | 重命名 |

`ModelPresetEntry` 返回：name / presetName / modelName / modelRef / updatedAt。

### 2. 前端新增入口和 UI

- `buildPresetListLevel(id | null)` — 预设库列表弹窗层
- `applyPresetToModel(name, targetId, opts)` — 核心应用入口，包装自动加载 + 智能过滤
- `tryAutoApplyPreset(id)` — 加载完成钩子
- 模型详情 card3 改造：库列表为主入口，文件导入导出降为次级操作

### 3. 数据格式扩展

`ModelPresetFile` 新增可选字段：
- `presetName?: string` — 库内显示名
- `autoApply?: boolean` — 是否允许自动匹配（默认 false）

向后兼容，不升 version。

### 4. 自动匹配流程

```
loadPMXFile 成功 → tryAutoApplyPreset(id)
  → GetModelPresets() 遍历
  → libraryRef 匹配 + autoApply=true
  → applyPresetToModel(name, id, { skipTransform: true })
  → toast ✓ 已自动应用预设「xxx」[撤销]
```

撤销记应用前的 transform/material/vmd 状态快照。

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| `vmd.path` 跨机器失效 | 中 | path 失败时回退 `libraryRef` 解析为库内绝对路径 |
| 预设里模型文件已删除 | 中 | 应用前 `IsPathSafe` 校验，失败提示 |
| 自动匹配误判（同名模型） | 低 | 默认 `autoApply=false`，匹配时 toast 可撤销 |
| transform 跨模型位置飞掉 | 低 | 跨模型默认 `skipTransform=true` |
| 材质跨模型无对应分类 | 低 | `_catOf` 4 类兜底，无匹配时静默跳过 |

## 实现顺序

1. **段 1**：Go 端 `modelPresetDir` + 4 个 binding + `ModelPresetEntry`
2. **段 2**：前端 `buildPresetListLevel` + card3 改造 + `applyPresetToModel`
3. **段 3**：`tryAutoApplyPreset` + 撤销栈 + 测试
