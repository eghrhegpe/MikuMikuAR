# 下一阶段开发计划

> **基于项目现状：Phase 1-5 全部完成，Phase 6-7 核心功能已实现**

**目标：** 确定当前阶段已实现与待开发的功能矩阵，按性价比排序推进剩余深度功能

**架构：** 所有新功能均在现有模块上增量扩展，不引入新依赖。材质编辑器扩展 [scene.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene.ts) 材质模块和 [scene-menu.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene-menu.ts) UI；VPD 姿势扩展 [scene.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene.ts) 加载链路；模型预设扩展 [scene.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene.ts) + Go 端配置系统。

**Tech Stack:** Wails v2 (Go) + Babylon.js + babylon-mmd

---

## 当前完成状态

### 已在本次会话完成

| 功能 | 文件 | 实现要点 |
|------|------|---------|
| 线框显示开关 | [scene-menu.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene-menu.ts) | 复用 `setModelWireframe`，场景菜单→模型→每个卡片添加 checkbox |
| 材质参数调节（按部位） | [scene.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene.ts) + [scene-menu.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene-menu.ts) | 关键词自动分类皮肤/头发/眼睛/服装；每类独立 Diffuse/Specular/Shininess/Ambient 滑块 |
| 播放列表 | [app.go](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/app.go) + [library.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/library.ts) + [scene-menu.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene-menu.ts) | Go `Playlists` 持久化；创建/删除/添加模型/开始播放/上一下一导航 |
| 导出到 MMD 软件 | [app.go](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/app.go) + [library.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/library.ts) | `OpenInMMD`/`OpenInBlender` 已实现，绑定到模型详情菜单 |
| 重力控制 | [scene.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene.ts) + [scene-menu.ts](file:///C:/Users/zhujieling11/MikuMikuAR/MikuMikuAR/frontend/src/scene-menu.ts) | `mmdRuntime.physics.setGravity()` 封装，场景菜单「物理」文件夹，滑块 0~2 倍 |

### 阶段路线图刷新

更新后（本次会话后）：

```
Phase 1-5   ✅ 全部完成
Phase 6     材质与渲染增强            ← ✅ 全部完成
              ├── 材质参数调节(按部位) ✅
              ├── 线框/骨骼显示切换    ✅
              └── 重力控制             ✅

Phase 7     播放列表与预设            ← ✅ 部分完成
              ├── 播放列表             ✅
              ├── 模型加载预设         ❌ 待实现
              └── 软件管理             ❌ 待实现

Phase 8     动作与环境增强            ← 🔜 下一阶段重点
              ├── 单独材质编辑器       🔜 高优先级
              ├── VPD 姿势导入         🔜 中优先级
              ├── 程序化动作           ❌ 远期
              ├── 换装系统/纹理增强    ❌ 远期
              ├── LipSync/音乐节拍检测  ❌ 远期
              └── 天空/水体/道具/特效   ❌ 远期

Phase 9     扩展物理与平台
              ├── 布料模拟/软体物理    ❌ 远期
              └── 多相机模式           ❌ 远期

Phase 10    Android 适配              ❌ 远期
```

---

## 待实现功能评估矩阵

### P1 — 单独材质编辑器

| 维度 | 评分 |
|------|------|
| 用户价值 | ⭐⭐⭐⭐ |
| 实现成本 | 中型（3-5 天） |
| 技术风险 | 低 |

**理由**：按部位调节已实现，逐材质编辑是自然延伸。用户调参后想单独调某个材质（如「只亮裙子、不亮皮肤」）时，按部位粒度不够。babylon-mmd 材质 API 已经暴露，工作量在 UI 上。

**实现方式**：
- 类别子菜单中展开所有材质，点击材质名进入逐材质编辑页
- 每个材质独立调 Diffuse/Specular/Shininess/Ambient + 描边控制
- 已修改的材质标记高亮
- 重置按「重置单个材质」vs「重置全部」

---

### P2 — VPD 姿势导入

| 维度 | 评分 |
|------|------|
| 用户价值 | ⭐⭐⭐ |
| 实现成本 | 小型（1-2 天） |
| 技术风险 | 中（需要验证 babylon-mmd 对 VPD 的支持） |

**理由**：适合截图场景，用户加载模型后快速摆姿势。配合批量截图功能。VPD 是文本格式（类似 VMD 但只有一帧），如果 babylon-mmd 不支持，可以自己解析 VPD → 生成 VMD 单帧动画。

**实现方式**：
- 从 VPD 文件加载单帧姿势
- 加载到模型上（替换 VMD 或独立模式）
- 支持清除姿势
- UI 入口：模型详情 → 姿势绑定

---

### P2 — 模型加载预设

| 维度 | 评分 |
|------|------|
| 用户价值 | ⭐⭐⭐ |
| 实现成本 | 小型（2-3 天） |
| 技术风险 | 低 |

**理由**：场景保存/加载已实现。模型预设是轻量版——只存单模型的变换+材质参数+VMD+音频状态，不存相机/灯光。适合「角色卡」场景。

**实现方式**：
- 数据结构复用场景的 ModelState
- 新增 `SaveModelPreset`/`LoadModelPreset` Go binding
- UI 入口：模型详情 → 保存预设 / 加载预设
- 预设文件存 `.mcupreset.json` 后缀

---

### P3 — 软件管理

| 维度 | 评分 |
|------|------|
| 用户价值 | ⭐⭐ |
| 实现成本 | 小型（1 天） |
| 技术风险 | 低 |

**理由**：扫描 `software/` 目录自动识别 exe，在菜单栏显示启动入口。当前 MMD/Blender 路径配置已实现，软件管理只是补齐自动扫描能力。

---

### 规划优先级汇总

| 优先级 | 功能 | 预估 | 技术风险 |
|--------|------|------|---------|
| **P1** | 单独材质编辑器 | 中型（3-5 天） | 低 |
| **P2** | VPD 姿势导入 | 小型（1-2 天） | 中 |
| **P2** | 模型加载预设 | 小型（2-3 天） | 低 |
| **P3** | 软件管理 | 小型（1 天） | 低 |
| **P3** | 程序化动作（Auto Dance） | 大型（1-2 周） | 高 |
| **P4** | 换装系统/纹理增强 | 大型 | 高 |
| **P4** | LipSync/音乐节拍检测 | 中型 | 中 |
| **P4** | 天空/水体/道具/特效 | 大型 | 中 |
| **P4** | 布料模拟/软体物理 | 大型 | 高 |
| **P4** | 多相机模式 | 中型 | 低 |

---

## 推荐执行顺序

```
第 1 步：单独材质编辑器（P1, 3-5 天）
  └─ 扩展按部位材质 UI，每个材质可独立编辑
  └─ 修改标记 + 重置控制

第 2 步：VPD 姿势导入（P2, 1-2 天）
  └─ 验证 babylon-mmd 支持，或自解析 VPD → VMD
  └─ 模型详情 → 姿势绑定

第 3 步：模型加载预设（P2, 2-3 天）
  └─ Go 端持久化 + 前端 UI
  └─ 复现场景序列化的 ModelState

第 4 步：软件管理（P3, 1 天）
  └─ 扫描 software/ 目录
  └─ 菜单栏自动识别 exe 入口
```

---

## 文档更新检查清单

- [ ] Phase 6 全部标记完成（status.md）
- [ ] Phase 7 标记部分完成（status.md）
- [ ] 架构文档补充材质编辑细节（architecture.md）
- [ ] 可复用组件文档补充材质调节/播放列表/重力函数（reusables.md）
