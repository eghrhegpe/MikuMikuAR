# 未使用导出深度分析报告

**生成时间**: 2026-07-24  
**分析工具**: knip + 手动验证  
**剩余未使用导出**: 86 个

---

## 分类统计

| 类别 | 数量 | 占比 | 说明 |
|------|------|------|------|
| **误报（内部使用）** | ~30 | 35% | 模块内部使用但被 re-export，knip 无法追踪 |
| **误报（namespace 访问）** | ~15 | 17% | 通过 `import * as X` 访问，knip 无法追踪成员调用 |
| **真死代码** | ~41 | 48% | 确实无任何引用，可安全删除 |

---

## 误报模式详解

### 1. 内部使用 + Re-export 模式（~30 处）

**典型文件**: `camera.ts`, `camera-state.ts`, `env-impl.ts`

**模式**:
```typescript
// camera-state.ts
export function getCameraPreset() { ... }

// camera.ts
import { getCameraPreset } from './camera-state';
export { getCameraPreset } from './camera-state';  // re-export

// camera.ts 内部使用
const preset = getCameraPreset();  // ✓ 内部使用
```

**knip 误判原因**: knip 看到 `export { getCameraPreset }` 但无外部文件导入，标记为未使用。实际上该函数在 camera.ts 内部被使用。

**涉及函数**:
- `camera.ts`: `defaultCameraPreset`, `getCameraPreset`, `setCameraPreset`, `getCurrentCamera`, `setCurrentCamera`, `getFocusCenterY`, `setFocusCenterY`, `isTouchDevice`
- `env-impl.ts`: `getPipeline`, `resolveStaticAsset`, `isInitialized`, `getGroundRippleTexture`, `updateGroundRipples`, `isUnderwaterActive`, `createMirror`, `disposeMirror`, `isMirrorActive`, `updateMirrorClearColor`, `disposeSky`, `disposeGround`, `clearSceneTickCallbacks`, `runSceneTickCallbacks`

**建议**: 保留，这些是模块内部状态管理所需。

---

### 2. Namespace Import 模式（~15 处）

**典型文件**: `env-impl.ts` (被 `env.ts` 以 namespace 方式导入)

**模式**:
```typescript
// env.ts
import * as impl from './env-impl';

// 使用
impl.getPipeline();      // ✓ 通过 namespace 访问
impl.resolveStaticAsset();
```

**knip 误判原因**: knip 无法追踪 `impl.xxx` 形式的成员访问，将 `env-impl.ts` 的所有导出标记为未使用。

**涉及函数**:
- `env-impl.ts` 的大部分导出（已在上一类列出）

**建议**: 保留，这些通过 namespace 方式被使用。

---

## 真死代码清单（~41 处，可安全删除）

### 菜单系统（17 处）- 已清理 ✓

### 核心工具（3 处）- 已清理 ✓

### 音频播放列表控制（5 处）

**文件**: `src/outfit/audio.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `setPlaylist` | 290 | 设置播放列表 |
| `addToPlaylist` | 296 | 追加到播放列表 |
| `getPlaylist` | 304 | 获取当前播放列表 |
| `getPlaylistIndex` | 309 | 获取播放列表索引 |
| `prevTrack` | 323 | 切换到上一曲 |

**分析**: 这些函数导入了但从未被任何文件使用。播放列表功能可能是预留接口但从未集成到 UI。

**建议**: 可删除，或添加 `// @internal` 注释标记为内部 API。

---

### VMD 图层管理（3 处）

**文件**: `src/scene/motion/vmd-layers.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `addVmdLayerFromPath` | 164 | 从路径添加 VMD 图层 |
| `clearVmdLayers` | 402 | 清除所有 VMD 图层 |
| `replaceVmdLayerVmd` | 424 | 替换图层 VMD |

**分析**: 这些是 VMD 图层管理的高级 API，但当前 UI 未使用。可能是为未来功能预留。

**建议**: 可删除，或迁移到 `@internal` 命名空间。

---

### 场景渲染预设（2 处）

**文件**: `src/menus/scene-render-presets.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `getFilterPresetName` | 173 | 获取滤镜预设名称 |
| `loadUserPresets` | 302 | 加载用户预设 |

**分析**: 预设系统的辅助函数，但未被调用。

**建议**: 可删除。

---

### 模型预设管理（2 处）

**文件**: `src/menus/model-preset.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `selectAndSavePreset` | 208 | 选择并保存预设 |
| `selectAndLoadPreset` | 313 | 选择并加载预设 |

**分析**: 预设选择对话框的辅助函数，未集成到 UI。

**建议**: 可删除。

---

### 材质编辑器（2 处）

**文件**: `src/menus/model-material.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `buildMatBatchLevel` | 297 | 构建批量材质层级 |
| `buildMatListLevel` | 686 | 构建材质列表层级 |

**分析**: 材质编辑器的子层级构建器，未被菜单系统引用。

**建议**: 可删除。

---

### 库操作辅助（2 处）

**文件**: `src/menus/library-actions.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `loadThumbnailsForLevel` | 109 | 为层级加载缩略图 |
| `ensureModelMeta` | 124 | 确保模型元数据存在 |

**分析**: 库管理的辅助函数，未被调用。

**建议**: 可删除。

---

### 动作相机参数（2 处）

**文件**: `src/menus/motion-camera-levels.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `buildCameraParamsLevel` | 339 | 构建相机参数层级 |

**分析**: 菜单层级构建器，未被引用。

**建议**: 可删除。

---

### 程序化动作模式（2 处）

**文件**: `src/menus/motion-procmotion-levels.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `buildProcMotionModeLevel` | 304 | 构建程序化动作模式层级 |

**分析**: 菜单层级构建器，未被引用。

**建议**: 可删除。

---

### 广场状态管理（2 处）

**文件**: `src/menus/plaza-state.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `setLayer` | 55 | 设置当前层级 |

**分析**: 广场状态管理函数，未被调用。

**建议**: 可删除。

---

### 资源详情辅助（2 处）

**文件**: `src/menus/resource-detail-helpers.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `getResourceHandle` | 295 | 获取资源句柄 |

**分析**: 资源详情面板的辅助函数，未被使用。

**建议**: 可删除。

---

### 设置共享配置（2 处）

**文件**: `src/menus/settings-shared.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `getAutoLoadCompanionAudio` | 64 | 获取自动加载伴随音频设置 |
| `hexToRgb` | 70 | HEX 转 RGB |
| `rgbToString` | 70 | RGB 转字符串 |

**分析**: 设置系统的辅助函数，未被调用。

**建议**: 可删除。

---

### 环境系统辅助（4 处）

**文件**: `src/scene/env/env-lighting.ts`, `env-reflection.ts`, `env-type-helpers.ts`, `env-water.ts`

| 函数 | 文件 | 行号 | 说明 |
|------|------|------|------|
| `exportEnvPreset` | env-lighting.ts | 153 | 导出环境预设 |
| `importEnvPreset` | env-lighting.ts | 169 | 导入环境预设 |
| `getCurrentReflectionMode` | env-reflection.ts | 561 | 获取当前反射模式 |
| `isReflectionProbeActive` | env-reflection.ts | 568 | 检查反射探针是否激活 |
| `setPostProcessEnabled` | env-type-helpers.ts | 17 | 设置后处理启用状态 |
| `isWorldMatrixFrozen` | env-type-helpers.ts | 27 | 检查世界矩阵是否冻结 |
| `getWaterWaveSpeed` | env-water.ts | 1394 | 获取水波速度 |

**分析**: 环境系统的辅助函数，部分可能是为未来功能预留。

**建议**: 可删除，或标记为 `@internal`。

---

### AR 相机（2 处）

**文件**: `src/scene/ar/ar-camera.ts`

| 函数 | 行号 | 说明 |
|------|------|------|
| `addARModeChangeListener` | 58 | 添加 AR 模式变化监听器 |
| `getARVideoEl` | 101 | 获取 AR 视频元素 |

**分析**: AR 功能的辅助函数，未被调用。

**建议**: 可删除（AR 功能可能未完全实现）。

---

### 姿势系统（2 处）

**文件**: `src/scene/pose/camera-angle.ts`, `composition-guide.ts`

| 函数 | 文件 | 行号 | 说明 |
|------|------|------|------|
| `getPreset` | camera-angle.ts | 92 | 获取相机角度预设 |
| `cycleGuideMode` | composition-guide.ts | 24 | 循环切换构图引导模式 |
| `disposeGuides` | composition-guide.ts | 126 | 销毁构图引导 |

**分析**: 姿势和构图系统的辅助函数，未被调用。

**建议**: 可删除。

---

### 动作系统辅助（3 处）

**文件**: `src/scene/motion/animation-retargeter.ts`, `motion-intent.ts`, `perception-observer.ts`

| 函数 | 文件 | 行号 | 说明 |
|------|------|------|------|
| `getBoneMapPresets` | animation-retargeter.ts | 69 | 获取骨骼映射预设 |
| `updateSceneMotion` | motion-intent.ts | 131 | 更新场景动作 |
| `setMediumMaxOthers` | perception-observer.ts | 31 | 设置中等最大其他值 |

**分析**: 动作系统的辅助函数，未被调用。

**建议**: 可删除。

---

### 其他（5 处）

| 函数 | 文件 | 行号 | 说明 |
|------|------|------|------|
| `applyBoneOverrideIK` | motion-modules/module-base.ts | 19 | 应用骨骼覆盖 IK |
| `presetMapToModules` | motion-modules/preset-types.ts | 25 | 预设映射到模块 |
| `thumbnailKeyForKind` | manager/thumbnail-key.ts | 62 | 生成缩略图键 |
| `toggleDragMode` | transform/transform-mode.ts | 20 | 切换拖拽模式 |

**分析**: 各系统的辅助函数，未被调用。

**建议**: 可删除。

---

## 清理优先级建议

### 高优先级（立即可删，无风险）

1. **菜单系统辅助函数**（~15 处）
   - `library-actions.ts`: `loadThumbnailsForLevel`, `ensureModelMeta`
   - `model-material.ts`: `buildMatBatchLevel`, `buildMatListLevel`
   - `model-preset.ts`: `selectAndSavePreset`, `selectAndLoadPreset`
   - `motion-camera-levels.ts`: `buildCameraParamsLevel`
   - `motion-procmotion-levels.ts`: `buildProcMotionModeLevel`
   - `plaza-state.ts`: `setLayer`
   - `resource-detail-helpers.ts`: `getResourceHandle`
   - `scene-render-presets.ts`: `getFilterPresetName`, `loadUserPresets`
   - `settings-shared.ts`: `getAutoLoadCompanionAudio`, `hexToRgb`, `rgbToString`

2. **环境系统辅助函数**（~7 处）
   - `env-lighting.ts`: `exportEnvPreset`, `importEnvPreset`
   - `env-reflection.ts`: `getCurrentReflectionMode`, `isReflectionProbeActive`
   - `env-type-helpers.ts`: `setPostProcessEnabled`, `isWorldMatrixFrozen`
   - `env-water.ts`: `getWaterWaveSpeed`

3. **AR/姿势系统**（~5 处）
   - `ar-camera.ts`: `addARModeChangeListener`, `getARVideoEl`
   - `camera-angle.ts`: `getPreset`
   - `composition-guide.ts`: `cycleGuideMode`, `disposeGuides`

### 中优先级（需确认是否为预留 API）

1. **音频播放列表**（5 处）
   - `audio.ts`: `setPlaylist`, `addToPlaylist`, `getPlaylist`, `getPlaylistIndex`, `prevTrack`
   - **风险**: 可能是为未来播放列表功能预留
   - **建议**: 确认产品需求后再决定

2. **VMD 图层管理**（3 处）
   - `vmd-layers.ts`: `addVmdLayerFromPath`, `clearVmdLayers`, `replaceVmdLayerVmd`
   - **风险**: 可能是为高级 VMD 编辑功能预留
   - **建议**: 确认产品需求后再决定

### 低优先级（保留，误报）

1. **内部使用 + Re-export**（~30 处）
   - `camera.ts`, `camera-state.ts`, `env-impl.ts` 的内部函数
   - **原因**: 模块内部使用，knip 误判

2. **Namespace 访问**（~15 处）
   - `env-impl.ts` 通过 `import * as impl` 访问的函数
   - **原因**: knip 无法追踪 namespace 成员访问

---

## 清理后预期效果

| 指标 | 当前 | 清理后 | 改善 |
|------|------|--------|------|
| 未使用导出 | 86 | ~45 | -48% |
| 代码行数 | - | -~500 LOC | 减少维护负担 |
| Knip 噪音 | 中 | 低 | 提升信号质量 |

---

## 建议下一步行动

1. **立即可做**: 删除高优先级的 ~27 个死代码函数
2. **需讨论**: 音频播放列表和 VMD 图层管理是否为预留 API
3. **长期优化**: 考虑为内部 API 添加 `@internal` JSDoc 标记，帮助 knip 识别

---

**备注**: 本分析基于 knip 输出 + 手动 grep 验证。部分函数可能在运行时通过反射或动态导入使用，但静态分析未发现。建议删除前在开发环境充分测试。
