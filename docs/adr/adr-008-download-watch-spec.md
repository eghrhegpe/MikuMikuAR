# ADR-008: 下载目录监听 + 自动导入（方案 B）

**日期**：2026-07-16

---

### 背景

用户从模之屋等网站下载模型 zip 后，需要手动拖拽/选择文件来导入模型库，流程繁琐。需要一种机制自动检测下载目录的新文件并提供一键导入。

约束：
- 下载目录可能有非模型 zip（驱动、文档等），不能自动导入所有文件
- 浏览器下载完成前不要触发导入
- 新功能应复用现有的 `ExtractZip` 链路

### 决定

#### 1. 目录监听 + 用户确认模式（默认）

```
fsnotify 检测 .zip/.pmx/.vmd Create/Write
  → 800ms debounce（防下载未完成）
  → frontend toast 通知（📦 检测到新模型 / 文件名）
  → 用户点「导入」→ ImportLocalFile → ExtractZip → 落库
  → 用户点「忽略」或 10 秒超时 → toast 消失
```

**理由**：
- 用户确认一步防止误导入（下载目录可能有驱动包、文档等非模型 zip）
- debounce 800ms 确保文件写入完成后再通知

#### 2. 可选自动导入模式

用户在设置面板勾选「自动导入」后，新文件直接走导入链路，跳过确认。

#### 3. 复用 `ExtractZip`，不重复实现

`ImportLocalFile` 对 zip 文件调用 `importZipFile`（从 `DownloadAndImport` 抽取的共享函数），抽取过程与已有 zip 导入完全一致（cache、zip-slip 防护、Shift-JIS 解码）。

#### 4. fsnotify 跨平台

选择 `github.com/fsnotify/fsnotify`（Wails 已有间接依赖），避免 cgo 需求。Windows / macOS / Linux 均支持本地磁盘。

### 影响

**正面**
- 下载 → 导入链路从 3 步（下载→打开文件→选择）缩短到 1 步（点确认）
- 自动导入模式进一步缩短到 0 步（完全自动化）
- 共享 `importZipFile` 减少了 `DownloadAndImport` 的 zip 逻辑重复

**负面或风险**
- fsnotify 在 Windows 网络映射盘上不工作（已在设置文档提示仅本地磁盘）
- 不支持 `.rar` / `.7z` 格式（模之屋部分资源用 rar 打包，一期只支持 zip）
- 单目录监听：用户只能监听一个下载目录（需求上限，多目录可在后续加入）

### 技术细节

- **Go 端新增函数**：`ImportLocalFile`、`importZipFile`、`StartWatchDir`、`StopWatchDir`、`SetDownloadWatchDir`、`watchLoop`、`notifyNewFile`、`restoreWatcher`
- **前端新增函数**：`showImportToast`、`confirmImport`、`dismissImport`、`loadWatchSettings`、`applyWatchSettings`
- **新增事件**：`watch:newfile`（Go→frontend）、`import:done`（Go→frontend）
- **配置持久化**：`Config.DownloadWatchDir` + `Config.DownloadAutoImport` 存入 `config.json`
