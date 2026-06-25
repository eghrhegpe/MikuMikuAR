# Blender 集成方案

> 从 research-notes.txt 提取整理。MMDHub 中 Blender 相关集成的设计方案。

## Blender "引用"的含义

有三种可能，做法完全不同：

### A. 引用 `.blend` 文件本身
- ❌ **不现实**。`.blend` 是 Blender 私有 SDNA 格式，需要嵌 Blender 本体或 blendfile 解析库，维护成本炸。
- MMDHub **不解析 .blend 二进制**。

### B. 引用 Blender 导出产物
- ✅ **可行**。用户用 Blender + mmd_tools 从 VMD/PMX 倒腾完，导出的 PMX + textures 文件夹。
- 这本质还是 PMX 管道，MMDHub 的扫描器自然能处理。

### C. 外部唤起编辑
- 卡片上加 **"Edit in Blender"** 按钮，唤起本机 Blender（带 mmd_tools）
- 用户改完保存，viewer 刷新即可

## 推荐方案：B + C 混合

库里模型卡片多一个"Edit in Blender"按钮，唤起本机 Blender，用户改完保存即可。

### 配置

```json
{
  "exec_path": "C:/Program Files/Blender Foundation/Blender 4.x/blender.exe",
  "mmd_tools_auto_load": true
}
```

- **macOS**：`exec_path` 走 `/Applications/Blender.app/Contents/MacOS/Blender`
- **Linux**：走 `which blender`

### 唤起命令

```bash
blender --python-expr "import mmd_tools; ..." path/to/model.pmx
```

（mmd_tools 的 CLI 载入 PMX 要查具体 API，但思路如此）

### 回写监听

Rust 侧可通过 `inotify`/`fsevent` 监听模型文件变更，自动刷新预览。

## 核心原则

> 不跟 Blender 抢——不碰 `.blend` 私有格式，不做 mmd_tools 做的事。只做"路径关联 + 外部唤起"，借用 Blender 的处理管线，各自维护。
