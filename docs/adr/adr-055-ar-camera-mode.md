# ADR-055: AR 相机模式 —— 摄像头视频透传与模型叠加

**日期**：2026-07-06
> **状态**：已批准（2026-07-06 评审通过，待实施）
> **关联**：ADR-016(视线追踪)、ADR-053(Gaze 图层)、ADR-017(Android 适配)、ADR-049(轨道控制扩展)、ADR-054(路线图)

---

## 一、背景

### 1.1 来源与定位

外部参考项目 `x3bits/MikuMikuXR`（Unity + Vuforia，2018 停更）已实现「AR Camera」概念——通过 Vuforia 标记跟踪把 MMD 模型叠加到现实画面。本 ADR 评估在当前 Wails + Babylon.js 栈上**不引入 Vuforia/ARCore/ARKit** 的前提下，以最小工程量获得等价的 AR 体验。

### 1.2 与现有子系统的关系

| 子系统 | 关系 |
|--------|------|
| `scene/camera/camera.ts` | 现有 5 种相机模式（orbit/freefly/oneshot/concert/vmd），AR 作为第 6 种 `ar` 模式接入 |
| `scene/env/env-impl.ts` | AR 模式下背景由视频流替代天空盒，环境光照仍可保留 |
| Gaze 视线追踪（ADR-016/053） | **天然协同**：AR 模式下「朝向相机」语义变为「朝向屏幕外真实用户」，gaze 视线变为「与真人眼神接触」 |
| WASM/JS 运行时分裂（ADR-054/056） | **不受影响**：gaze 双路径（WASM frontBuffer 直写 + JS linkedBone）已在 ADR-056 验证实施，AR 模式下 WASM 物理与 gaze 协同可同时工作 |

### 1.3 不做什么

- ❌ 不做平面检测 / 锚点 / 光照估计（属于真 AR，需 ARCore/ARKit）
- ❌ 不做标记跟踪（属于 Vuforia 路线，许可证与生态已封闭）
- ❌ 不做深度遮挡（现实物体遮挡虚拟模型，需 RGB-D 或 LiDAR）
- ✅ 只做**视频透传 + 模型叠加**——摄像头画面作为场景背景，模型渲染在视频之上

---

## 二、需求

### 2.1 功能性需求

| # | 需求 | 优先级 |
|---|------|--------|
| F1 | 用户开启 AR 模式后，前置/后置摄像头视频流作为 3D 场景背景 | P0 |
| F2 | 模型保留原有变换、VMD、物理、gaze 行为，叠加在视频上 | P0 |
| F3 | 用户可切换前置/后置摄像头（移动端） | P1 |
| F4 | 视频流可暂停/恢复（节省电量） | P2 |
| F5 | AR 模式下 gaze 朝向默认锁定屏幕外用户（增强眼神接触） | P1 |
| F6 | 截图功能在 AR 模式下需合成视频背景（非透明 canvas） | P0 |

### 2.2 非功能性需求

| # | 需求 |
|---|------|
| N1 | 桌面 WebView2 与 Android WebView 双端可用 |
| N2 | 不破坏现有 5 种相机模式的稳定性 |
| N3 | 摄像头权限被拒时降级为黑底（不崩溃） |
| N4 | AR 模式开关零开销——未启用时不持有摄像头资源 |

---

## 三、方案

### 3.1 技术选型对比

#### 方案 A：getUserMedia + VideoTexture（推荐）

```
navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
  → <video> element
  → Babylon.js VideoTexture
  → 作为场景背景层（GUI 或 fullscreen plane）
```

| 优点 | 缺点 |
|------|------|
| 纯前端，无 Go 端改动 | WebView2 / Android WebView 需 HTTPS 或 localhost（Wails 默认 localhost ✅） |
| 跨平台同一份代码 | Android WebView 需显式声明 `CAMERA` 权限 + `setMediaPlaybackRequiresUserGesture(false)` |
| 与现有 Babylon.js 渲染管线无缝集成 | 无平面检测/锚点（仅视频透传） |
| 摄像头生命周期由浏览器管理，关闭即释放 | — |

#### 方案 B：Go 端采集 + IPC

Go 用 `pion/mediadevices` 或平台原生 SDK 采集 → 共享内存/IPC → 前端读帧。

| 优点 | 缺点 |
|------|------|
| 绕过 WebView 限制 | 跨平台摄像头 SDK 极复杂（Windows Media Foundation / Android Camera2 / iOS AVFoundation） |
| 可做更深的图像处理（绿幕抠像等） | 工程量是方案 A 的 5~10 倍 |
| — | Go 端编码后 IPC 传输，延迟更高 |

#### 方案 C：平台原生 ARCore/ARKit 桥接

每端独立实现真 AR（平面检测/光照估计/锚点）。

| 优点 | 缺点 |
|------|------|
| 真 AR 体验 | 工程量爆炸，每端独立 |
| 现实物体可遮挡虚拟模型 | 与 babylon-mmd 渲染管线集成困难 |
| — | 远超当前项目能承接的复杂度 |

#### 决策

**选方案 A**。理由：

1. 与 MikuMikuXR「AR Camera」概念等价（视频透传 + 模型叠加），不引入 Vuforia 类依赖
2. 工程量与项目当前阶段匹配（P2 优先级，参考 ADR-054）
3. WebView2 + Android WebView 均原生支持 `getUserMedia`
4. 未来若需升级到真 AR，方案 A 可平滑迁移到 WebXR `hit-test` API（浏览器标准）

### 3.2 渲染合成策略

#### 策略对比

| 策略 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| **S1. VideoTexture → GUI 全屏背景** | `advancedTexture.addControl(meshGUI)` + 全屏 plane | 与 Babylon.js 渲染管线一致 | GUI 层可能不参与 post-processing |
| **S2. 透明 canvas + CSS `<video>` 底层** | canvas 设 `alpha: true` + `<video>` 在 z-index 下方 | 性能最优，视频直出 | 截图需手动合成 video + canvas 两层 |
| **S3. VideoTexture → 全屏 Mesh** | 场景中放一个全屏 quad，材质用 VideoTexture | 与现有渲染管线完全统一 | 需正交相机渲染背景层 |

**选 S2**。理由：

- 桌面 + 移动端性能最优，视频帧零拷贝到 GPU
- 截图功能（`SaveScreenshot`）已有 Go 端实现，可在 AR 模式下走「前端 canvas + video 合成 → Go 保存」的扩展路径
- canvas 透明度已在当前 Babylon.js 配置中支持（验证 `engine = new Engine(canvas, true, { alpha: true })`）

**截图合成顺序**（F6）：AR 模式下 `saveScreenshot` 走合成路径——先 `ctx.drawImage(video, 0, 0, w, h)` 铺底，再 `ctx.drawImage(renderCanvas, 0, 0, w, h)` 叠加模型。`renderCanvas` 必须保持 alpha 通道透明，否则 video 被遮盖。需测试不同显示色域下 gamma 一致性。

### 3.3 相机模式扩展

在 `scene/camera/camera.ts` 的 `CameraMode` 类型新增 `'ar'`：

```typescript
type CameraMode = 'orbit' | 'freefly' | 'oneshot' | 'concert' | 'vmd' | 'ar';
```

`ar` 模式行为：
- 不改变 3D 相机位姿（保留用户上一次的 orbit/freefly 状态）
- 仅触发视频背景启用 + canvas 透明化
- 关闭 `ar` 模式时恢复原相机模式 + 不透明 canvas + 天空盒

**`switchCameraMode('ar')` 流程**：① 记录当前相机模式（用于恢复）→ ② `startARCamera()`，失败降级黑底 → ③ `engine.clearColor` 透明 + `setAlphaMode` → ④ 显示 `<video>`。退出时反向恢复原 `clearColor`、隐藏 `<video>`、释放视频流。

> **不与 vmd 模式互斥**：AR 模式下仍可叠加 vmd 相机轨道（视频背景 + 镜头运动），形成「AR 镜头跟拍」效果。

### 3.4 Gaze 协同

AR 模式下，gaze 视线追踪的目标点从「3D 相机位置」重定向为「屏幕中心 + 估算用户距离」。

```typescript
// proc-motion-bridge.ts 扩展
function getGazeTarget(arMode: boolean, camera: Camera): Vector3 {
    if (arMode) {
        // 屏幕中心反投影到世界空间，距离取估算值（默认 1.5m）
        return screenCenterToWorld(camera, depth = 1.5);
    }
    return camera.position;
}
```

> 说明：gaze 双路径（WASM frontBuffer 直写 + JS linkedBone，ADR-056）在 AR 模式下同样有效，WASM 物理运行时不受影响。

---

## 四、决策对比

| 方案 | 工程量 | 跨平台 | 真 AR 能力 | 与项目栈契合度 | 结果 |
|------|--------|--------|-----------|---------------|------|
| A. getUserMedia + VideoTexture/CSS | 低 | ✅ | ❌（仅视频透传） | ✅ | ✅ 选中 |
| B. Go 端采集 + IPC | 高 | ⚠️ 每端独立 | ❌ | ⚠️ | ❌ |
| C. ARCore/ARKit 原生 | 极高 | ⚠️ 每端独立 | ✅ | ❌ | ❌（远期可 reconsider） |

---

## 五、涉及文件

| 文件 | 变更 |
|------|------|
| `core/types.ts` | `CameraMode` 增加 `'ar'`；新增 `ARCameraConfig` 类型 |
| `scene/camera/camera.ts` | `switchCameraMode('ar')` 分支：调用 AR 启停；保留原相机状态用于恢复 |
| `scene/ar/ar-camera.ts`（新增） | `startARCamera()` / `stopARCamera()` / `switchCameraFacing()`；封装 getUserMedia 与 `<video>` 元素管理 |
| `scene/scene.ts` | AR 模式启停时切换 `engine` 的 alpha 与 clearColor；`onBeforeRenderObservable` 中无需额外驱动（CSS `<video>` 自动播放） |
| `scene/motion/proc-motion-bridge.ts` | gaze 目标点 AR 模式分支（见 §3.4） |
| `menus/motion-camera-levels.ts` | 相机模式面板新增「AR 相机」入口（`addModeRow`）；AR 模式下 orbit 旋转等控制灰显 |
| `scene/scene-serialize.ts` | `SceneFile.camera.mode` 序列化 `'ar'`；保存原相机状态用于反序列化恢复 |
| `internal/app/app.go`（Android） | `AndroidManifest.xml` 增加 `CAMERA` 权限；WebView 配置 `setMediaPlaybackRequiresUserGesture(false)` |
| `frontend/index.html`（可选） | 增加 `<video id="arVideo" autoplay playsinline>` 元素，初始 `display:none` |

---

## 六、分期实施

### Phase 1：MVP（桌面 WebView2）

- `ar-camera.ts` 实现 `startARCamera` / `stopARCamera`
- 桌面端默认前置摄像头
- 相机模式面板新增「AR 相机」按钮
- canvas 透明化 + `<video>` 底层
- 截图功能在 AR 模式下合成 video + canvas

### Phase 2：移动端 + Gaze 协同

- Android `CAMERA` 权限申请流程
- 前置/后置摄像头切换（`facingMode: 'environment'`）
- Gaze 视线目标点重定向到屏幕中心
- AR 模式下默认开启 gaze（增强眼神接触）

### Phase 3（可选）：WebXR 升级

- 评估 `WebXR hit-test` API 在 WebView2/Android WebView 的支持度
- 若可用，升级为真 AR（平面检测 + 锚点）
- 保留 Phase 1/2 实现作为不支持 WebXR 时的降级路径

---

## 七、风险与边界

| # | 风险 | 缓解 |
|---|------|------|
| R1 | Android WebView `getUserMedia` 兼容性参差 | Phase 2 启动前先写最小化 demo 验证目标设备 |
| R2 | 用户拒绝摄像头权限 | 降级为黑底背景 + 状态栏 `✗ 摄像头权限被拒绝，已切换黑底模式`，不退出 AR 模式（允许模型演示）；成功开启时 `✓ AR 相机已开启` |
| R3 | 截图合成在 AR 模式下颜色不一致 | 用 `canvas.drawImage(video, ...)` + `canvas.drawImage(renderCanvas, ...)` 两步合成，统一 gamma |
| R4 | 视频帧率与渲染帧率不同步导致抖动 | `<video>` 由浏览器自动播放，Babylon.js 渲染独立，无需同步 |
| R5 | 桌面端 HTTPS 要求 | Wails v3 默认 localhost，`getUserMedia` 允许 localhost，无需 HTTPS |
| R6 | 移动端后置摄像头镜像问题 | CSS `transform: scaleX(-1)` 处理前置镜像，后置不镜像 |

### 边界

- 不处理多摄像头切换（仅前置/后置两档）
- 不处理摄像头热插拔（USB 摄像头拔出后视频流中断，UI 提示重连）
- 不录制 AR 视频（仅截图）；视频录制属于录屏功能，单独规划

### 测试关注点

- 不同分辨率摄像头适配（视频比例与 canvas 比例不一致时黑边处理）
- 多次快速开关 AR 模式，确保摄像头资源正确释放（无 MediaStream 残留）
- Android 端 SAF 权限与 WebView `setMediaPlaybackRequiresUserGesture(false)` 验证

---

## 八、未来优化

- **键盘快捷键**：为 AR 模式开关分配 `Ctrl+6`（接续现有 Ctrl+1~5 弹窗快捷键），方便演示快速切换
- **绿幕抠像**：方案 B 的延伸，Go 端处理视频帧后传给前端，可叠加现实人物与虚拟模型（参考 VTuber 路线）
- **WebXR 升级**：Phase 3，浏览器标准路线
- **AR 锚点序列化**：用户在视频中标记的锚点位置保存到 `.mmascene`，下次加载恢复
- **手势交互**：MediaPipe Hands 检测手部 → 触发模型手势/动作
- **多机位**：连接多个 USB 摄像头切换视角（桌面端）

---

## 九、与 MikuMikuXR 的关系

| 维度 | MikuMikuXR | MikuMikuAR（本 ADR） |
|------|-----------|---------------------|
| 技术栈 | Unity 2018 + Vuforia | Wails + Babylon.js + getUserMedia |
| AR 实现 | Vuforia 标记跟踪 | 视频透传（无标记） |
| 平台 | Android | Windows + Android |
| 维护状态 | 2018 停更 | 活跃 |
| 代码复用 | — | 0%（仅理念借鉴） |

**结论**：理念同源（MMD + 摄像头），实现路线完全独立。本 ADR 不引入 MikuMikuXR 任何代码。

---

## 十、决策状态

✅ **已批准**（2026-07-06 评审通过）。进入 ADR-054 路线图 P2 优先级（护城河 B：多模型导演台核心增强）。按 Phase 1（桌面 MVP）→ Phase 2（移动端 + Gaze 协同）推进，需特别关注 Android 兼容性验证与截图合成实现细节。
