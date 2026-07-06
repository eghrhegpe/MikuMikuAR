# ADR-035: 设置面板功能缺口评估

**日期**: 2026-07-05
> **状态**: 部分完成 (In Progress) — Phase A（音频/截图/快捷键）与部分 Phase B（帧率上限/UI缩放/缓存清理）已在 v1.1.4 落地，剩余缺口见下方「实施进度」

---

## 背景

2026-07-05 代码质量重构（config.ts/ui-helpers/scene-render-levels 拆分 + slideRow/tryCatchStatus 去重）基本收官后，对现有设置面板进行了功能完整性评估。

### 当前设置面板结构

现有 6 个子面板：

| 面板 | 文件 | 功能 |
|------|------|------|
| 外观 | settings-appearance.ts | 主题/背景色/面板透明度/字体大小/语言 |
| 文件名 | settings-filename.ts | 文件名/目录名显示格式、开头字母、分隔符 |
| 性能 | settings-performance.ts | 渲染质量滑块（低-中-高-最高）、SHADOW_QUALITY/PARTICLE_LIMIT 关联 |
| 路径 | settings-paths.ts | 各资源目录（model/motion/outfit/backdrop/prop/screenshot）浏览设置 |
| 软件 | settings-software.ts | 版本号、更新频道、关于信息 |
| settings.ts（入口） | settings.ts | 左侧导航栏 + 各面板组合 |

设置通过 `SettingsState`（config.ts 分裂后移入 state.ts）驱动：`settingsState.showFilenameFormat` 等 5 个布尔值。

### 评估方法

与 `docs/competitive-analysis.md` 中 DanceXR (WebXR Viewer) 的 20+ 竞品对标，提取桌面 3D 查看器通用设置清单，逐项标记 MikuMikuAR 现状。

---

## 设置缺口清单

### P0 — 直接影响可用性

| 设置项 | DanceXR | MikuMikuAR | 缺口影响 |
|--------|---------|------------|---------|
| **音频/音量控制** | 主音量 + BGM/SFX 分离 | ❌ 无 UI（audio.ts 有 AudioContext 但无设置入口） | 用户无法调节 BGM/SFX 比例 |
| **语言切换** | 多语言 | ❌ 全中文硬编码，字体选项仅改字号 | 非中文用户零配置入口 |
| **截图/导出** | 截图格式/质量/路径 | ❌ 无截图功能入口 | 用户想截图需 OS 级截屏 |
| **快捷键/键位映射** | 可配置 | ❌ 固定硬编码 | 部分快捷键可能与其他软件冲突不可改 |

### P1 — 显著影响体验

| 设置项 | DanceXR | MikuMikuAR | 缺口影响 |
|--------|---------|------------|---------|
| **渲染独立开关** | 阴影/抗锯齿/后处理独立 | ⚠️ Lite/Medium/High/Ultra 捆绑 | 想关 BLoom 保留阴影做不到 |
| **垂直同步** | 开关 | ❌ 无 | 撕裂/功耗不可控 |
| **FPS 上限** | 30/60/120/无限制 | ❌ 无 | 高刷屏无谓发热 |
| **渲染分辨率缩放** | 50%-200% | ❌ 无 | 4K 屏性能不达标时无法降低渲染负载 |
| **默认模型行为** | 加载缩放/自动居中 | ❌ 无 | 大模型加载后可能在视野外 |
| **鼠标/触控灵敏度** | 可调 | ❌ 无 | 不同 DPI 鼠标体验差异大 |
| **默认物理开关** | Physics.enabled | ❌ 无 | 低配机不支持物理但每次需手动关 |
| **反 Y 轴** | 开关 | ❌ 无 | 部分用户习惯反转 Y |

### P2 — 锦上添花

| 设置项 | 描述 | 优先级评估 |
|--------|------|-----------|
| 重置所有设置 | 一键恢复默认 | 低（目前可删除 localStorage） |
| 设置导入/导出 | JSON 配置文件 | 低（用户量级暂不需） |
| UI 缩放 | 独立于系统 DPI | 中（高 DPI 屏有需求） |
| 模型缓存清理 | 显式清除缓存的材质/纹理 | 中 |
| 自动更新开关 | 检查更新频率 | 低 |

---

## 实施建议

### 架构影响

音频设置接入现有 `audio.ts`（已有 `BGM.src`、`sfxVolume`），只需写 UI 层。不需要新引擎功能。

画质独立开关涉及 `render/performance.ts` 降级逻辑。当前 `QualityPreset`（Lite/Medium/High/Ultra）是整体降级，需拆到单个 toggle 可覆盖的粒度。建议保持 preset 为默认，加 "Custom" 模式，单独 toggle 时自动切到 Custom。

### 推荐分期

```
Phase A（P0，建议 2-3 天）：
  1. 音频设置: 主音量滑块 + BGM/SFX 独立滑块
  2. 截图功能: 格式(PNG/WebP) + 质量 + 自动保存目录
  3. 快捷键映射: 读取 → 显示 → 允许修改

Phase B（P1，建议 3-5 天）：
  4. 画质独立开关: 重构 performance.ts 为 preset + override 模式
  5. FPS 上限 + 垂直同步: 接入 requestAnimationFrame 限帧
  6. 默认模型行为: model-loader.ts 加载后应用默认设定

Phase C（P2，后续）：
  7. 语言切换框架（i18n）
  8. 模型缓存清理 UI
  9. UI 缩放
```

---

## 不 scope

- **音频可视化效果器** — 不在 MV 查看器核心职责内
- **性能监控面板（FPS 显示/GPU 温度）** — 暂由浏览器 DevTools 覆盖
- **VR/AR 设备设置** — 当前无 VR 模式计划

---

## 实施进度 (v1.1.4 起)

| 缺口项 | 优先级 | 状态 |
|--------|--------|------|
| 音频/音量控制 | P0 | ✅ 已完成（设置页音量/静音/偏移/BPM量化/伴音自动加载） |
| 截图/导出 | P0 | ✅ 已完成（格式+质量+Go SaveScreenshot） |
| 快捷键/键位映射 | P0 | ✅ 已完成（shortcut-registry + 设置页重绑） |
| 语言切换 (i18n) | P0 | ❌ 未做 |
| 帧率上限 | P1 | ✅ 已完成（0–144 滑块） |
| 渲染独立开关 (Custom) | P1 | ✅ 已完成 |
| 垂直同步 | P1 | ❌ 未做 |
| 渲染分辨率缩放 | P1 | ✅ 已完成（engine.setHardwareScalingLevel + 性能页滑块 0.5–2x）|
| 默认模型行为 | P1 | 🟡 部分（auto-scale 已实现；auto-center 与 arrange 冲突待设计）|
| 鼠标/触控灵敏度 | P1 | ✅ 已完成（ArcRotate/Universal 灵敏度倍率 + 性能页滑块，实时生效）|
| 默认物理开关 | P1 | ✅ 已完成（uiState.defaultPhysicsEnabled + 性能页开关 + model-loader 默认读取）|
| 反 Y 轴 | P1 | ❌ 未做（Babylon 无原生 invertY，需自定义指针输入子类，见下）|
| UI 缩放 | P2 | ✅ 已完成 |
| 模型缓存清理 | P2 | ✅ 已完成 |
| 重置所有设置 | P2 | 🟡 部分（仅外观/快捷键恢复默认） |
| 设置导入/导出 | P2 | ❌ 未做 |
| 自动更新开关 | P2 | ❌ 未做 |

