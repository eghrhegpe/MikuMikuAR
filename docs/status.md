# MikuMikuAR 项目现状

> 最后更新：2026-07-15
> 本文件记录当前状态，可随项目进展维护。

---

## 当前状态

Wails (Go) + babylon-mmd 的桌面/移动 PMX 查看器。核心管线、模型库管理、多模型场景、粒子系统、程序化动作、换装系统、环境系统、Android 适配、AR 相机（Phase 1 桌面 MVP）均已就绪。卡通化渲染（ADR-076）已实施。菜单声明式 Schema 架构（ADR-093）57 个面板迁移完成。v1.3.5 已发布（ADR-095/096/097/098/100/101/102/103 批量重构落地）。SettingsStore 已移除，所有设置统一归入 uiState 持久化链路。MPR/COOP/COEP 真机验证通过（ADR-099）。广场浏览器体验增强全量完成（ADR-087）。StreamAudioPlayer 音频管线替换落地（ADR-107）。AnimationRetargeter 骨骼映射 + 动作重定向接入（ADR-108）。SDEF 球面变形渲染（ADR-112）。IMmdModel 上游 PR 计划（ADR-110）。场景/环境菜单按用户直觉重新划分规划（ADR-111）。

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
| 资源库浏览与恢复（RecentModels 模型记忆 + 路径边界加固，ADR-097） | ✅ |
| 通用 Helper 单点收敛（clamp/lerp/Color3/深拷贝/时间戳，ADR-096） | ✅ |
| 路径归一化与归属判定统一（isUnderRoot 工厂，ADR-095） | ✅ |
| babylon-mmd API 对接批次一（ADR-098） | ✅ |
| StreamAudioPlayer 音频管线替换（ADR-107） | ✅ |
| AnimationRetargeter 骨骼映射 + 动作重定向（ADR-108） | ✅ |
| SDEF 球面变形渲染（ADR-112） | ✅ |
| 相机行为双轴控制（CameraControl × CameraBehavior，ADR-100，P1-P5 已提交） | 🔄 实施中 |
| 虚拟裙骨（Mesh-to-Cloth，ADR-084） | 🔄 实施中 |
| 脚部地面跟随（ADR-085） | 🔄 部分实现 |
| 音效系统—脚步声与 SFX 总线（ADR-088） | 🔄 部分实现 |
| 广场浏览器体验增强（ADR-087，P0+P1+P2 全量完成） | ✅ |
| MPR/COOP/COEP（ADR-099，真机 SAB 验证通过） | ✅ |
| 通用逻辑模式收敛第二波（ADR-101，P1/P2/P3 全阶段，1476 测试通过） | ✅ |
| main.ts 拆分（ADR-102，P0-P5 全阶段落地） | ✅ |
| SettingsStore 持久化接入 uiState（ADR-103） | ✅ |


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
| ADR-093 | 菜单声明式 Schema（`MenuNode` + `renderMenu()` 单渲染器，57 面板迁移完成：env/motion/scene/model/settings 全域覆盖） | ✅ 已实施（2026-07-12） |
| ADR-095 | 路径归一化与归属判定统一（`isUnderRoot` / `computeLibraryRef` 工厂，修复 `GetLastBrowseDir` 单字符串误解构 bug） | ✅ 已实施（2026-07-13） |
| ADR-096 | 通用 Helper 单点收敛（`clamp`/`lerp`/`Color3` 三元组/深拷贝/时间戳 → `core/utils.ts` + `core/color-helpers.ts`） | ✅ 已实施（2026-07-13） |
| ADR-097 | 资源库浏览与恢复决策汇总（RecentModels 模型记忆 + 库路径边界加固） | ✅ 已实施（2026-07-13） |
| ADR-098 | babylon-mmd API 对接批次一（环境模块/后端批量改动） | ✅ 已实施（2026-07-13） |
| ADR-099 | MPR/COOP/COEP POC（Go 端注入 + 前端 MPR 切换 + 真机 SAB 验证） | ✅ 已实施（2026-07-14） |
| ADR-100 | 相机行为双轴控制（CameraControl × CameraBehavior 派生 + 序列化 + 两级 UI） | 🔄 实施中（2026-07-13） |
| ADR-101 | 通用逻辑模式收敛第二波（错误处理/生命周期守卫/纯函数，~350+ 处重复模式） | ✅ 已实施（2026-07-14，P1/P2/P3 全阶段，1476 测试通过） |
| ADR-102 | main.ts 拆分（init/events/render-loop/dev-hooks，P0-P5 全阶段落地） | ✅ 已实施（2026-07-14） |
| ADR-103 | SettingsStore 移除 + 设置统一归入 uiState 持久化链路 | ✅ 已实施（2026-07-14） |
| ADR-104 | 物理/换装/音频子系统设计债暂缓登记 | 🔄 部分实现（2026-07-14，Claim 11/12 已落地） |
| ADR-105 | AbortSignal 传递规范与异步异常处理基线 | ✅ Phase 1+2 完成（2026-07-14） |
| ADR-106 | 时序审核与异步生命周期规范 | ✅ 全部完成（Phase 1 ✅ + Phase 2 ✅ + Phase 3 ✅）（2026-07-16 对账：代码均已落地） |
| ADR-107 | StreamAudioPlayer 接入 — 替换自建音频管线 | ✅ 已完成（2026-07-14） |
| ADR-108 | AnimationRetargeter + HumanoidMmd 接入 — 扩展动作来源 | ✅ 已落地（2026-07-14） |
| ADR-112 | SdefInjector + SdefMesh 接入 — SDEF 球面变形 | ✅ 已完成（2026-07-14） |
| ADR-109 | AR 模块审查结论与遗留项排期 | 🔄 部分实现（2026-07-14，#2/#3/#5 已修复） |
| ADR-110 | IMmdModel 接口类型补全 — 上游 PR 计划 | 📋 草案 · 待立项（2026-07-14） |
| ADR-111 | 场景/环境菜单按用户直觉重新划分 | 📋 规划（2026-07-14） |

---

## 进行中的收尾工作

> 非功能缺口，纯粹重构收尾，不阻塞项目。

| 缺口 | 来源 | 剩余工作量 | 状态 |
|------|------|-----------|------|
| 语言切换 UI（`setLang` + 热切换） | ADR-059 Phase 3 | — | ✅ 完成（2026-07-10，40 处硬编码 CJK 全部 t() 化；5 种语言包已齐全：zh-CN.ts + en.ts + ja.ts + ko.ts + zh-TW.ts）|
| 默认模型行为 auto-center | ADR-035 §实施进度 | 与现有 arrange 逻辑冲突，需重新设计 | 待定 |
| 广场浏览器体验增强（ADR-087） | ADR-087 | — | ✅ 完成（2026-07-14，P0+P1+P2 全量：下载拦截 + 导航控制 + 遥控面板 + URL 追踪 + 下载进度 + Per-site 模式记忆 + Embed 加载指示 + 拖放导入 + 下载完成 Toast + 模型库自动刷新 + 键盘快捷键）|
| 材质/分类开关 <label> 原生二次 click 双触发抵消 | 2026-07-14 实证 | `model-material.ts`/`ui-collapsible.ts`/`ui-slide-row.ts` | ✅ 修复（`if (e.target === input) return; e.preventDefault();`） |
| 广场浏览器创作者模式 + 状态栏增强 + i18n 补全 | 2026-07-14 | plaza.ts + plaza_config.go | ✅ 完成（创作者模式 + 状态栏 + 5 语言包同步） |
| 环境预设等级 + 模型材质重构 + ZIP 解压 | 2026-07-14 | env-preset-levels.ts / model-material.ts / zipextract.go | ✅ 完成（env preset levels + model material + i18n sync + zipextract） |
| ESLint 3601 警告自动修复 | 2026-07-14 | frontend/eslint.config.js + 全仓 .ts | ✅ 完成（hoist _snapshotGroundWaterFields + 添加 __MMD_ENABLE_MPR__ global） |
| Mock CacheStats 补齐 resourceBytes/resourceCount | 2026-07-14 | frontend/src/__tests__/mocks/binding-factories.ts | ✅ 完成 |
| 广场站点数据扩充 + UI 优化 | 2026-07-14 | plaza.ts | ✅ 完成（mergeSites 深拷贝 + 创作者模式 + presetSearches 合并） |
| plaza_config 路径调整 + 数据文件更新 | 2026-07-14 | plaza_config.go | ✅ 完成（路径从 frontend/src/menus/ 移至根目录 + GitHub owner 更新） |
| 冗余数据文件移除 + plaza_config 微调 | 2026-07-14 | plaza_config.go | ✅ 完成 |
| BeatDetector 桥接时机修复 + 测试 mock 防泄漏 | 2026-07-14 | 全仓测试 | ✅ 完成 |
| ReadTextFile binding 注册修复 | 2026-07-14 | 契约测试 | ✅ 完成 |
| motion-popup 微调 | 2026-07-14 | motion-popup.ts | ✅ 完成 |
| 广场浏览器增强与多模块同步 | 2026-07-14 | plaza.ts + 多模块 | ✅ 完成（广场浏览器增强 + 广场窗口增强 + 相机行为扩展 + 国际化更新 + 测试同步） |
| 全仓菜单/环境/感知重构 | 2026-07-12 | 全仓 | ✅ 完成（ADR-093 声明式菜单落地 + 测试同步 + i18n 更新） |
| 地面模式拆分 + 对话历史 + 脚部/裙物理修复 | 2026-07-11 | 多模块 | ✅ 完成 |
| 地面环境修复 + 脚部调整 + 环境桥接 + audit 报告 | 2026-07-11 | 多模块 | ✅ 完成 |
| feet-adjustment 精度修正 + ADR-085 文档补充 | 2026-07-11 | feet-adjustment.ts | ✅ 完成 |
| 裙装物理 + 环境反射 + 状态/类型修复 | 2026-07-11 | 多模块 | ✅ 完成 |
| ADR-066/090/094/095 状态更新 + ADR-097 新增 + buglog | 2026-07-13 | docs/adr/ | ✅ 完成 |
| ADR-095 文档同步（状态→已完成，批次5标记，过时描述修正） | 2026-07-13 | docs/adr/ | ✅ 完成 |
| 通用 helper 单点收敛 (ADR-096) | 2026-07-13 | core/utils.ts + core/color-helpers.ts | ✅ 完成 |
| 统一贴图工厂与平面反射引擎，修复反射双双失效 | 2026-07-13 | env 模块 | ✅ 完成 |
| 保存触发机制统一（onChange / _triggerAutoSave → 统一 triggerAutoSave） | 2026-07-06 | 保存模块 | ✅ 完成（纯重命名，无功能变更） |
| UIState 全量持久化 | 2026-07-07 | 持久化模块 | ✅ 完成（原会话级字段 fpsLimit/renderScale/cameraSensitivity/invertYAxis/defaultPhysicsEnabled/autoScaleModel/vsync/materialCategoryMap 现跨重启持久） |
| 卡通化渲染后处理模式（Cel-shading） | 2026-07-10 | 渲染模块 | ✅ 完成（RenderState.celShadingMode，exposure:0.7/contrast:1.4/ACES/bloom:0.25/fxaa:true，开关式快照/恢复） |
| Formation 序列化（场景保存/恢复队形类型 + spacing） | 2026-07-11 | 场景模块 | ✅ 完成 |
| AR 相机模式 Phase 1（桌面 MVP） | 2026-07-11 | ar-camera.ts + ar-scene.ts | ✅ 完成（ar-camera.ts + ar-scene.ts + camera 模式 + UI + Ctrl+6 + 截图合成） |

---

## 进行中的 ADR

| ADR | 主题 | 状态 | 备注 |
|-----|------|------|------|
| ADR-084 | 虚拟裙骨（Mesh-to-Cloth） | 🔄 实施中 | Phase 1-5 POC + P2/P3 审计完成；真机/模型实测微调参数中；P2b(A1 蒙皮天花板)/P3c(worldId 回收) 为已知限制 |
| ADR-085 | 脚部地面跟随 | 🔄 部分实现 | Phase A 已完成；Phase B/C 待开发 |
| ADR-088 | 音效系统—脚步声与 SFX 总线 | 🔄 部分实现 | Phase A 已完成（audio-bus + footstep.ts）；Phase B/C 待开发 |
| ADR-093 | 菜单声明式 Schema | ✅ 已完成 | P0+P1+P2+P3 全量完成，SettingsStore 已移除，57 面板迁移完成 |
| ADR-100 | 相机行为双轴控制 | 🔄 实施中 | P1（契约+shim）+ P2（运行时接线）+ P3-P5（序列化+双写+两级 UI）已提交；P6 收尾中 |
| ADR-104 | 物理/换装/音频子系统设计债暂缓 | 🔄 部分实现 | Claim 11/12 已落地，Claim 13 仅登记 |
| ADR-105 | AbortSignal 传递规范与异步异常处理基线 | ✅ Phase 1+2 完成 | Phase 1（fileservice/model-loader/vmd-loader）+ Phase 2（loadProp/loadOutfits/handlePlazaDownload）已落地 |
| ADR-106 | 时序审核与异步生命周期规范 | ✅ 全部完成 | Phase 1 ✅ + Phase 2 ✅ + Phase 3 ✅（2026-07-16 代码对账确认） |
| ADR-107 | StreamAudioPlayer 接入 | ✅ 已完成 | 全 3 阶段落地（内部实现替换 + 测试适配 + MmdRuntime 集成） |
| ADR-108 | AnimationRetargeter + HumanoidMmd 接入 | ✅ 已落地 | 桥接模块 + UI 入口 + 骨骼映射预设选择完整 |
| ADR-112 (SDEF) | SdefInjector + SdefMesh 接入 | ✅ 已完成 | side-effect import 已加入 scene.ts |
| ADR-109 (AR) | AR 模块审查结论与遗留项排期 | 🔄 部分实现 | #2/#3/#5 已修复，#1/#6/#7 排期中 |
| ADR-110 | IMmdModel 接口类型补全 — 上游 PR 计划 | 📋 草案 · 待立项 | 4 处 cast 待上游 PR 合并后移除 |
| ADR-111 | 场景/环境菜单按用户直觉重新划分 | 📋 规划 | Phase 1（解耦状态）/ Phase 2（迁移 UI 归属）/ Phase 3（后处理迁移）待实施 |

---

## Bug 记录

详见 git history。
