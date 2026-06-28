---
name: wails-go-helper
description: Wails + Go 后端开发助手。当需要修改 Go 逻辑、Wails Binding、文件操作、HTTP 服务器、跨平台构建时使用。触发词：改 Go、Wails、Binding、文件操作、HTTP 服务器、构建 Go、后端开发。
agent_created: true
---

# Wails + Go 后端开发助手

本 skill 提供 MikuMikuAR 后端（Go + Wails）开发的约定、文档地图和常见任务工作流。

## 核心原则

1. **只读文档地图列出的文件** - 禁止递归扫描 `docs/`、禁止读取 `docs/research/`（除非明确指定）
2. **先读后改** - 禁止基于记忆修改，每次改前用 `read_file` 或 `grep` 确认最新状态
3. **小步快跑** - 一个修改一个 build，不攒多个修改
4. **失败熔断** - 同一命令连续失败 2 次 → 停止并分析原因

## 文档地图速查

### 后端相关文档

| 任务 | 优先读 | 其次读 |
|------|--------|--------|
| Go 逻辑修改 | `docs/architecture.md` §Go 后端 | `MikuMikuAR/app.go` |
| Wails Binding | `docs/architecture.md` §数据通道 | `MikuMikuAR/app.go` |
| 文件 URL/HTTP 服务器 | `docs/architecture.md` §数据通道 | `frontend/src/core/fileservice.ts` |
| 文件操作 | `docs/architecture.md` §Go 后端 | `MikuMikuAR/app.go` |
| 配置/外部库 | `docs/architecture.md` §生态聚合 | `frontend/src/menus/settings.ts` |
| 场景序列化 | `docs/architecture.md` §场景序列化 | `frontend/src/scene/scene.ts` |
| 修复后端问题 | `docs/troubleshooting.md` | `docs/fix-cycle.md` |
| 新增函数 | `docs/reusables.md` | — |

完整地图见 `references/backend-doc-map.md`。

## 工作流

### Go 构建验证

```bash
cd MikuMikuAR && go build ./... 2>&1
```

### 完整 Wails 构建

```bash
cd MikuMikuAR && wails build
```

### 修复周期

1. 读 `docs/fix-cycle.md` 了解修复流程
2. 重现问题 → 定位根因 → 提出方案 → 用户确认 → 实施 → 构建验证

### 添加新 Binding 函数

1. 在 `MikuMikuAR/app.go` 添加函数
2. 添加 `//export` 注释
3. 在前端调用（如需要）
4. `go build ./...` 验证

## 项目结构（后端部分）

```
MikuMikuAR/
├── app.go              # Wails Binding 入口
│                       # - 文件IO
│                       # - 对话框
│                       # - HTTP 文件服务器
│                       # - 扫描/标签/预设/换装
├── main.go             # Wails 应用入口
├── pmx.go              # PMX Header 二进制解析
├── go.mod              # Go 依赖
├── wails.json          # Wails 配置
├── tests/
│   └── test_config_syntax.py   # 契约测试
├── scripts/
│   └── build.ps1                # 构建验证脚本
└── frontend/           # 前端代码（见 babylon-mmd-helper skill）
```

## 关键约定

### Go 代码风格
- 标准格式化（`go fmt`）
- 遵循 `docs/terminology.md` 中的命名规范
- Binding 函数使用 `//export` 注释

### Wails Binding 规则
- 函数在 `app.go` 中定义
- 使用 `//export FunctionName` 注释
- 返回类型应为 `(rtype, error)` 或 `error`
- 前端通过 `window.go.main.App.FunctionName()` 调用

### Go 构建
- 在 `MikuMikuAR/` 目录执行
- 使用 `go build ./...` 验证
- 使用 `wails build` 完整构建

### Git 操作
- 在仓库根目录执行
- 构建命令进 `MikuMikuAR/` 子目录执行

## 常见任务模板

### 任务：修改 Go Binding

1. 读 `docs/architecture.md` §Go 后端
2. 修改 `MikuMikuAR/app.go`
3. `go build ./...` 验证
4. 更新前端调用（如需要）

### 任务：添加文件操作功能

1. 在 `app.go` 添加函数
2. 实现文件操作逻辑
3. 添加错误处理
4. 构建验证

### 任务：修改 HTTP 服务器

1. 读 `docs/architecture.md` §数据通道
2. 修改 `app.go` 中的服务器逻辑
3. 验证前端调用（`frontend/src/core/fileservice.ts`）
4. 构建验证

### 任务：修复后端问题

1. 读 `docs/troubleshooting.md` 排查常见问题
2. 检查 Go 编译错误
3. 定位相关代码（查文档地图）
4. 提出修复方案 → 用户确认
5. 实施 → `go build ./...` 验证

## 调试技巧

### Go 编译失败
- 检查语法错误
- 验证依赖（`go.mod`）
- 运行 `go mod tidy`

### Binding 函数前端调用失败
- 检查 `//export` 注释
- 验证函数签名
- 检查前端调用代码

### HTTP 服务器问题
- 检查端口占用
- 验证文件路径
- 查看 `frontend/src/core/fileservice.ts`

### 文件操作失败
- 检查文件路径
- 验证权限
- 添加错误处理

## 复用函数

写新函数前，先查 `docs/reusables.md` 确认是否已存在类似函数。

常见后端复用函数：
- 文件操作
- HTTP 请求
- 路径处理

## 跨平台注意事项

### Windows
- 路径使用反斜杠或 `filepath.Join`
- 注意文件权限

### macOS/Linux
- 路径使用正斜杠
- 注意可执行权限

### Wails 构建
- `wails build` 自动处理跨平台
- 使用 `wails build -platform` 指定平台

## 参考资料

- 完整后端文档地图: `references/backend-doc-map.md`
- 架构文档: `docs/architecture.md`
- 复用函数索引: `docs/reusables.md`
- 术语表: `docs/glossary.md`
- 代码级规范: `docs/terminology.md`

---

**使用本 skill**: 当用户提出 MikuMikuAR 后端相关开发任务时，自动加载本文档，按文档地图定位文件，遵循工作流执行任务。
