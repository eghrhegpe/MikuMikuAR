# Phase 5-7: 体验完善 + 材质渲染增强 + 播放列表

**Commit**: `fe70538` — feat(material): per-material editor via TDD
**日期**: 2026-06-26
**分支**: main

---

## 总览

本阶段完成了 DanceXR 对标进度从 67% → 81%（36 项中覆盖 29 项），新增了 Phase 5（体验完善）、Phase 6（材质与渲染增强）、Phase 7（播放列表）三个里程碑。总计修改 21 个文件，+3697 / -1797。

---

## Phase 5: 体验完善 (已完成)

| 功能 | 修改 | 说明 |
|------|------|------|
| 模型统计信息 | [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) | 模型加载时统计顶点/面/骨骼数，显示在详情面板 |
| 批量截图 | [app.go](file:///C:/Users/zhujieling11/app.go) + [settings.ts](file:///C:/Users/zhujieling11/frontend/src/settings.ts) | Go 端截屏写入文件，前端「截图」菜单支持批量按模型截图到指定目录 |
| 最近打开 | [library.ts](file:///C:/Users/zhujieling11/frontend/src/library.ts) + [config.ts](file:///C:/Users/zhujieling11/frontend/src/config.ts) | 记录最近 20 个打开模型，根菜单「最近打开」子菜单；空 ref 守卫 + 本地同步避免 UI 不刷新 |
| 收藏 | [app.go](file:///C:/Users/zhujieling11/app.go) | 收藏合并到标签系统，自动迁移旧收藏 |
| 表情预览 | [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) | 模型详情面板显示面部 morph 滑块，即时触发变形 |
| 标签管理 | [library.ts](file:///C:/Users/zhujieling11/frontend/src/library.ts) | 标签增/删/查完整，按标签过滤模型列表 |
| 音频偏移 | [audio.ts](file:///C:/Users/zhujieling11/frontend/src/audio.ts) + [scene-menu.ts](file:///C:/Users/zhujieling11/frontend/src/scene-menu.ts) | 音频同步偏移滑块 (±5000ms) |

---

## Phase 6: 材质与渲染增强 (已完成)

### 6a. 类别级材质调参

由 `_catOf` 分类函数将材质自动归类为 皮肤/头发/眼睛/服装，每个类别设 4 个滑块：漫反射倍率、高光倍率、高光指数、环境光倍率。

| 文件 | 修改 |
|------|------|
| [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) | `_catState` + `setMatCatParams`/`getMatCatParams`/`resetMatCatParams` |
| [scene-menu.ts](file:///C:/Users/zhujieling11/frontend/src/scene-menu.ts) | 材质面板 UI，按类别分组 + 滑块 |

分类关键词覆盖中/英/日（skin/顔/肌/face/eye/目/iris/hair/髪 等）。

### 6b. 单独材质编辑器 (TDD)

**TDD 流程**: 34 → 39 个测试覆盖全部逻辑。

| 层 | 测试数 | 覆盖内容 |
|----|--------|----------|
| `_catOf` 分类 | 10 | 中/英/日关键词 + 大小写不敏感 |
| 状态管理 | 14 | `_matState` set/get/partial/clamp/modified 追踪/3 级重置 |
| 叠加顺序 (regression) | 5 | category → per-material 叠加后 re-apply 不丢失覆盖 |
| Babylon property spy | 5 | 4 滑块 → `diffuseColor.set`/`specularColor.set`/`specularPower`/`ambientColor.set` 正确写入 |
| 幂等性 | 1 | 同参数两次写入结果一致 |

**实现**:
- [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) — `_matState` 覆盖层 + `_applyAll` "category → per-material" 双阶段应用
- [scene-menu.ts](file:///C:/Users/zhujieling11/frontend/src/scene-menu.ts) — 类别卡片内嵌入材质行（已修改高亮），点击进入逐材质编辑页

**安全**: `setMatParams`/`resetSingleMatParams` 加 `matIndex` 越界 guard（`console.warn` + return）。

### 6c. 线框切换

| 文件 | 修改 |
|------|------|
| [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) | `setModelWireframe` → `syncModelVisibility` 中写入 `material.wireframe` |
| [scene-menu.ts](file:///C:/Users/zhujieling11/frontend/src/scene-menu.ts) | 模型卡片「线框」toggle |

### 6d. 重力控制

| 文件 | 修改 |
|------|------|
| [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) | `setGravityStrength`/`getGravityStrength` → `mmdRuntime.physics.setGravity()` |
| [scene-menu.ts](file:///C:/Users/zhujieling11/frontend/src/scene-menu.ts) | 场景菜单「物理」重力滑块 (0-2x) |

### 6e. 骨骼显示

| 文件 | 修改 |
|------|------|
| [config.ts](file:///C:/Users/zhujieling11/frontend/src/config.ts) | `ModelInstance.showBones` |
| [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) | `setModelBoneVis` + `createBoneOverlay`/`destroyBoneOverlay` |
| [scene-menu.ts](file:///C:/Users/zhujieling11/frontend/src/scene-menu.ts) | 模型卡片「骨骼显示」toggle |

**渲染**: `CreateLineSystem` 绘制父子骨骼线段，按 `transformOrder` 取色相着色。
**物理分组**: 有物理绑定的骨骼标记为亮绿色（`bone.rigidBodyIndices.length > 0`），无物理骨骼按深度着色。
**实时更新**: `onBeforeRenderObservable` 每帧刷新骨骼世界坐标。

### 6f. 物理开关

| 文件 | 修改 |
|------|------|
| [config.ts](file:///C:/Users/zhujieling11/frontend/src/config.ts) | `ModelInstance.physicsEnabled` |
| [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) | `setModelPhysics` + `_initialRigidBodyStates` 快照 |
| [scene-menu.ts](file:///C:/Users/zhujieling11/frontend/src/scene-menu.ts) | 模型卡片「物理」toggle |

**机制**: `rigidBodyStates.fill(0/1)` + 模型加载时 `new Uint8Array(states)` 快照初始状态。

---

## Phase 7: 播放列表 (已完成)

### Go 后端

| 文件 | 修改 |
|------|------|
| [app.go](file:///C:/Users/zhujieling11/app.go) | `GetPlaylists`/`SavePlaylist`/`DeletePlaylist` + `Playlist` 类型 + `RemoveModelFromPlaylist` |

`Playlists map[string][]string` 持久化在 config.json，支持创建/删除/命名/增删模型。

### 前端

| 文件 | 修改 |
|------|------|
| [library.ts](file:///C:/Users/zhujieling11/frontend/src/library.ts) | 播放列表弹窗 UI + 导航（prev/next）+ 播放列表详情 |
| [scene-menu.ts](file:///C:/Users/zhujieling11/frontend/src/scene-menu.ts) | 场景菜单集成播表控制 |
| [scene.ts](file:///C:/Users/zhujieling11/frontend/src/scene.ts) | `prevPlaylistItem`/`nextPlaylistItem` 导入 |
| [config.ts](file:///C:/Users/zhujieling11/frontend/src/config.ts) | 播放列表配置项 |

---

## 测试体系

首次引入 vitest 测试框架：

| 文件 | 说明 |
|------|------|
| [vitest.config.ts](file:///C:/Users/zhujieling11/frontend/vitest.config.ts) | vitest + happy-dom 配置 |
| [material-editor.test.ts](file:///C:/Users/zhujieling11/frontend/src/__tests__/material-editor.test.ts) | 39 个测试，覆盖分类/状态/叠加顺序/Babylon property |

---

## 文档更新

| 文件 | 修改 |
|------|------|
| [status.md](file:///C:/Users/zhujieling11/MikuMikuAR/docs/status.md) | 路线图 + 里程碑 + DanceXR 对标 67%→81% |
| [requirements.md](file:///C:/Users/zhujieling11/MikuMikuAR/docs/requirements.md) | 优先级表 8 项标记 ✅ |
| [architecture.md](file:///C:/Users/zhujieling11/MikuMikuAR/docs/architecture.md) | 材质系统架构说明 |
| [reusables.md](file:///C:/Users/zhujieling11/MikuMikuAR/docs/reusables.md) | 组件可复用说明 |
| [plans/next-phase.md](file:///C:/Users/zhujieling11/MikuMikuAR/docs/plans/next-phase.md) | 下一步开发计划 |
| [changelog/phase-5-7-complete.md](file:///C:/Users/zhujieling11/MikuMikuAR/docs/changelog/phase-5-7-complete.md) | 本文 |

---

## DanceXR 对标进度

| 维度 | 总项 | 已完成 | 待实现 | 规划中 | 不考虑 | 进度 |
|------|------|--------|--------|--------|--------|------|
| 模型支持 | 7 | 6 | 1 | 0 | 0 | **86%** |
| 动画 & 物理 | 7 | 4 | 0 | 0 | 3 | **57%** |
| 外观(渲染) | 10 | 9 | 1 | 0 | 0 | **90%** |
| 交互 & UI | 7 | 5 | 2 | 0 | 0 | **71%** |
| 实用功能 | 5 | 5 | 0 | 0 | 0 | **100%** |
| **合计** | **36** | **29** | **4** | **3** | **0** | **81%** |

---

## 技术债务 / 待跟进

- [ ] **Playwright E2E**: 材质编辑 4 级快照（初始/调滑块/重置单个/重置全部）
- [ ] **scene 测试**: `_applyAll` 针对 `babylon-mmd` `StandardMaterial` 实际 property 的集成测试
- [ ] **序列化**: `ModelInstance.showBones`/`physicsEnabled` 纳入场景保存/恢复
