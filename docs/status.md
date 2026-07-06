# MikuMikuAR 项目现状

> 最后更新：2026-07-06
> 本文件记录当前状态，可随项目进展维护。

---

## 当前状态

Wails (Go) + babylon-mmd 的桌面/移动 PMX 查看器。核心管线、模型库管理、多模型场景、XPBD 布料物理、粒子系统、程序化动作、换装系统、环境系统、Android 适配均已就绪。

---

## 已完成功能

| 功能 | 状态 |
|------|------|
| 标签系统 | ✅ |
| 渲染调参（Bloom/FXAA/色调映射/曝光/FOV/预设） | ✅ |
| 音乐同步 + 相机 VMD + 舞蹈套装 | ✅ |
| 下载目录监听 + 自动导入 | ✅ |
| 模型统计/批量截图/近期播放/表情预览 | ✅ |
| 材质调节（按部位）+ 线框/重力 | ✅ |
| 播放列表 + 模型加载预设 + 软件管理 | ✅ |
| VPD/程序化动作/LipSync/节拍检测/换装/环境系统 | ✅ |
| XPBD 布料 + 粒子系统 + 多相机模式 | ✅ |
| Android 适配 + Wails v3 迁移 + 触屏优化 | ✅ |
| 导入文件（SAF 文件选择器导入 PMX/ZIP/VMD）| ✅ |
| 环境系统增强（纹理地面/粒子溅射/水下后处理） | ✅ |


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
| SAF 文件/目录选择已就绪 | Android 文件/目录选择通过 Wails v3 SAF API (`CanChooseDirectories(true)`) 原生解决 |
| **Android: Babylon.js 加载路径** | `index.html` 用 `<script src="/lib/babylon.js">` 根相对路径，Android WebView base URL 不同时可能 404 |
| **Android: localStorage 容量** | 场景自动保存写 localStorage，Android 有 5MB 限制，大场景可能写满 |
| **Android: AudioContext 惰性创建** | Android WebView 需用户交互后才能创建 AudioContext，首次无声音频可能失败 |
| **Android: Canvas 2D 纹理兼容** | 粒子/天空/水面用 Canvas 2D 绘制纹理，低端 Android GPU 可能有兼容问题 |
| **Android: 软件渲染性能** | 禁用硬件加速强制软件渲染器，大模型场景 FPS 可能低于桌面 |

---

## 近期架构重构

| ADR | 内容 | 状态 |
|-----|------|------|
| ADR-050 | 保存触发机制统一（`onChange` / `_triggerAutoSave` → 统一 `triggerAutoSave`，纯重命名，无功能变更） | ✅ 已实施（2026-07-06） |

---

## Bug 记录

详见 git history。
