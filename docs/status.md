# MikuMikuAR 项目现状

> 最后更新：2026-07-05
> 本文件为**只读快照**，记录当前状态。规划和路线图见 [`roadmap.md`](roadmap.md)。

---

## 当前状态

Wails (Go) + babylon-mmd 的桌面/移动 PMX 查看器，Phase 1-10 全部完成，环境系统增强已交付。核心管线、模型库管理、多模型场景、XPBD 布料物理、粒子系统、程序化动作、换装系统、Android 适配均已就绪。

---

## Phase 进度总览

| Phase | 功能 | 状态 |
|-------|------|------|
| 1 | 标签系统 | ✅ |
| 2 | 渲染调参（Bloom/FXAA/色调映射/曝光/FOV/预设） | ✅ |
| 3 | 音乐同步 + 相机 VMD + 舞蹈套装 | ✅ |
| 4 | 下载目录监听 + 自动导入 | ✅ |
| 5 | 模型统计/批量截图/近期播放/表情预览 | ✅ |
| 6 | 材质调节（按部位）+ 线框/重力 | ✅ |
| 7 | 播放列表 + 模型加载预设 + 软件管理 | ✅ |
| 8 | VPD/程序化动作/LipSync/节拍检测/换装/环境系统 | ✅ |
| 9 | XPBD 布料 + 粒子系统 + 多相机模式 | ✅ |
| 10 | Android 适配 + Wails v3 迁移 + 触屏优化 | ✅ |
| — | 环境系统增强（纹理地面/粒子溅射/水下后处理） | ✅ |

> Phase 11-13 规划见 [`roadmap.md`](roadmap.md)。

---

## 键盘快捷键

| 快捷键 | 行为 |
|--------|------|
| Ctrl+1~5 | 切换 5 个底部导航弹窗（模型/动作/场景/环境/设置） |
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
| Node.js | 24.16.0+ | frontend/.nvmrc |
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
```

---

## 已知限制

| 限制 | 说明 |
|------|------|
| JS 运行时无 WASM Bullet 物理 | 注视追踪需切到 JS 运行时（`VITE_MMD_RUNTIME=js`），布料/头发摆动失效 |
| SSS 次表面散射未实现 | 依赖 babylon-mmd 支持 PBR 材质，上游阻塞 |
| SAF 完整路径待 Spike | Android 文件访问 Phase C 未实施 |
| config.ts 全局状态耦合 | 多模块共享，改一处可能影响全局 |

---

## Bug 记录

详见 git history。所有已知 Bug（#1-#32）均已修复。
