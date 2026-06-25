# MikuMikuAR — Wails 前端应用

这是 MikuMikuAR 的 Wails (Go) 桌面应用，提供 PMX 模型查看器的桌面壳层能力。

## 架构

- **Go 后端** (`app.go`) — 文件对话框、文件读取、目录扫描
- **前端** (`frontend/`) — Vite + TypeScript + Babylon.js + babylon-mmd

## Go API

| 方法 | 说明 |
|------|------|
| `SelectPMXFile()` | 打开文件对话框选择 .pmx 文件 |
| `SelectVMDMotion()` | 打开文件对话框选择 .vmd 动作文件 |
| `ReadFileBytes(path)` | 读取文件返回字节数组 |
| `ReadDirFiles(dir)` | 读取目录下所有文件 |
| `GetFileDir(path)` | 获取文件所在目录 |
| `FileExists(path)` | 检查文件是否存在 |

## 开发

```bash
wails dev
```

## 构建

```bash
wails build
```

更多信息: https://wails.io/docs/reference/project-config
