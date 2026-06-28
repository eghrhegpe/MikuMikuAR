# 后端开发快速参考

## 构建命令

```bash
# Go 构建验证
cd MikuMikuAR && go build ./... 2>&1

# 完整 Wails 构建
cd MikuMikuAR && wails build

# 开发模式（热重载）
cd MikuMikuAR && wails dev
```

## 核心文件位置

### Go 后端
- `MikuMikuAR/app.go` - Wails Binding 入口
- `MikuMikuAR/main.go` - Wails 应用入口
- `MikuMikuAR/pmx.go` - PMX Header 二进制解析
- `MikuMikuAR/go.mod` - Go 依赖
- `MikuMikuAR/wails.json` - Wails 配置

### 前端调用
- `frontend/src/core/fileservice.ts` - 文件 URL/HTTP 服务器调用

## 常见任务速查

### 添加新 Binding 函数

1. 在 `MikuMikuAR/app.go` 添加函数
2. 添加 `//export` 注释
3. 在前端调用（如需要）
4. `go build ./...` 验证

**示例**：
```go
//export MyNewFunction
func (a *App) MyNewFunction(param string) (string, error) {
    // 实现逻辑
    return result, nil
}
```

前端调用：
```typescript
const result = await window.go.main.App.MyNewFunction('param');
```

### 修改文件操作

1. 在 `app.go` 找到相关函数
2. 修改实现
3. 添加错误处理
4. 构建验证

**常见文件操作**：
- `ReadFile(path)` - 读取文件
- `WriteFile(path, data)` - 写入文件
- `DeleteFile(path)` - 删除文件
- `ListFiles(dir)` - 列出文件

### 修改 HTTP 服务器

1. 读 `docs/architecture.md` §数据通道
2. 修改 `app.go` 中的服务器逻辑
3. 验证前端调用（`frontend/src/core/fileservice.ts`）
4. 构建验证

**HTTP 服务器关键代码**：
- 启动服务器: `startFileServer()`
- 生成文件 URL: `GetFileURL(path)`
- 停止服务器: `stopFileServer()`

### 修复后端问题

1. 读 `docs/troubleshooting.md`
2. 检查 Go 编译错误
3. 定位相关代码
4. 提出修复方案 → 用户确认
5. 实施 → `go build ./...` 验证

## 调试技巧

### Go 编译失败
```bash
# 检查语法错误
cd MikuMikuAR && go vet ./...

# 验证依赖
go mod tidy

# 查看详细错误
go build -v ./...
```

### Binding 函数前端调用失败
- 检查 `//export` 注释是否正确
- 验证函数签名（参数和返回值）
- 检查前端调用代码
- 查看浏览器控制台错误

### HTTP 服务器问题
- 检查端口占用: `netstat -an | grep PORT`
- 验证文件路径
- 查看 `frontend/src/core/fileservice.ts`

### 文件操作失败
- 检查文件路径（使用绝对路径）
- 验证权限
- 添加错误处理和日志

## Wails Binding 规则

### 函数签名
- 必须有一个接收者（通常是 `*App`）
- 必须使用 `//export FunctionName` 注释
- 返回类型应为 `(rtype, error)` 或 `error`
- 参数和返回值必须是基本类型或序列化对象

### 前端调用
- 通过 `window.go.main.App.FunctionName()` 调用
- 返回 Promise
- 使用 `await` 获取结果

### 错误处理
- Go 端返回 `error`
- 前端使用 `.catch()` 捕获错误

## 跨平台注意事项

### Windows
- 路径使用 `filepath.Join()`
- 注意文件权限
- 使用 `os.PathSeparator`

### macOS/Linux
- 路径使用正斜杠
- 注意可执行权限
- 使用 `~` 表示家目录

### Wails 构建
```bash
# Windows
wails build

# macOS
wails build -platform darwin

# Linux
wails build -platform linux

# 多平台
wails build -platform windows/amd64,darwin/amd64,linux/amd64
```

## Go 代码风格

- 标准格式化（`go fmt`）
- 使用 `golint` 检查
- 遵循命名规范（见 `docs/terminology.md`）
- 添加注释

## 性能优化

- 使用 `grep` 而非全量读取
- 避免重复构建
- 小步修改，频繁验证
- 利用文档地图快速定位

## 版本控制

```bash
# 查看最近提交
git log --oneline -5

# 查看状态
git status

# 创建修复分支
git checkout -b fix/issue-description
```

## 依赖管理

```bash
# 添加依赖
go get package-name

# 更新依赖
go get -u package-name

# 整理依赖
go mod tidy

# 查看依赖
go list -m all
```

---

**完整文档**: 见 `../SKILL.md` 和 `docs/` 目录下的文档
