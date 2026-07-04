# 下一阶段开发计划

> **最后更新：2026-06-28**
> 对齐来源：`docs/status.md` + `docs/roadmap.md`
> 历史版本已归档至 `docs/changelog/PLAN-*`

---

## 当前完成状态（Phase 1–9 摘要）

| Phase | 名称 | 状态 |
|-------|------|------|
| Phase 1 | 标签系统 | ✅ 完成 |
| Phase 2 | 渲染调参（Bloom/FXAA/色调映射/曝光/FOV/预设） | ✅ 完成 |
| Phase 3 | 音乐同步 + 相机 VMD + 舞蹈套装 | ✅ 完成 |
| Phase 4 | 下载目录监听 + 自动导入 | ✅ 完成 |
| Phase 5 | 模型统计/批量截图/近期播放/表情预览 | ✅ 完成 |
| Phase 6 | 材质调节（按部位）+ 单独材质编辑器 + 线框/重力 | ✅ 完成 |
| Phase 7 | 播放列表 + 模型加载预设 + 软件管理 | ✅ 完成 |
| Phase 8 | VPD/程序化动作/LipSync/节拍检测/换装系统/物理分类/环境系统 | ✅ 完成 |
| Phase 9（布料部分） | XPBD 核心引擎 + 程序化裙摆 + SDF 胶囊碰撞 + 粒子系统 | ✅ 完成 |

---

## ✅ 渲染管线遗留 Bug（已全部修复，2026-06-28 验证）

> 详见 `docs/troubleshooting.md` §「渲染管线遗留 Bug」

| # | 优先级 | 问题 | 状态 |
|---|--------|------|------|
| 1 | 🔴 P0 | `reattachPipeline` 位置错误 | ✅ camera.ts:286 已加 |
| 2 | 🔴 P0 | 切相机后 FOV 丢失 | ✅ camera.ts:289 已补 |
| 3 | 🔴 P0 | `outlineEnabled` 硬编码 | ✅ scene.ts:280 模块级变量 |
| 4 | 🟡 P1 | `addCamera` 累积 | ✅ scene.ts:375 removeCamera |
| 5 | 🟡 P1 | 预设保存不一致 | ✅ 先持久化后写内存 |

---

## 待实现：Phase 9 剩余 + Phase 10

### Phase 9：多相机模式

| 功能 | 说明 | 技术路径 |
|------|------|----------|
| 多相机模式完善 | Freefly/One-shot/Concert 模式的 UI 交互完善 | `camera.ts` + `scene-menu.ts` |

> 注：布料模拟/XPBD/粒子系统已在 Phase 9 前置完成，见上方状态表。

### Phase 10：Android 适配

| 功能 | 说明 | 技术依赖 |
|------|------|----------|
| Android 端 | Wails mobile 桥接，全链路桌面逻辑兼容安卓（文件服务/触摸/性能） | 发版测试中 |

---

## 深度功能补齐（DanceXR 对标剩余 3 项）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 天空/水体/道具/特效 | P4 | Babylon.js 场景扩展；粒子系统已完成，水体/天空盒需独立实现 |
| 多相机模式（Concert/Oneshot 完整实现） | P3 | 部分已完成，主要是 Bug 修复 + UI 完善 |
| Android 端适配 | P0 | 发版测试中，全链路必须通过 |

---

## 推荐下一步执行顺序

```
第 1 步：Concert/Oneshot 相机模式 UI 完善（Phase 9 多相机）
  └─ Freefly/One-shot/Concert 模式的 UI 交互完善
  └─ 相机模式切换的视觉反馈优化

第 2 步：水体/天空盒扩展（DanceXR 对标补齐）
  └─ Babylon.js 场景扩展
  └─ 天空盒 + 水面反射/折射

第 3 步：Phase 10 Android 适配评估
  └─ Wails 移动端方案调研
  └─ 视平台成熟度决定启动时机
```
```
