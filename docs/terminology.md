# MikuMikuAR 专业术语规范

> **定位**：代码级规范（面向开发者）— 图标规则/状态栏规范/Go 错误消息/命名约定。

> 本文档统一全项目 UI 用语、图标规则、状态栏格式、Go 错误消息风格。所有新增代码必须遵守此规范。

---

## 一、图标使用规则

### 核心原则：Iconify 为主，Emoji 禁入 label

| 位置 | 允许 | 禁止 | 理由 |
|------|------|------|------|
| `PopupRow.icon` | Iconify 图标名（`lucide:xxx` / `tabler:xxx`） | Emoji | MenuStack 渲染走 `<iconify-icon>` |
| `PopupRow.label` | 纯文字 | Emoji 前缀 | label 是语义文本，图标由 icon 字段负责 |
| `setStatus()` | 规范前缀符号（见 §四） | Emoji | 状态栏不是图标展示区 |
| HTML `data-hint` | 纯文字 | Emoji | 辅助功能/屏幕阅读器不读 Emoji |
| HTML 静态内容 | Iconify 组件 / 纯文字 | Emoji | 一致性 |

### 唯一允许 Emoji 的位置

| 位置 | 允许的 Emoji | 理由 |
|------|-------------|------|
| 空状态提示 | 📭 🎬 | 无 Iconify 替代的大号装饰图标 |
| 拖拽遮罩 | 📦 | 视觉反馈，非菜单项 |
| 播放按钮 | ⏸ ▶ | Unicode 控制字符，非 Emoji |
| 粒子类型按钮 | 🌸 🌧 ❄ 🎆 | 内容标识（粒子类型），Lucide 无对应多色图标，选用 emoji 保持视觉区分 |

---

## 二、功能术语对照表

### 2.1 菜单标签（label）

统一使用**中文动词短语**，不加英文注释，不加 Emoji。

| 概念 | 标准用语 | 禁止用语 | Go Binding |
|------|---------|---------|------------|
| 浏览 PMX 文件 | 加载模型 | 模型库浏览、打开模型 | — |
| 浏览 VMD 文件 | 加载动作 | 动作库浏览、打开动作 | — |
| 收藏/取消收藏 | 收藏 / 取消收藏 | 加星、标记、收藏此模型 | `ToggleFavorite` |
| 查看模型元数据 | 模型信息 | PMX 信息、元数据 | `GetModelMetaBatch` |
| 管理 VMD 绑定 | 动作绑定 | VMD 绑定、动作管理 | — |
| 位置/缩放/旋转 | 变换 | 转换、Transform | — |
| 显示/隐藏模型 | 可见性 | 显示控制、Visibility | — |
| 管理标签 | 标签 | 🏷 标签、Tag 管理 | `AddTag` / `RemoveTag` |
| 相机对准模型 | 聚焦 | 🎯 聚焦、Focus | — |
| 从场景删除模型 | 移除 | 🗑 移除、删除模型、Remove | — |
| 在 MMD 中打开 | 导出到 MMD | 📤 导出到 MMD、Open in MMD | `OpenInMMD` |
| 在 Blender 中编辑 | 在 Blender 中编辑 | ✏️ 在 Blender 中编辑、Edit in Blender | `OpenInBlender` |
| 暂停/继续动作 | 暂停动作 / 继续动作 | ⏸ 暂停、Pause | — |
| 恢复 T-Pose | 重置动作 | 🔄 重置动作、Reset Motion | — |
| 自动循环开关 | 循环开 / 循环关 | 🔁 循环、Loop | — |
| 更换 VMD | 更换动作 | 换动作、Change Motion | — |
| 相机模式 | 相机模式 | 📷 相机、Camera Mode | — |
| 灯光控制 | 灯光 | 💡 灯光、Lighting | — |
| 渲染设置 | 渲染 | 🎨 渲染、Render Settings | — |
| 后处理效果 | 后处理 | ✨ 后处理、Post Process | — |
| 舞台环境 | 舞台 | 🎬 舞台、Stage | — |
| 渲染预设 | 渲染预设 | 🎭 渲染预设、Render Preset | `SaveRenderPreset` / `DeleteRenderPreset` |
| 保存场景 | 保存场景 | 💾 保存、Save Scene | `SaveSceneFile` |
| 加载场景 | 加载场景 | 📂 加载、Load Scene | `LoadSceneFile` |
| 软件管理 | 软件管理 | 🧰 软件管理、Software Manager | `ScanSoftwareDir` / `LaunchSoftware` |
| 外部库 | 外部库 | 🔌 外部库、External Library | `AddExternalPath` / `RemoveExternalPath` |
| 显示名称优先级 | 显示 | 🎨 显示、Display | `SetDisplayNamePriority` |
| 系统设置 | 系统 | ⚙ 系统、System | `ClearExtractCache` |
| 清除缓存 | 清除提取缓存 | 清除缓存、Clean Cache | `ClearExtractCache` |
| 检测 MMD | 检测 MMD 路径 | 📤 检测 MMD、Auto Detect MMD | `AutoDetectMMD` |
| 设置 MMD 路径 | 设置 MMD 路径 | 📂 设置 MMD、Set MMD Path | `SetMMDPath` |
| 设置 Blender 路径 | 设置 Blender 路径 | ✏️ 设置 Blender、Set Blender Path | `SetBlenderPath` |
| 打开软件目录 | 打开目录 | 📂 打开目录、Open Dir | `OpenSoftwareDir` |
| 重新扫描 | 重新扫描 | 🔄 重新扫描、Rescan | `ScanModelDir` |

### 2.2 sublabel 规范

sublabel 是灰色辅助说明，分三种类型：

| 类型 | 格式 | 示例 |
|------|------|------|
| 功能说明 | 动词短语 | "从动作库选择"、"相机对准此模型" |
| 状态显示 | 名词 + 状态值 | "当前: 舞蹈动作.vmd"、"可见性: 隐藏" |
| 空状态 | 短语 | "暂无收藏"、"无动作" |

**禁止**：技术术语裸露（如 "PMX 元数据" → 改为 "模型名称与描述"）

### 2.3 底部导航栏

| 按钮 | 标签 | 图标 | data-hint |
|------|------|------|-----------|
| 模型库 | 模型 | `tabler:cube-3d-sphere` | 浏览和加载 PMX 模型 · Ctrl+1 |
| 动作库 | 动作 | `lucide:music` | 浏览和加载 VMD 动作 · Ctrl+2 |
| 场景 | 场景 | `lucide:monitor` | 相机、灯光和渲染设置 · Ctrl+3 |
| 设置 | 设置 | `lucide:settings` | 应用偏好设置 · Ctrl+4 |

---

## 三、Go 端错误消息规范

### 3.1 用户可见错误（前端会显示）

格式：**中文描述，无技术细节**

```go
// ✅ 正确
return fmt.Errorf("未找到 Blender，请在设置中配置路径")
return fmt.Errorf("启动 MMD 失败")

// ❌ 错误 — 暴露内部错误链
return fmt.Errorf("启动 Blender 失败: %w", err)
return fmt.Errorf("extractedDir: %w", err)
return fmt.Errorf("no .pmx found in zip")
```

| 场景 | 标准消息 |
|------|---------|
| 软件未找到 | 未找到 {软件名}，请在设置中配置路径 |
| 启动失败 | 启动 {软件名} 失败 |
| 文件读取失败 | 读取文件失败 |
| 目录不存在 | 目录不存在 |
| zip 内无 PMX | 压缩包内未找到模型文件 |
| 缓存写入失败 | 写入缓存失败 |

### 3.2 内部错误（仅日志）

格式：**英文 + %w 包装**，仅用于 `runtime.LogInfof` / `runtime.LogErrorf`

```go
// ✅ 正确 — 内部日志用英文
runtime.LogErrorf(a.ctx, "ExtractZip: open zip: %w", err)

// ✅ 正确 — 返回给前端的用户错误用中文
return nil, fmt.Errorf("压缩包内未找到模型文件")
```

---

## 四、状态栏消息规范

### 4.1 前缀符号

| 类型 | 前缀 | 示例 |
|------|------|------|
| 成功 | `✓` | `✓ 解压完成` |
| 失败 | `✗` | `✗ 启动 MMD 失败` |
| 进行中 | 无前缀 | `扫描模型库...` |
| 信息 | 无前缀 | `循环: 开` |

**禁止**：Emoji 前缀（`🎯` `📤` `✏️` `🗑` `🏷` `💾` `📷` `🎭` `🔄` `🔁` `⏸`）

### 4.2 消息格式

| 场景 | 格式 | 示例 |
|------|------|------|
| 操作成功 | `✓ {动作}完成` | `✓ 解压完成`、`✓ 场景已保存` |
| 操作失败 | `✗ {动作}失败` | `✗ 解压失败`、`✗ 启动 MMD 失败` |
| 切换状态 | `{属性}: {值}` | `循环: 开`、`线框模式: 关` |
| 聚焦模型 | `✓ 已聚焦: {名称}` | `✓ 已聚焦: 初音ミク` |
| 移除模型 | `✓ 已移除: {名称}` | `✓ 已移除: 初音ミク` |
| 切换模型 | `✓ 已切换至: {名称}` | `✓ 已切换至: 鏡音リン` |
| 保存预设 | `✓ 预设已保存: {名称}` | `✓ 预设已保存: 暖光` |
| 删除预设 | `✓ 预设已删除: {名称}` | `✓ 预设已删除: 暖光` |
| 应用预设 | `✓ 预设: {名称}` | `✓ 预设: 赛博朋克` |
| 标签操作 | `✓ 已添加标签: {标签}` / `✓ 已移除标签: {标签}` | `✓ 已添加标签: 角色` |
| 收藏操作 | `✓ 已收藏` / `✓ 已取消收藏` | — |
| 重命名 | `✓ 已重命名: {名称}` | `✓ 已重命名: 我的库` |
| 路径设置 | `✓ {软件}路径已设置` | `✓ MMD 路径已设置` |
| 路径检测 | `✓ MMD 已检测: {路径}` | `✓ MMD 已检测: C:\MMD\mmd.exe` |
| 软件启动 | `✓ 已启动: {名称}` | `✓ 已启动: MikuMikuDance` |

---

## 五、Hover Hint 规范

纯文字，无 Emoji。底部导航栏 hint 见 §2.3，其余常用 target 规范：

| target | hint 文本 |
|--------|----------|
| `detail:fav` | 收藏或取消收藏此模型 |
| `detail:focus` | 相机对准此模型 |
| `detail:remove` | 从场景中移除此模型 |
| `detail:export-mmd` | 在 MikuMikuDance 中打开此模型 |
| `detail:blender` | 在 Blender 中编辑此模型 |
| `detail:motion:pause` | 暂停或继续当前动作 |
| `detail:motion:reset` | 移除动作，恢复初始姿势 |
| `detail:motion:loop` | 切换动作自动循环 |

---

## 六、HTML 静态文本规范

| 元素 | 规范文本 |
|------|---------|
| `#statusBar` 默认 | 点击模型按钮打开模型库 · 拖拽旋转 · 滚轮缩放 |
| `#btnMainAction` data-hint | 浏览和加载 PMX 模型 · Ctrl+1 |
| `#btnMotionPopup` data-hint | 浏览和加载 VMD 动作 · Ctrl+2 |
| `#btnScene` data-hint | 相机、灯光和渲染设置 · Ctrl+3 |
| `#btnSettings` data-hint | 应用偏好设置 · Ctrl+4 |
| `#popupEmpty` | 此目录为空 |
| `#motionPopupEmpty` | 未找到动作文件 |
| `#dropOverlay` 文字 | 释放文件以导入 |
| `#dropOverlay` 提示 | 支持 .zip · .pmx · .vmd |

---

## 七、命名约定

### 7.1 Go Binding 命名

| 模式 | 格式 | 示例 |
|------|------|------|
| 获取配置 | `Get{Entity}` | `GetConfig`, `GetFavorites` |
| 批量获取 | `Get{Entity}Batch` | `GetModelMetaBatch`, `GetThumbnailBatch` |
| 设置配置 | `Set{Property}` | `SetLibraryRoot`, `SetBlenderPath` |
| 切换状态 | `Toggle{State}` | `ToggleFavorite` |
| 添加/移除 | `Add{Entity}` / `Remove{Entity}` | `AddTag`, `RemoveExternalPath` |
| 重命名 | `Rename{Entity}` | `RenameExternalPath` |
| 扫描 | `Scan{Target}` | `ScanModelDir`, `ScanSoftwareDir` |
| 启动/停止 | `Start{Action}` / `Stop{Action}` | `StartFileServer`, `StopFileServer` |
| 打开 | `Open{Target}` | `OpenInBlender`, `OpenInMMD`, `OpenSoftwareDir` |
| 保存/加载 | `Save{Entity}` / `Load{Entity}` | `SaveSceneFile`, `LoadSceneFile` |
| 选择文件 | `Select{Purpose}File` | `SelectSceneSaveFile`, `SelectSceneOpenFile` |
| 自动检测 | `AutoDetect{Software}` | `AutoDetectMMD` |
| 导入 | `Import{Format}` | `ImportZip` |
| 提取 | `Extract{Format}` | `ExtractZip` |
| 清除 | `Clear{Target}` | `ClearExtractCache` |
| 清理 | `Clean{Target}` | `CleanOrphanCache` |
| 隔离 | `Isolate{Target}` | `IsolateModelDir` |

### 7.2 前端 target 命名

| 模式 | 格式 | 示例 |
|------|------|------|
| 弹窗根菜单 | `{popup}:{feature}` | `models:browse`, `settings:display` |
| 子菜单 | `{popup}:{feature}:{sub}` | `scene:render:postprocess` |
| 操作 | `{popup}:{action}` | `set:clearcache`, `scene:save` |
| 详情操作 | `detail:{action}:{id}` | `detail:focus:abc123` |
| 保留/预留 | `reserved:{feature}` | `reserved:customize` |
| 特殊 | `__{name}__` | `__favorites__`, `__tags__` |

---

## 八、开发沟通风格

- 简洁：能用 1 句话不说 2 句
- 精确：给行号、文件路径、函数名
- 结构化：表格 > 段落
- 不废话：不做无谓的「总的来说」「总结一下」
- 不改不拆：发现不够改的问题先问「要修吗」
