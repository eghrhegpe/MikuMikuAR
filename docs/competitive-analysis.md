# MMD 生态竞品分析报告

> 2026-07-05 创建；2026-07-10 代码核实修订。
> 基于 20+ GitHub 项目调研。
> 覆盖渲染器、查看器、编辑器、引擎集成、工具链五大类。
> 本文件为只读参考。

---

## 一、竞品全景

| 项目 | Stars | 技术栈 | 定位 | 独特优势 |
|------|-------|--------|------|---------|
| **DanceXR** | 91 | C++ | 成品播放器 | 动作组合/角色在场/离线渲染/VR |
| **Saba** | 504 | C++ | 轻量查看器 | Lua 脚本/多后端/宏命令 |
| **Coocoo3D** | 120 | C#+DX12 | 渲染器 | 光线追踪/GI/SSAO/Decal |
| **flowerMiku** | 330 | C+Vulkan | 渲染器 | PBR 材质/Vulkan 高性能 |
| **mmd-viewer-js** | 178 | JS+WebGL | Web 查看器 | 零依赖/Toon/视频录制 |
| **babylon-mmd-viewer** | — | TS+Babylon.js | Web 查看器 | BPMX/BVMD 二进制格式 |
| **HBR MMD Tools** | 33 | Python | Blender 插件 | 共振峰口型/高斯眨眼/智能材质 |
| **MMD Bridge** | 150 | C++/Python | DCC 桥接 | Alembic 导出/Python 脚本 |
| **SampleWebMMD** | 4 | JS+Three.js | Web 示例 | Pose Studio/URL 场景分享 |
| **Phoshco model-viewer** | 65 | TS+Babylon.js | Web 查看器 | URL 路由/角色目录 |
| **MMD6UnityTool** | 84 | C# | Unity 工具 | VMD→Timeline/相机导出 |
| **IM4U** | 73 | C++ | UE 插件 | PMX→UE 骨骼映射 |
| **MMDViewer iOS** | 15 | Swift+Metal | iOS 查看器 | Metal 渲染实验 |

---

## 二、功能对标矩阵

### 渲染与视觉

| 功能 | MikuMikuAR | DanceXR | Saba | Coocoo3D | flowerMiku | mmd-viewer-js |
|------|-----------|---------|------|----------|------------|---------------|
| PMX 加载 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| VMD 播放 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WASM Bullet 物理 | ✅ | ✅ | ✅ Bullet | ✅ Bullet | ✅ | ✅ Ammo.js |
| ~~XPBD 布料~~ | ⚠️ 已移除（ADR-081） | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bloom/DOF/色调映射 | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ 基础 |
| PBR 材质 | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Toon 着色 | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 光线追踪/GI | ❌ | ❌ | ❌ | ✅ DXR | ❌ | ❌ |
| SSAO | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 边缘渲染 | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Decal 贴花 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 天空/水面/粒子 | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### 动作与动画

| 功能 | MikuMikuAR | DanceXR | Saba | HBR MMD Tools | mmd-viewer-js |
|------|-----------|---------|------|---------------|---------------|
| VMD 播放/暂停/seek | ✅ | ✅ | ✅ | ❌ | ✅ |
| 相机 VMD | ✅ | ✅ | ✅ | ❌ | ❌ |
| 程序化动作 | ✅ Idle/Dance | ✅ | ❌ | ❌ | ❌ |
| 猫步走秀 (Catwalk) | ❌ | ✅ 臀部摆动/刻意迈步/沿Z轴行走/BPM同步 | ❌ | ❌ | ❌ |
| Motion Layers（双 VMD） | ✅ | ✅ | ❌ | ❌ | ❌ |
| Motion Override（逐骨骼） | ✅ | ✅ | ❌ | ❌ | ❌ |
| Remix（跨套装音频） | ❌ | ✅ | ❌ | ❌ | ❌ |
| T-pose/A-pose 转换 | ✅ | ✅ | ❌ | ❌ | ❌ |
| BVH 动作导入 | ❌ | ✅ | ❌ | ❌ | ❌ |
| VPD 姿势 | ✅ | ✅ | ✅ | ❌ | ❌ |
| LipSync | ✅ 振幅 | ✅ | ❌ | ✅ 共振峰 | ❌ |
| 自动眨眼 | ✅ 伪随机 | ✅ | ❌ | ✅ 高斯 | ❌ |
| 自动呼吸 | ✅ | ✅ | ❌ | ❌ | ❌ |
| Eye Contact | ✅ | ✅ | ❌ | ❌ | ❌ |
| 节拍检测 | ✅ | ✅ | ❌ | ❌ | ❌ |

### 角色呈现

| 功能 | MikuMikuAR | DanceXR |
|------|-----------|---------|
| 多模型同场 | ✅ 核心优势 | ✅ |
| 模型库管理 | ✅ 核心优势 | ✅ 基础 |
| 标签系统 | ✅ | ✅ |
| 换装/纹理变体 | ✅ | ✅ |
| 队形预设 | ✅ 6 种 | ✅ V/A/圆弧 |
| 视线追踪 | ✅ | ✅ |
| 脚部地面跟随 | ❌ | ✅ |
| 布娃娃物理 | ✅ | ✅ |
| 软体物理 | ❌ | ✅ |
| 道具挂载 | ✅ | ✅ |

### 系统与工具

| 功能 | MikuMikuAR | DanceXR | Saba | MMD Bridge |
|------|-----------|---------|------|------------|
| 场景保存/加载 | ✅ .mmascene | ✅ | ❌ | ❌ |
| 场景打包（资源捆绑） | ✅ | ✅ | ❌ | ❌ |
| 模型预设 | ✅ | ✅ | ❌ | ❌ |
| Lua/JS 脚本 | ❌ | ❌ | ✅ | ✅ Python |
| 离线渲染/录制 | ❌ | ✅ Creator | ❌ | ❌ |
| Alembic/glTF 导出 | ❌ | ❌ | ❌ | ✅ Alembic |
| URL 场景分享 | ❌ | ❌ | ❌ | ❌ |
| 软件管理（MMD/Blender） | ✅ | ❌ | ❌ | ❌ |
| Android 适配 | ✅ | ❌ | ❌ | ❌ |

---

## 三、MikuMikuAR 独特优势

以下是 MikuMikuAR **独有**或**明显领先**的能力，竞品均未实现：

| 优势 | 说明 | 竞品差距 |
|------|------|---------|
| **聚合管理器** | 扫描 + zip 容器 + 标签 + 搜索 + 多库挂载 | DanceXR 管理能力弱，其他工具无 |
| **多模型同场** | 多个 PMX 同时加载 + 自动排列 + 焦点切换 | 大多数查看器仅单模型 |
| **环境系统** | 天空/水面/云/粒子/风/道具 | 仅 DanceXR 有基础环境 |
| **程序化动作** | Idle + Auto Dance + 节拍驱动 | DanceXR 有但不公开算法 |
| **模型预设** | 角色设置快照 + 跨模型复用 | 竞品无 |
| **软件管理** | MMD/Blender 路径检测 + 自定义软件 | 竞品无 |
| **Android 适配** | Wails mobile + 触摸交互 | 竞品均无移动端 |

---

## 四、关键差距（按影响力排序）

### 第一梯队：用户价值最高（仅列未闭合项）

| 差距 | 来源 | 影响 |
|------|------|------|
| ~~Motion Layers（双 VMD 叠加）~~ | — | ✅ 已闭合（ADR-051） |
| ~~T-pose/A-pose 自动转换~~ | — | ✅ 已闭合（ADR-061） |
| ~~Eye Contact（视线追踪）~~ | — | ✅ 已闭合（ADR-053） |
| ~~Formation System（队形预设）~~ | — | ✅ 已闭合（ADR-037） |
| ~~Pose Studio / 拍照模式~~ | — | ✅ 已闭合（ADR-061） |
| Remix（跨套装音频） | DanceXR | VMD 资产复用 |
| BVH 动作导入 | DanceXR | 格式兼容 |

### 第二梯队：体验补齐（仅列未闭合项）

| 差距 | 来源 | 影响 |
|------|------|------|
| ~~Auto Camera（程序化运镜）~~ | — | ✅ 已闭合（ADR-037） |
| ~~Scene Bundle（场景打包）~~ | — | ✅ 已闭合（ADR-037） |
| ~~高斯随机眨眼~~ | — | ✅ 已闭合（ADR-037） |
| ~~智能材质分类~~ | — | ✅ 已闭合（`model-manager.ts` 物理分类） |
| Remix（跨套装音频交换） | DanceXR | VMD 资产复用 |

### 第三梯队：远期探索

| 差距 | 来源 | 影响 |
|------|------|------|
| Ray Tracing / GI | Coocoo3D | 高端渲染（WebGPU 可期） |
| Lua/JS 脚本层 | Saba | 自动化工作流 |
| Alembic/glTF 导出 | MMD Bridge | DCC 工具互操作 |
| ~~Toon Shading~~ | — | ✅ 已闭合（`outfit.ts` + 预设） |
| ~~Ragdoll~~ | — | ✅ 已闭合（ADR-061） |
| Soft Body（软体物理） | DanceXR | XPBD VolumeConstraint 已预置，完整功能待实现 |

### 差距闭合进度（2026-07-10 代码核实）

以下差距已在代码事实层面闭合（以 `frontend/src` 实现为准，非仅 ADR 声明）：

| 原差距 | 原梯队 | 状态 | 依据 |
|--------|--------|------|------|
| Motion Layers（双 VMD 叠加） | 第一 | ✅ 已闭合 | ADR-051/056：`vmd-layers.ts` + C+B 混合方案（WASM 已支持多图层） |
| Eye Contact（视线追踪） | 第一 | ✅ 已闭合 | ADR-016/053：`proc-motion-bridge.ts` + gaze 图层 |
| Formation（队形预设） | 第一 | ✅ 已闭合 | ADR-037 §6：`model-manager.ts` 6 种预设 + 场景菜单 |
| T-pose/A-pose 转换 | 第一 | ✅ 已闭合 | ADR-061：`pose-preset.ts` tpose/apose VPD 生成器 |
| Pose Studio / 拍照模式 | 第一 | ✅ 已闭合 | ADR-061：`motion-pose-levels.ts` 构图辅助 + 批量截图 + 水印 |
| Motion Override（逐骨骼） | — | ✅ 已闭合 | ADR-061：`bone-override.ts` 引擎 + UI + 序列化 |
| 布娃娃物理 Ragdoll | 角色 | ✅ 已闭合 | ADR-061：`xpbd-ragdoll.ts` + `ragdoll-manager.ts` |
| 道具挂载 Accessory | 角色 | ✅ 已闭合 | `accessory.ts` 骨骼锚定 + `scene-prop-levels.ts` UI |
| 自动眨眼 | 第二 | ✅ 已闭合 | ADR-037 §5 Lifelike：`procedural-motion.ts` 伪随机 2~8s |
| 自动呼吸 | 第二 | ✅ 已闭合 | ADR-037 §5 / Idle：`procedural-motion.ts` |
| Auto Camera（程序化运镜） | 第二 | ✅ 已闭合 | ADR-037 §7：`beat-detector.ts` onBeat + `camera.ts` 8 预设 |
| Scene Bundle（场景打包） | 第二 | ✅ 已闭合 | ADR-037 §8：`scene-bundle.ts` + Go `BundleScene` |
| 高斯随机眨眼 | 第二 | ✅ 已闭合 | ADR-037 §5 Lifelike |
| 智能材质分类 | 第二 | ✅ 已闭合 | `model-manager.ts` 物理分类 regex 匹配 |
| Toon 着色 | 第三 | ✅ 已闭合 | `outfit.ts` toonTexture + `scene-render-presets.ts` cartoon 预设 |
| SSAO | 渲染 | ✅ 已闭合 | `renderer.ts` `SSAO2RenderingPipeline` |
| 边缘渲染 | 渲染 | ✅ 已闭合 | `renderer.ts` outlineEnabled + 渲染设置 UI |

> 备注：PBR 材质、SSS、光线追踪/GI 仍受 `babylon-mmd` 上游阻塞，保持 ❌。脚部地面跟随仅有 Foot IK 步态（`proc-motion-autodance.ts`），非完整地面约束。

---

## 五、技术路线对比

| 维度 | MikuMikuAR | DanceXR | Saba | Coocoo3D |
|------|-----------|---------|------|----------|
| 语言 | TypeScript + Go | C++ | C++ | C# |
| 渲染 | Babylon.js (WebGL) | 自研 OpenGL | OpenGL/DX11/Vulkan | DX12/DXR |
| 物理 | WASM Bullet（XPBD 已移除，ADR-081） | Bullet | Bullet | Bullet |
| 平台 | Win/Mac/Linux/Android | Win | Win | Win |
| 扩展性 | Wails IPC + 前端模块 | 插件系统 | Lua 脚本 | 自定义 HLSL |
| 格式 | PMX/VMD/VPD/zip | PMX/XPS/BVH | PMX/PMD/OBJ | PMX/glTF |

**MikuMikuAR 的技术优势：**
- Web 技术栈 → 跨平台成本最低（Android 已适配）
- TypeScript → 前端生态丰富，AI 辅助开发效率高
- Wails → 轻量原生壳，比 Electron 省 50%+ 内存

**MikuMikuAR 的技术劣势：**
- WebGL → 无光线追踪/Compute Shader（WebGPU 可期但未普及）
- Babylon.js → 渲染定制深度不如原生 HLSL/GLSL
- TS → 性能敏感场景（大量物理粒子）不如 C++

---

## 六、差异化策略建议

基于竞品分析，MikuMikuAR 应聚焦三条护城河：

### 1. 聚合管理器（无人能及）
- 模型库扫描 + zip 容器 + 标签 + 搜索 + 多库挂载
- 软件管理（MMD/Blender 路径检测）
- 场景打包（资源捆绑分发）
- **目标**：成为 MMD 内容管理的事实标准

### 2. 多模型导演工具（DanceXR 弱项）
- 多模型同场 + 队形预设 + Auto Camera + Formation
- **目标**：从查看器升级为"MMD 导演台"

### 3. 跨平台（独特优势）
- Win/Mac/Linux/Android 四端覆盖
- **目标**：唯一跨平台的 MMD 聚合管理器

---

## 七、数据来源

| 来源 | 类型 | 覆盖 |
|------|------|------|
| `docs/research/dancexr-zh/` | 文档镜像（~200 文件） | DanceXR 全功能 |
| `docs/research/mmd-tools-analysis.md` | 竞品分析 | Blender mmd_tools（材质/骨骼/VMD） |
| `docs/research/pmx-ecosystem.md` | 技术调研 | PMX 全平台加载方案 |
| `docs/research/tech-stack-comparison.md` | 技术选型 | Electron/Tauri/Wails + 渲染引擎 |
| `docs/research/blender-integration.md` | 集成方案 | Blender PMX 导入导出 |
| `docs/research/dancexr-structure.md` | 结构分析 | DanceXR 文件组织 |
| `docs/research/dancexr-directory.md` | 目录映射 | DanceXR 目录结构 |
| GitHub 20+ 项目 | Web 调研 | Saba/Coocoo3D/flowerMiku/mmd-viewer-js/HBR MMD Tools/MMD Bridge/SampleWebMMD 等 |
