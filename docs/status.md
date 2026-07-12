# MikuMikuAR 项目现状

> 最后更新：2026-07-12
> 本文件记录当前状态，可随项目进展维护。

---

## 当前状态

Wails (Go) + babylon-mmd 的桌面/移动 PMX 查看器。核心管线、模型库管理、多模型场景、粒子系统、程序化动作、换装系统、环境系统、Android 适配、AR 相机（Phase 1 桌面 MVP）均已就绪。卡通化渲染（ADR-076）已实施。菜单声明式 Schema 架构（ADR-093）55 个面板已迁移完成。

---

## 已完成功能

| 功能 | 状态 |
|------|------|
| 标签系统 | ✅ |
| 渲染调参（Bloom/FXAA/色调映射/曝光/FOV/预设） | ✅ |
| 卡通化渲染预设（ADR-076，一键 Cel-shading 风格） | ✅ |
| 音乐同步 + 相机 VMD + 舞蹈套装 | ✅ |
| 下载目录监听 + 自动导入 | ✅ |
| 模型统计/批量截图/近期播放/表情预览 | ✅ |
| 材质调节（按部位）+ 线框/重力 | ✅ |
| 播放列表 + 模型加载预设 + 软件管理 | ✅ |
| VPD/程序化动作/LipSync/节拍检测/换装/环境系统 | ✅ |
| 粒子系统 + 多相机模式 | ✅ |
| Android 适配 + Wails v3 迁移 + 触屏优化 | ✅ |
| 导入文件（SAF 文件选择器导入 PMX/ZIP/VMD）| ✅ |
| 环境系统增强（纹理地面/粒子溅射/水下后处理） | ✅ |
| AR 相机模式（Phase 1，桌面 MVP：视频透传 + 模型叠加 + Ctrl+6 切换 + 截图合成） | ✅ |
| 队形序列化（Formation 持久化到 .mmascene） | ✅ |


---

## 键盘快捷键

| 快捷键 | 行为 |
|--------|------|
| Ctrl+1~5 | 切换 5 个底部导航弹窗（模型/动作/场景/环境/设置） |
| Ctrl+6 | 切换 AR 相机模式（视频透传 + 模型叠加） |
| Space | 播放/暂停 |
| Escape | 关闭所有弹窗 |
| ←/→ | seek ±5s |
| ↑/↓ | 菜单项导航（弹窗内） |
| Enter/→ | 激活选中项（弹窗内） |
| ←（弹窗内） | 返回上层 |
| WASD | 自由飞行相机（需开启 Freefly 模式） |

### 已知冲突（暂不修）

| 冲突 | 原因 |
|------|------|
| Space 在菜单内仍触发 Play/Pause | 全局 keydown 优先于菜单内 handler |
| WASD freefly 与菜单共存 | freefly 独立于弹窗状态 |

---

## 环境依赖

| 组件 | 版本 | 说明 |
|------|------|------|
| Go | 1.25.0+ | go.mod 锁定 |
| Wails | v3.0.0-alpha2.105 | 已从 v2 迁移 |
| Node.js | 24.16.0+ | 构建/CI 要求（注：`frontend/.nvmrc` 文件不存在，未锁定具体版本）|
| Babylon.js | 9.14.0 | 3D 渲染引擎 |
| babylon-mmd | — | MMD 格式支持 |
| WebView2 | ≥120 | Windows 桌面端 |
| Android SDK | Target 34 | Google Play 要求 |
| JDK | 17 LTS | Android Gradle Plugin 要求 |

---

## 构建命令

```bash
# Go 端
go build ./...

# 前端
cd frontend && npm run check    # tsc 类型检查
cd frontend && npm run build    # vite 生产构建
cd frontend && npm run test     # vitest 单元测试
cd frontend && npm run test:e2e # Playwright E2E（需 wails dev 或 5173+9222）
```

---

## 已知限制

| 限制 | 说明 |
|------|------|
| JS 调试运行时（`VITE_MMD_RUNTIME=js`）| 该模式 `MmdRuntime(scene, null)` 主动不挂载物理，布料/头发摆动失效（设计如此，用于 gaze 行为对比 / WASM 兼容性回退）|
| 注视追踪（gaze）| WASM 模式下由 `wasm-layers-blender` 调度正常运作，**无需**切 JS；JS 仅为调试回退 |
| SSS 次表面散射未实现 | 依赖 babylon-mmd 支持 PBR 材质，上游阻塞 |
| SAF 文件/目录选择 | Android 端经 Wails v3 SAF API (`CanChooseDirectories(true)`) 原生解决；**Windows 端** `SelectDir` 仍受 Wails v3 `CanChooseDirectories` 缺陷影响，实际弹出文件选择器而非目录选择器（待修复，见 ADR-023 §4）|
| **Android: localStorage 容量** | 场景自动保存写 localStorage，Android 有 5MB 限制，大场景可能写满 |
| **Android: AudioContext 惰性创建** | Android WebView 需用户交互后才能创建 AudioContext，首次无声音频可能失败 |
| **Android: Canvas 2D 纹理兼容** | 粒子/天空/水面用 Canvas 2D 绘制纹理，低端 Android GPU 可能有兼容问题 |
| **Android: 渲染性能** | 硬件加速默认开启：Manifest 无 `android:hardwareAccelerated="false"`，Java 层无 `setLayerType(LAYER_TYPE_SOFTWARE)` 调用，未强制软件渲染器。Babylon.js 走 GPU 加速的 WebGL 上下文。大模型场景 FPS 通常低于桌面属移动 GPU 算力/带宽客观差距，非软件降级导致 |

---

## 近期架构重构

| ADR | 内容 | 状态 |
|-----|------|------|
| ADR-050 | 保存触发机制统一（`onChange` / `_triggerAutoSave` → 统一 `triggerAutoSave`，纯重命名，无功能变更） | ✅ 已实施（2026-07-06） |
| - | UIState 全量持久化（原会话级字段 `fpsLimit`/`renderScale`/`cameraSensitivity`/`invertYAxis`/`defaultPhysicsEnabled`/`autoScaleModel`/`vsync`/`materialCategoryMap` 现跨重启持久） | ✅ 已实施（2026-07-07） |
| ADR-076 | 卡通化渲染后处理模式（`RenderState.celShadingMode`，exposure:0.7/contrast:1.4/ACES/bloom:0.25/fxaa:true，开关式快照/恢复） | ✅ 已实施（2026-07-10） |
| ADR-054 §P1.1 | Formation 序列化（场景保存/恢复队形类型 + spacing） | ✅ 已实施（2026-07-11） |
| ADR-055 | AR 相机模式 Phase 1（桌面 MVP：ar-camera.ts + ar-scene.ts + camera 模式 + UI + Ctrl+6 + 截图合成） | ✅ 已实施（2026-07-11） |
| ADR-093 | 菜单声明式 Schema（`MenuNode` + `renderMenu()` 单渲染器，55 面板迁移完成：env/motion/scene/model/settings 全域覆盖） | ✅ 已实施（2026-07-12） |

---

## 进行中的收尾工作

> 非功能缺口，纯粹重构收尾，不阻塞项目。

| 缺口 | 来源 | 剩余工作量 | 状态 |
|------|------|-----------|------|
| 语言切换 UI（`setLang` + 热切换） | ADR-059 Phase 3 | ~50 处 `setStatus`/`toast` → `t()` 替换 | ✅ 完成（2026-07-10，40 处硬编码 CJK 全部 t() 化；5 种语言包已齐全：zh-CN.ts + en.ts + ja.ts + ko.ts + zh-TW.ts）|
| 默认模型行为 auto-center | ADR-035 §实施进度 | 与现有 arrange 逻辑冲突，需重新设计 | 待定 |

---

## Bug 记录

详见 git history。
