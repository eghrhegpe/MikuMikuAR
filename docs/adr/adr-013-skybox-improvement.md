# ADR-013: Skybox 贴图系统改进

**日期**：2026-06-27
> **状态**: 已完成 — SelectEnvTextureFile binding + CubeTexture 统一加载 + 天空穹顶

---

## 背景

当前天空贴图模式（`skyMode === "texture"`）有三个问题：

1. **格式分支不合理**：仅 `.dds` 走 `CubeTexture`，其余格式（含 `.hdr`）走 2D `Texture` 塞入 `scene.environmentTexture`，IBL 效果差且不报错
2. **无文件对话框**：UI 用 `prompt("输入环境贴图路径：")`，用户不知道选什么格式、去哪里找文件
3. **无可见反馈**：`scene.environmentTexture` 仅影响模型反射，MMD 材质 mostly diffuse，肉眼看不出变化

## 决策

重写天空贴图加载链路，解决格式迷雾 + 无反馈 + 无引导三个问题。

## 方案

### 1. 新增 Go Binding：`SelectEnvTextureFile`

文件对话框，filter 限定 `.hdr;.dds;.exr`，标题「选择环境贴图」。

### 2. 统一使用 `CubeTexture`

不再按扩展名分支。`.hdr` / `.dds` / `.exr` 全部走 `new CubeTexture(path, scene)`，Babylon.js 自动检测格式：
- `.dds` → DX 原生 cubemap
- `.hdr` → equirectangular HDR，内部转 cubemap
- `.exr` → equirectangular EXR（需已注册的 exr loader）

注册 `hdrTextureLoader`（当前缺失，导致 `.hdr` 文件加载静默失败）。

### 3. 创建可见 Sky Dome

当前 `_createProceduralSky` 已有 sphere mesh + emissive texture 模式。贴图模式下复用同一策略：

```
CubeTexture → scene.environmentTexture（IBL）
           → sphere.reflectionTexture + SKYBOX_MODE（可见天空球）
```

使用 Babylon.js 标准 Skybox 渲染模式：`reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE`。

### 4. UI 改进

- 文件选择按钮改为 `await SelectEnvTextureFile()` 打开原生对话框
- 菜单行显示已选文件名 + 格式标签
- 新增提示文字「支持 .hdr / .dds / .exr 环境贴图」

### 5. 格式兜底

- `.hdr` / `.dds` / `.exr` → 走 `CubeTexture` + sky dome
- 空选择 → 不改变当前 sky
- 其他格式 → console.warn 提示，回退到 procedural

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| `CubeTexture` 加载 `.hdr` 失败 | 中 | 添加 `hdrTextureLoader` import；加载失败时 console.error + fallback procedural |
| `.exr` 兼容性未知 | 低 | 不在 filter 中强推，仅 `*.exr` 可选；加载失败时同 fallback |
| SKYBOX_MODE 渲染顺序问题 | 低 | sphere 默认置于场景后方，`sideOrientation: BACKSIDE`，disable lighting |
| 与现有 procedural sky 切换冲突 | 无 | `_applySky` 内 `_disposeSky` 统一清理，切换时全量重建 |

## 实现步骤

```
1. app.go: 新增 SelectEnvTextureFile binding（≈ 10 行）
2. scene.ts: 新增 hdrTextureLoader import
3. scene.ts: 重写 _loadEnvTexture（CubeTexture + sky dome）
4. scene-menu.ts: 贴图模式 UI 改用 async file dialog + 提示文字
```
