# MikuMikuAR 路线图

> 本文件为**规划文档**：已完成里程碑 + DanceXR 对标 + 差距清单 + 下一步规划。
> 当前状态快照（快捷键/环境依赖/构建命令/已知限制）见 [`status.md`](status.md)。
> 最后更新：2026-07-05

---

## 核心价值定位

与其他方案的区别：

| 对比 | DanceXR | babylon-mmd demo | MMD Viewer (纯Web) | MikuMikuAR |
|------|---------|------------------|-------------------|--------|
| 定位 | 成品播放器 | 技术演示 | **渲染调参标杆** | **聚合管理器 + 播放器** |
| 桌面集成 | 原生 | 纯网页 | 纯浏览器 | **Wails 轻量原生** |
| 库管理 | 文件系统 | 无 | 无 | **✅ 完整库管理** |
| 多模型同场 | ✅ | ❌ | ❌ | **✅ 核心优势** |
| 渲染调参 | ❌ | ❌ | **✅ 极丰富** | **✅ Bloom/SSR/SSAO/色调映射** |
| 物理 | ✅ WASM Bullet | ammo.js | ammo.js | **✅ WASM Bullet + XPBD 布料** |
| 环境系统 | 基础 | 无 | 基础 | **✅ 天空/水面/云/粒子/风** |
| 换装 | ❌ | ❌ | ❌ | **✅ 纹理变体自动发现** |
| 聚合生态 | 封闭 | 无 | 无 | **DanceXR+Blender+模之屋** |

MikuMikuAR 的独特价值在于**聚合生态**：让 DanceXR、Blender、模之屋的用户共享同一个模型库。

---

## 已完成里程碑

| Phase | 功能 | 状态 |
|-------|------|------|
| 1 | 标签系统 | ✅ |
| 2 | 渲染调参（Bloom/色调映射/曝光/FOV/预设） | ✅ |
| 3 | 音乐同步 + 相机 VMD + 舞蹈套装 | ✅ |
| 4 | 下载目录监听 + 自动导入 | ✅ |
| 5 | 体验完善（统计/截图/播放记录/表情预览） | ✅ |
| 6 | 材质与渲染增强（材质调节/线框/重力） | ✅ |
| 7 | 播放列表 + 模型加载预设 + 软件管理 | ✅ |
| 8 | 程序化动作 + 音乐节拍检测 + 换装 + LipSync | ✅ |
| 9 | XPBD 布料 + 粒子系统 + 多相机模式 | ✅ |
| 10 | Android 适配 + Wails v3 迁移 + 触屏优化 | ✅ |
| — | 环境系统增强（纹理地面/粒子溅射/水下后处理） | ✅ |

---

## DanceXR 功能对标进度

基于 `docs/research/dancexr-zh/` 37 份文档的映射：

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

---

## 下一步规划

核心管线 Phase 1-10 + 环境增强全部就绪，进入**新功能拓展**阶段。

### 近期（可执行）

| 优先级 | 功能 | 来源 | 工作量 |
|--------|------|------|--------|
| P2 | **Motion Layers（双 VMD 叠加）** | DanceXR A1 | loadVMDMotion 扩展 |
| P2 | **Lifelike Motions（微动作叠加层）** | DanceXR A2 | 程序化动作扩展 |
| P2 | **Formation System（队形预设）** | DanceXR C1 | arrangeModels 扩展 |
| P2 | **Auto Camera（程序化运镜）** | DanceXR C2 | 相机系统 + 节拍驱动 |
| P2 | **Scene Bundle（场景打包）** | DanceXR C5 | scene-serialize + Go IO |

> T-pose/A-pose 转换、Pose Studio 等见下方 G/J 区详细列表。

### 中期（需调研）

| 功能 | 来源 | 依赖 |
|------|------|------|
| Eye Contact System（视线系统） | DanceXR B1 | 眼球骨骼 IK + morph |
| Playback Modes（播放模式） | DanceXR A3 | vmd-loader 扩展 |
| Scene Relative Paths（相对路径） | DanceXR F4 | scene-serialize 改造 |
| Concert Camera 增强 | DanceXR C3 | camera.ts 扩展 |

> BVH 导入、高斯眨眼、智能材质分类、Alembic/glTF 导出等见下方 G/J 区详细列表。

### 远期（探索方向）

| 方向 | 关键依赖 |
|------|---------|
| Toon Shading（卡通渲染） | Babylon.js NME / shader |
| Soft Body Physics（软体物理） | XPBD 求解器扩展 |
| Mesh-to-Cloth（任意网格→布料） | XPBD 扩展 |
| Recording / Offline Rendering | Babylon.js 截图扩展 |

### 其他 MMD GitHub 项目增量目标

> 2026-07-05 从 20+ GitHub 项目（Saba/Coocoo3D/flowerMiku/mmd-viewer-js/HBR MMD Tools/MMD Bridge/SampleWebMMD 等）挖掘。

#### G. 骨骼与动画增强

| # | 功能 | 优先级 | 来源 | 说明 |
|---|------|--------|------|------|
| G1 | **T-pose/A-pose 自动转换** | P2 | DanceXR | 自动适配不同模型的骨骼朝向，实现"任意动作×任意模型"无手动调整 |
| G2 | **BVH 动作导入** | P3 | DanceXR | 支持动作捕捉格式（.bvh），扩展 VMD 以外的动作来源 |
| G3 | **高斯随机眨眼** | P3 | HBR MMD Tools | 高斯分布随机眨眼 + 半眨 + 双眨，比固定间隔更自然 |
| G4 | **共振峰口型分析** | P3 | HBR MMD Tools | 基于共振峰/能量分析的日语音素口型生成（あいうえおん），比纯振幅 LipSync 更精准 |

#### H. 渲染与视觉增强

| # | 功能 | 优先级 | 来源 | 说明 |
|---|------|--------|------|------|
| H1 | **Ray Tracing / GI** | 远期 | Coocoo3D | DXR 实时光线追踪 + 全局光照，Babylon.js 可通过 WebGPU 实验性支持 |
| H2 | **Decal 系统** | P3 | Coocoo3D | 模型表面贴花覆盖（纹理叠加层），可用于自定义涂装 |
| H3 | **智能材质分类** | P3 | HBR MMD Tools | 自动检测皮肤/头发/金属/眼睛/布料材质类型，比手动分类更高效 |

#### I. 导出与互通

| # | 功能 | 优先级 | 来源 | 说明 |
|---|------|--------|------|------|
| I1 | **Alembic/glTF 导出** | P3 | MMD Bridge | 场景导出为 DCC 工具通用格式（Blender/Maya/UE），扩展生态互操作 |
| I2 | **URL 参数化场景分享** | P3 | Phoshco model-viewer | 通过 URL 参数组合模型+动作+环境，一键分享场景配置 |
| I3 | **轻量视频录制** | P3 | mmd-viewer-js | Whammy.js 方案：浏览器端实时录制为 WebM，无需离线渲染 |

#### J. 工作流增强

| # | 功能 | 优先级 | 来源 | 说明 |
|---|------|--------|------|------|
| J1 | **Pose Studio / 拍照模式** | P2 | SampleWebMMD | 专用拍照界面：相机预设 + 姿势保存 + 分辨率选择 + 一键导出 |
| J2 | **Lua/JS 脚本层** | 远期 | Saba | 宏命令 + 批量操作 + 自动化工作流（加载模型→应用动作→设置相机→截图） |
| J3 | **VR 180 视频** | 远期 | DanceXR Creator | 立体 180° 视频输出，需 WebXR 支持 |

### 不适配 / 不搬运

| DanceXR / 其他工具功能 | 原因 |
|------------------------|------|
| AI Chat / Operator | 产品方向不同 |
| Discovery App（DeviantArt 集成） | 第三方 API 依赖过重 |
| Bone Mapper（XPS/FBI 骨骼映射） | 专注 PMX 格式 |
| Body Paint（身体彩绘 shader） | 开发成本高，需求不明确 |
| Vulkan 渲染后端 | Babylon.js 已锁定 WebGL/WebGPU |
| Rust PMX Editor | 与现有 TS 技术栈不兼容 |

---

## ADR 状态速查

| 状态 | 数量 | 编号 |
|------|------|------|
| 已完成/已实现 | 25 | 001-002, 004-006, 008-009, 011-022, 025-031 |
| 部分完成 | 3 | 003（远期构想）, 023（SAF）, 024（SSS） |
| 参考文档 | 2 | 007, 010 |

> 详情见 `docs/adr/` 目录各文件头部状态标记。
