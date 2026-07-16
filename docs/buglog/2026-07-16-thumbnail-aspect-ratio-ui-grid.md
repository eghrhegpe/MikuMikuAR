# 缩略图宽高比连环坑：从FOV误解、投影矩阵时序到UI网格自适应

**日期**: 2026-07-16
**严重程度**: 🔴 P1（缩略图被压扁+场景全屏天空盒+UI舞台卡片同宽，三重视觉缺陷）
**影响范围**: `thumbnail-capture.ts`（渲染）+ `library-core.ts`（缓存键）+ `ui-resource-panel.ts`（UI网格）
**发现方式**: 用户观察 + 审计对比 v1.4.1

---

## 问题描述

一次看似简单的"缩略图对焦拉近距离"修改，引发五个串联缺陷：

1. **FOV 与系数互相抵消**：`fov = scene.activeCamera ? scene.activeCamera.fov : 0.8` 导致 fallback 0.8 永远无效（主相机存在时直接复用其 FOV），AI 反复调 0.8 无效后误改主相机聚焦
2. **缩略图分辨率调整不生效**：设 4K 后截图仍是 512×288，因为缓存键不含分辨率
3. **角色缩略图被横向压扁**：contentAspect=0.364 远窄于 RT 的 0.666，画面水平压缩
4. **场景缩略图拍到整个天空盒**：重新计算 bounding box 被远景 mesh 污染，导致相机远到离谱
5. **舞台 UI 卡片与角色同宽**：16:9 横屏卡片和 2:3 竖屏卡片占据相同列宽，舞台缩略图缩成窄条

---

## 排查时间线

### 第一坑：FOV fallback 死代码

```typescript
// AI 写的"复用主相机 FOV"逻辑
const fov = scene.activeCamera ? scene.activeCamera.fov : 0.8;
```

**表面看**：合理——有主相机就复用，没有就 fallback 0.8。
**实际**：主相机永远存在（3D 场景启动就创建），所以 0.8 永远不走。AI 反复修改 0.8 这个"死值"来调焦距，毫无效果。绝望之下开始改主相机的聚焦参数，把正常的主场景相机也改坏了。

**根因**：三元表达式的条件永远为 true，fallback 分支是死代码。正确做法是缩略图相机使用独立 FOV（如 0.5 长焦），不与主相机耦合。

### 第二坑：缓存键缺分辨率

用户设 4K（×8 分辨率）截图仍是 512×288。

**根因**：`thumbnailKeyForModel()` 生成的缓存键只有 `filePath`，不含分辨率。切换分辨率后缓存命中旧图，永远不会重新截图。

```typescript
// 修复前
return `${key}`;

// 修复后：分辨率 + 宽高比都进 key
const res = resolution ?? uiState.thumbnailResolution ?? 512;
const aspect = isStage ? '16/9' : '2/3';
return `${key}::${res}::${aspect}`;
```

### 第三坑：投影矩阵时序——Canvas 16:9 覆盖 RT 2:3

角色缩略图横向压扁。诊断数据：

```
contentAspect: 0.364  (内容实际宽高比)
rtAspect:      0.666  (RT 目标 2:3)
contentBox:    148×407 (内容区域)
rtSize:        341×512 (渲染目标尺寸)
```

contentAspect 远小于 rtAspect，说明内容被水平压缩了。

**根因**：Babylon.js 计算投影矩阵时，使用 `engine.getAspectRatio(camera)` 获取宽高比。但此时主 Canvas 的 framebuffer 仍绑定（16:9），而非刚绑定的 RT（2:3）。引擎拿到的是 Canvas 的 16:9 而非 RT 的 2:3，所以投影矩阵按 16:9 计算，内容被压扁。

**修复**：手动构造投影矩阵并冻结，绕过引擎的时序问题：

```typescript
const projMatrix = new Matrix();
Matrix.PerspectiveFovLHToRef(
    THUMB_FOV,
    rtW / rtH,  // 用 RT 的实际宽高比
    thumbCam.minZ,
    thumbCam.maxZ,
    projMatrix,
    true
);
thumbCam.freezeProjectionMatrix(projMatrix);
```

### 第四坑：场景 bounding box 被远景 mesh 污染

场景缩略图拍到整个天空盒，角色变成远处的点。

**根因**：对场景 mesh 计算包围盒时，远景/天空盒 mesh 也参与计算，导致 bounding box 极大。曾尝试用中位数阈值过滤，但大型场景的中位数本身就是远景 mesh，IQR 剔除也不可靠。

**修复**：场景缩略图不复算 bounding box，直接复用主相机的 position + target。主相机已经由用户或默认逻辑调好了场景聚焦，直接拿来用最可靠。

### 第五坑：UI 网格不区分横竖屏

舞台卡片（16:9）和角色卡片（2:3）在 UI 中同宽。

**根因**：网格布局 `grid-template-columns: repeat(auto-fill, minmax(100px, 1fr))` 对所有卡片一视同仁，不考虑宽高比差异。舞台 16:9 被塞进 100px 宽的列，高度只有 56px，变成窄条。

**修复**：舞台卡片 `grid-column: span 2`，跨越两列，宽度翻倍以匹配 16:9 比例。

---

## 修复清单

| # | 缺陷 | 文件 | 修复 |
|---|------|------|------|
| 1 | FOV fallback 死代码 | thumbnail-capture.ts | 独立 THUMB_FOV 常量，不读主相机 |
| 2 | 缓存键缺分辨率 | library-core.ts | key 加入 `::res::aspect` |
| 3 | 投影矩阵用错宽高比 | thumbnail-capture.ts | 手动构造 + freezeProjectionMatrix |
| 4 | 场景包围盒远景污染 | thumbnail-capture.ts | 复用主相机 position/target |
| 5 | 舞台卡片同宽 | ui-resource-panel.ts | 16:9 卡片 `grid-column: span 2` |

---

## 教训

### 1. 三元表达式的"死分支陷阱"

```typescript
const x = alwaysTrue ? readFromGlobal : hardcodedValue;
```

当条件几乎永远为 true 时，hardcodedValue 变成死代码。后续维护者修改 hardcodedValue 以为能生效，实际毫无作用。**替代方案**：使用独立常量，不要用三元"兼容"两个不可能共存的分支。

### 2. 离屏渲染的 Aspect Ratio 时序

Babylon.js（以及多数 WebGL 引擎）的投影矩阵计算发生在 `onBeforeRender` 阶段，此时 framebuffer 绑定状态取决于引擎内部调度。手动冻结投影矩阵是绕过时序问题的可靠手段。

### 3. 缓存键必须包含所有影响输出的参数

分辨率、宽高比、甚至渲染质量设置——只要改变输出结果，就必须进缓存键。否则用户改设置后看到旧缓存，以为功能坏了。

### 4. 复用主相机比重新计算更可靠

场景缩略图的"正确对焦"是个开放问题（bounding box 计算受远景污染、大型场景中位数失效）。而主相机已经解决了这个问题（用户或默认逻辑已调好），直接复用就是最可靠的方案。

### 5. 网格布局的宽高比适配

`auto-fill + minmax` 的 CSS Grid 对所有子元素一视同仁。当子元素有不同宽高比需求时，需用 `grid-column: span N` 让宽幅元素跨列。
