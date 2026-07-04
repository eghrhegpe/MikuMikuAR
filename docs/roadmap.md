# MikuMikuAR 路线图

> 从 `status.md` 拆分，包含计划中清单、开发路线图、DanceXR 对标进度和下一步规划。

---

## 计划中

- [x] 标签系统（替代 DanceXR 分类硬编码）✅ 已完成（Phase 1）
- [x] 场景保存/加载（`.mmascene` JSON 格式，含模型/VMD/相机状态）✅ 已完成
- [x] 渲染调参系统（Phase 2）— Bloom/FXAA/边缘高亮/色调映射/曝光/对比度/FOV/背景色 + 5 内置预设 + 用户自定义预设持久化 ✅ 已完成
- [x] 音乐同步 + 相机 VMD + 舞蹈套装（Phase 3）✅ 已完成
- [x] 模型统计信息 + 批量截图 + 近期播放 + 表情预览（Phase 5）✅ 已完成
- [x] 单独材质编辑器（逐材质独立调参）✅ 已完成
- [x] VPD 姿势导入（VPD → VMD 帧转换，含编码自动检测 Shift-JIS/UTF-8）✅ 已完成
- [x] 模型加载预设（角色设置快照）✅ 已完成
- [x] 软件管理（扫描 software/ 目录 + 自定义软件 + 模型详情「用…打开」）
- [x] 程序化动作（Auto Dance / Idle Motion）
- [x] 音乐节拍检测（Web Audio API 能量峰值法）
- [x] 换装系统（服装变体/纹理替换）✅ 已完成
- [x] 物理分类开关（按部位选择性开关物理）✅ 已完成
- [x] LipSync（实时振幅驱动「あ」morph）— Web Audio 人声频段能量 → amplitudeToWeight → setModelMorphWeight ✅
- [x] 天空 / 水体 / 道具 / 特效 ✅
- [ ] ❌ 模之屋下载接管 — 放弃。WebView 方案风险过高，见 ADR-003
- [x] ✅ Android 端适配 — Beta 版本目标：2026-07-15

---

## 开发路线图

```
Week 1-2 VMD 播放 + 纹理加载 ← ✅
downarrow ↓
Week 3-4 模型库浏览 ← ✅
downarrow ↓
Week 5-6 zip 容器 ← ✅ 提前交付
downarrow ↓
Week 7+ 外部库挂载 + 体验打磨 ← ✅
downarrow ↓
Phase 1 标签系统 ← ✅ 已完成
downarrow ↓
Phase 2 渲染调参系统 ← ✅ 已完成
├── 材质参数(按部位) + 单独材质编辑器 ✅ 已完成
├── 后处理滤镜(Bloom/轮廓线/色彩校正) ✅
├── 渲染预设 + 色调映射 ✅
├── 曝光/FOV/重力 ✅
└── 线框/骨骼显示切换 ✅
downarrow ↓
Phase 3 音乐同步 + 相机VMD ← ✅ 已完成
├── 音乐同步(MP3/WAV/OGG) + 音频偏移 ✅
├── 相机 VMD 轨道 ✅
└── 舞蹈套装(VMD+音频捆绑) ✅
downarrow ↓
Phase 4 下载目录监听 + 自动导入 (ADR-008) ← ✅ 已完成
downarrow ↓
Phase 5 体验完善 ← ✅ 已完成
├── 模型统计信息(顶点/面/骨骼/表情) ✅
├── 批量截图(截图当前/批量截图到目录) ✅
├── 近期播放(最近打开的模型) ✅
├── 收藏底层合并到标签系统 ✅
└── 表情预览(滑块调节所有morph) ✅
downarrow ↓
Phase 6 材质与渲染增强 ← ✅ 全部完成
├── 材质参数调节(按部位:皮肤/头发/眼睛) ✅
├── 单独材质编辑器(逐材质独立调参) ✅
├── 线框/骨骼显示切换 ✅
└── 重力控制(衣物/头发物理摆动) ✅
downarrow ↓
Phase 7 播放列表与预设 ← ✅ 全部完成
├── 播放列表(模型顺序列表/标签自动生成) ✅
├── 模型加载预设(角色设置快照) ✅
└── 软件管理(扫描 software/ 目录) ✅
downarrow ↓
Phase 8 动作与环境增强 ← ✅ 已完成
├── VPD 姿势导入 ✅
├── 程序化动作(Auto Dance/Idle Motion) ✅
├── 换装系统/纹理增强 ✅
├── LipSync/音乐节拍检测 ✅
└── 天空/水体/道具/特效 ✅
downarrow ↓
Phase 9 扩展物理与平台 ← ✅ 已完成
├── 粒子系统(樱花/雨/雪/烟花) ✅
├── 布料模拟/软体物理（XPBD 核心引擎 + 程序化裙摆）✅
└── 多相机模式(Freefly/One-shot/Concert) ✅
downarrow ↓
Phase 10 Android 适配 ← 已就绪
```

---

## 核心价值定位

与其他方案的区别：

| 对比 | DanceXR | babylon-mmd demo | gzhlaker_mmdmanager | MMD Viewer (纯Web) | MmdOnlineStudioV1 | MikuMikuAR |
|------|---------|------------------|---------------------|-------------------|-------------------|--------|
| 定位 | 成品播放器 | 技术演示 | 桌面管理器 | **渲染调参标杆** | 在线轻量查看器 | **聚合管理器 + 播放器** |
| 桌面集成 | 原生 | 纯网页 | Electron | 纯浏览器 | 纯浏览器 | **Wails 轻量原生** |
| 库管理 | 文件系统 | 无 | ✅ 文件浏览 | 无 | 无 | **✅ 完整库管理** |
| 多模型同场 | ✅ | ❌ | ❌ | ❌ | ❌ | **✅ 核心优势** |
| 渲染调参 | ❌ | ❌ | ❌ | **✅ 极丰富** | ❌ | ⬜ 补齐中 |
| 物理 | ✅ WASM Bullet | ammo.js | ❌ | ammo.js | ❌ | **✅ WASM Bullet** |
| 模型统计 | ❌ | ❌ | ❌ | ❌ | ✅ 顶点/材质/骨骼 | ✅ 顶点/面/骨骼/表情 |
| 聚合生态 | 封闭 | 无 | 封闭 | 无 | 无 | **DanceXR+Blender+模之屋** |

MikuMikuAR 的独特价值在于**聚合生态**：让 DanceXR、Blender、模之屋的用户共享同一个模型库。

---

## DanceXR 功能对标进度总览

基于 [requirements.md](requirements.md) §「DanceXR 功能对标与规划参考」的详细映射表，以下为整体搬运进度：

| 分类 | 总数 | ✅ 已覆盖 | 📋 可规划 | 🔄 转发层 | ❌ 不适配 | 完成率 |
|------|------|----------|-----------|-----------|----------|--------|
| 模型支持 | 7 | 6 | 1 | 0 | 0 | **86%** |
| 外观(渲染) | 10 | 9 | 1 | 0 | 0 | **90%** |
| 物理 | 1 | 1 | 0 | 0 | 0 | **100%** |
| 动作与媒体 | 10 | 8 | 0 | 2 | 0 | **80%** |
| 氛围与环境 | 2 | 2 | 0 | 0 | 0 | **100%** |
| 相机 | 2 | 2 | 0 | 0 | 0 | **100%** |
| 系统与平台 | 4 | 3 | 1 | 0 | 0 | **75%** |
| **合计** | **36** | **31** | **3** | **2** | **0** | **86%** |

> 统计口径：仅统计对标表中非 🔄/❌ 的可实现功能。AI/AI 语音/成人内容等全部 🔄/❌ 不纳入。

### 已完成的核心里程碑

| 阶段 | 功能 | 状态 |
|------|------|------|
| Phase 1 | 标签系统 | ✅ |
| Phase 2 | 渲染调参（Bloom/色调映射/曝光/FOV/预设） | ✅ |
| Phase 3 | 音乐同步 + 相机 VMD + 舞蹈套装 | ✅ |
| Phase 4 | 下载目录监听 + 自动导入 | ✅ |
| Phase 5 | 体验完善（统计/截图/播放记录/表情预览） | ✅ |
| Phase 6 | 材质与渲染增强（材质调节/线框/重力） | ✅ |
| Phase 7 | 播放列表 + 模型加载预设 + 软件管理 | ✅ |
| Phase 8 | 程序化动作 + 音乐节拍检测 + 换装系统 + 物理分类开关 | ✅ |
| Phase 9 | XPBD 布料模拟 + 粒子系统 + 多相机模式 | ✅ |
| Phase 10 | Android 适配（Beta 目标 2026-07-15） | ✅ 已就绪 |

**XPBD 布料模拟（Phase 9，2026-06-28）**
- [x] `xpbd-solver.ts` — XPBD 核心引擎（Verlet 积分 + 子步约束求解 + 距离/弯曲/体积约束）
- [x] `xpbd-collider.ts` — SDF 胶囊碰撞器（头/颈/胸/腰/臀/四肢 13 胶囊，支持骨骼跟随）
- [x] `xpbd-cloth.ts` — 程序化裙摆网格生成 + 骨骼锚定 + 每帧 Mesh 更新
- [x] `xpbd-renderer.ts` — 调试可视化（粒子小球/约束线条/胶囊线框）
- [x] `scene-model.ts` 集成 — `getBoneWorldMatrix` / `addCloth` / `removeCloth` / 渲染观察者按需注册
- [x] 测试套件 — `xpbd-solver.test.ts` + `xpbd-cloth.test.ts`（20 tests，全部通过）

**LipSync（实时振幅驱动）**
- [x] `lipsync.ts` 纯函数模块（findLipMorph / amplitudeToWeight / LipSyncState）
- [x] `BeatDetector.getLevel` 暴露频段能量
- [x] `scene.ts` 动画 tick 集成 + setter/getter + SceneFile 序列化
- [x] 场景菜单「程序化动作 → LipSync」子菜单（启用 + 灵敏度 + 强度）

### 待搬运的 DanceXR 深度功能

| 功能 | 优先级 | 依赖 |
|------|--------|------|
| VPD 姿势导入 | P3 | VMD 加载器扩展 | ✅ 已完成 |
| 程序化动作（Idle Motion/Auto Dance） | P3 | WASM 动画扩展 | ✅ 已完成 |
| 换装系统 / 纹理增强 | P4 | 模型系统扩展 | ✅ 已完成 |
| 物理分类开关 | P3 | 骨骼名正则分类 | ✅ 已完成 |
| LipSync / 音乐节拍 | P4 | 音频系统扩展 | ✅ 已完成 |
| 布料模拟 / 软体物理 | P4 | 独立 XPBD 引擎（纯 TS，不依赖 WASM） | ✅ 已完成 |
| 天空 / 水体 / 道具 / 特效 | P4 | 场景系统扩展 | ✅ 已完成 |

---

## 下一步

核心管线与 Phase 1-9 全部就绪，进入 **Phase 10 Android 适配 + 技术债清偿** 阶段：

**推荐执行顺序**
```
1️⃣ Phase 10 Android 适配（P0）
 └─ Wails mobile 桥接全链路验证
 └─ 文件服务/触摸交互/性能适配

2️⃣ 深度体验打磨
 └─ UI 交互动画优化
 └─ 键盘快捷键冲突解决（Space/→← vs 菜单导航）
 └─ 无障碍完善（role="menuitem"/tabindex）

3️⃣ 技术债清偿（2026-07+）
└─ **WASM→JS 运行时物理替代方案**
  - ✅ JS 版 XPBD 引擎核心（`xpbd-solver`/`xpbd-collider`/`xpbd-cloth`）已实现。
  - 🔄 **缺失功能**：真实布料摆动/毛发物理（依赖胶囊骨骼链计算）。替代方案：裙摆内置骨骼动画或 VMD 动画预生成；暂无完整方案时，用户可手动导出动画 VMD。
└─ **旧代码清理 + 模块边界整理**
  - ✅ `settings-software.ts` 已从 `settings.ts` 拆分独立。
  - ✅ `scene-model-ops.ts`、`scene-performance.ts` 模块化。
  - 🔄 2026-07：清理 `app.go` 全局错误/日志策略，整合 `MenuStack` 生命周期。
  - 🔄 2026-08：避免 `config.ts` 全局状态污染，清理 `scene.ts`/`app.go` 副作用。
```

**已完成（Phase 8 深度功能搬运）**
- ✅ 程序化动作（Auto Dance / Idle Motion）
- ✅ 音乐节拍检测（Web Audio API 能量峰值法）
- ✅ 单独材质编辑器（逐材质独立调参）
- ✅ 模型加载预设（角色设置快照）
- ✅ 换装系统（服装变体）
- ✅ 物理分类开关（按部位选择性开关物理）
- ✅ 天空/水体/道具/特效（粒子系统 + 环境系统）
- ✅ LipSync / 视线追踪

**已完成（Phase 9 扩展物理与平台）**
- ✅ 粒子系统（樱花/雨/雪/烟花 + 风力联动）
- ✅ 布料模拟 / 软体物理 — XPBD 核心引擎 + 程序化裙摆网格 + SDF 胶囊碰撞 + 调试渲染器
- ✅ 多相机模式（Freefly/One-shot/Concert）UI 完善

**测试基建已就绪**
- Vitest 前端测试套件 20 文件，覆盖真 import
- `material-editor` + `model-preset` 伪测试清零，regression 由 `_applyAll` 叠加顺序 5 tests + `serializeModelPreset`/`applyModelPreset` 来回 11 tests 锁住
- Babylon.js mock 层可复用于后续任何需要真 import scene.ts 的测试文件

**中长期（Phase 10+）：扩展平台**
- 🔄 Android 端适配 — Beta 目标 2026-07-15

---



## 长期愿景（1-3 年）

> 每个目标 = 具体交付件 + 可测量指标 + 验收方式

### 交付件路线图（3 年）

| 时间 | 交付件 | 指标 | 验收 |
|------|--------|------|------|
| 2026 Q4 | Android 公测包 + Win/macOS/Linux 安装包 | 100 名测试用户，Crash-free ≥ 98% | TestFlight + 3 台 VM 安装测试 |
| 2027 Q1 | 插件沙箱 v0.1 + 1 个 Python 示例插件 | 恶意插件隔离测试通过，示例加载 ≤ 2s | 安全测试报告 + CI sandbox test |
| 2027 Q2 | iOS TestFlight 公测包 + iPad 多尺寸适配 | iPhone 14 启动成功率 ≥ 90%，无 UI 溢出 | 真机测试 |
| 2027 Q3 | DanceXR .pose 导入器 + Blender 导出脚本 | .pose 导入成功率 ≥ 80%，Blender CI 通过 | 10 个样本文件自动化测试 |
| 2027 Q4 | REST API v1（openapi.yaml）+ 1 个第三方集成 | 至少 1 个外部工具成功集成 | 社区 Issue 确认 |
| 2028 Q1 | 插件市场测试版（GitHub Actions CI/CD） | 插件包 CI 构建成功率 ≥ 95% | 至少 5 个插件上线 |
| 2028 Q2 | i18n 三语 UI（日/英/中）第一版 | UI 字符串覆盖率 ≥ 90% | Lokalise 翻译完成 |
| 2028 Q4 | 模型 marketplace MVP 上线 | 至少 10 个付费/免费模型包 | Stripe 集成 + 支付流程测试 |

### 三年目标（按维度）

**平台扩展**
- 2026 Q4：Win/macOS/Linux CI 流水线 + VM 安装自动化测试（ /  / ）
- 2027 Q2：iOS TestFlight 公测（iPhone 14 + iPad Pro 真机验证，SwiftUI 多尺寸适配）

**生态集成**
- 2027 Q3：DanceXR  格式完整支持（字段覆盖率 ≥ 80%）+ mmd_tools Blender 脚本 CI 通过
- 2028：模型 marketplace MVP（Stripe Connect + 创作者后台 + 搜索/筛选）

**插件系统**
- 2027 Q1：Wails IPC 沙箱（进程隔离）+ Python/Lua runtime 加载器
- 2027 Q4：插件市场测试版（GitHub Actions CI/CD + 插件审核队列）

**开放 API**
- 2027 Q4： v2 格式文档（）+ OpenAPI 3.0 规范 + 至少 1 个第三方集成

**社区与内容**
- 2026 Q4：GitHub Issue 模板（Bug/Feature/Translation）+ Discord 官方群
- 2028 Q2：英语/日语/中文三语 UI（覆盖 ≥ 90% 字符串）+ Lokalise 集成

### 远期愿景（5 年+）

> 以下为探索方向，取决于社区反馈和资源投入。

| 方向 | 关键依赖 | 里程碑验证 |
|------|---------|-----------|
| AI 动作迁移 | Stable Diffusion Motion / LLM API 成熟度 | 原型 Demo（非生产级），社区投票 ≥ 50 票 |
| 实时协作 | WebRTC + CRDT 库（如 Yjs）调研 | 2 人同时编辑同一场景的 Demo，原型可用 |
| AR 预览 | ARKit/ARCore API + 设备覆盖率 | iOS/Android 各 1 个 AR 场景 Demo，上传 TestFlight |

### ⚠️ 风险与约束

### ⚠️ 风险与约束

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| Wails mobile 多平台支持不及预期 | 中 | 高 | 提前与 Wails 社区确认 Roadmap；备选 Tauri mobile |
| 插件系统安全沙箱未达预期 | 中 | 中 | v1 仅支持白名单 API，逐步开放 |
| Blender 官方适配资源不可用 | 高 | 低 | 改为社区驱动插件，降低优先级 |
| iOS 审核被拒（WebView 渲染性能） | 中 | 中 | 预置 App Store 截图 + 技术说明文档 |
