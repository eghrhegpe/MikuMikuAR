# ADR-073: AR 地形识别 —— 原生 ARCore / ARKit 桥接

> **日期**: 2026-07-09
> **状态**: 提案（Proposed）—— ADR-055 §3.1 方案 C「平台原生 ARCore / ARKit 桥接」的细化，远期可 reconsider
> **关联**：ADR-055(AR 相机模式·方案 C)、ADR-017(Android 适配)、ADR-072(WebXR 平面检测，若浏览器路径不可行的替代)

---

## 一、背景

### 1.1 为什么需要原生
真·地形识别（平面检测 + 6DoF 世界追踪 + 光照估计）依赖 **OS 级 AR session**（SLAM）。WebXR 在 WebView 受限（见 ADR-072 §1.3），浏览器标准路径在 Android WebView / 桌面 / iOS 大面积不可行。当产品定位需要「真 AR」时，必须走**平台原生 AR SDK**。

### 1.2 与现有栈的关系
| 子系统 | 关系 |
|--------|------|
| ADR-055 passthrough | 原生 AR 提供 camera 帧（取代 getUserMedia），模型叠加层不变 |
| 接触阴影（blob shadow，已落地） | 原生平面可用后由真实地面网格取代 |
| babylon-mmd 渲染 | 模型仍由 Babylon 渲染，仅「地面 / 锚点」来源改为原生回传 |

---

## 二、需求

### 2.1 功能性需求
| # | 需求 | 优先级 |
|---|------|--------|
| F1 | 原生 AR session 生命周期管理（start / stop / pause） | P0 |
| F2 | plane detection 结果回传 JS（平面位姿 / 边界） | P0 |
| F3 | camera 6DoF pose 回传（每帧） | P0 |
| F4 | 光照估计回传（可选，增强真实感） | P2 |
| F5 | 与 WebView 渲染共存（相机帧喂前端） | P0 |

### 2.2 非功能性需求
| # | 需求 |
|---|------|
| N1 | 与现有 WebView + Babylon 渲染管线共存，不破坏 |
| N2 | 包体 / 权限代价可控（ARCore 依赖、CAMERA 权限已具备） |

---

## 三、方案

### 3.1 技术选型对比

#### 方案 A：Android ARCore 桥接（推荐，优先评估）
`com.google.ar:core`（ARCore SDK for Android）建立 `Session`，检测 plane + 追踪 camera pose，通过 JS Bridge 回传 Babylon。
| 优点 | 缺点 |
|------|------|
| 真·地形识别，能力最强 | **ARCore 与 WebView 渲染共存是硬骨头**（见 §3.3） |
| 平面 / 锚点 / 光照完整 | 包体增大（ARCore ≈ 数 MB + Scoped Storage 适配） |
| 与 Babylon 渲染层解耦（仅回传数据） | 每端独立，无跨平台复用 |

#### 方案 B：iOS ARKit（Swift）
ARKit 提供等价能力，但项目当前**无 iOS 构建**（Wails v3 主要 Windows / Android）。
| 优点 | 缺点 |
|------|------|
| 真·AR，生态成熟 | 需新建 iOS 构建链，远超当前范围 |
| — | 与 WebView 集成同样有渲染共存问题 |

#### 方案 C：Vuforia 标记跟踪
| 优点 | 缺点 |
|------|------|
| 标记跟踪成熟 | ADR-055 已否决（许可证 / 生态封闭，2018 停更） |

#### 决策
**选 A（Android 优先）**，iOS（B）远期。与 ADR-055 方案 C「远期可 reconsider」一致。若 WebXR 路径（ADR-072）在 Android 可行，则 A 降级为「WebXR 不可达时的兜底」。

### 3.2 数据回传契约（JS Bridge）
```
wails.startARCore()                                // 启动原生 AR session
wails.onARCorePlane(planes: {id, pose, extent}[]) // 平面回调
wails.onARCorePose(cameraPose: mat4)             // 每帧相机位姿
wails.stopARCore()
```
Babylon 侧用 `onARCorePlane` 建地面网格（取代接触阴影），用 `cameraPose` 驱动 3D 相机（或仅用于锚定模型）。

### 3.3 关键风险：ARCore × WebView 渲染共存
ARCore 通常要求**自有 GLSurfaceView / Activity** 持有 camera 帧与 AR 渲染，而 Babylon 跑在 **WebView 的 WebGL Surface** 上——两者争用 Surface / EGL Context，直接并发不可行。可行架构二选一：
- **② WebView 透明叠加在 ARCore GLSurface 之上（推荐）**：ARCore 渲染 camera 帧到自有 Surface，WebView 设透明（`alpha:true`，ADR-055 已具备）叠加其上，Babylon 仅渲染模型 + 接收 plane / pose 回传。最贴合 ADR-055 的 S2 透明 canvas 架构。
- **① ARCore 渲染到 OpenGL texture → 喂 WebView 作视频源**：取代 getUserMedia，复杂度更高。

---

## 四、决策对比
| 方案 | 工程量 | 跨平台 | 真·地形 | 与项目栈契合 | 结果 |
|------|--------|--------|-----------|---------------|------|
| A. ARCore 桥接 | 极高 | ⚠️ 每端独立 | ✅ | ⚠️（需解决 §3.3 共存） | 🟡 Android 优先 |
| B. ARKit | 极高 | ❌（无 iOS 构建） | ✅ | ❌ | ⚪ 远期 |
| C. Vuforia | — | — | ⚠️ 仅标记 | ❌（ADR-055 否决） | ❌ |

---

## 五、涉及文件（若批准实施）
| 文件 | 变更 |
|------|------|
| `build/android/.../MainActivity.java` | ARCore `Session` 生命周期、plane / camera pose 回调、JS Bridge 暴露（§3.2） |
| `scene/ar/ar-core-bridge.ts`（新增） | JS 侧消费 plane / pose，建地面网格、锚定模型 |
| `scene/ar/ar-scene.ts` | 原生平面可用时停用接触阴影，改用真实地面 |
| `scene/scene.ts` | camera pose 来源切换（ARCore / 默认） |

---

## 六、分期实施
### P1：ARCore × WebView 共存可行性探针（必做，决策前提）
- 验证「WebView 透明叠加在 ARCore GLSurface 之上」在目标 Android 设备可行
- 输出 camera 帧 + Babylon 模型同屏样例

### P2：plane 回传 + 可视地面
- `onARCorePlane` → Babylon 地面网格

### P3：模型锚定 + 接触阴影替换
- 模型锚定到真实平面，停用 blob shadow

### P4：光照估计（可选）
- `onARCoreLightEstimate` → 调整场景光

### P5：iOS ARKit（远期）
- 需先建 iOS 构建链

---

## 七、风险与边界
| # | 风险 | 缓解 |
|---|------|------|
| R1 | ARCore × WebView 渲染共存难（§3.3） | P1 探针先行，失败则放弃 A |
| R2 | 包体增大 + Scoped Storage 适配 | Gradle 依赖隔离，按需 ABI split |
| R3 | 每端独立，维护成本爆炸 | 仅 Android 优先，iOS 远期 |
| R4 | 与 babylon-mmd 管线集成验证 | P1 样例验证渲染链 |

### 边界
- 不追求深度遮挡（RGB-D / LiDAR）
- 不做多平面复杂语义理解

---

## 八、未来优化
- **AR 锚点序列化**：真实锚点存入 `.mmascene`（关联 ADR-055 §八）
- **手势交互**：原生手势 → 模型动作（关联 ADR-055 §八）

---

## 九、与 ADR-055 / 072 的关系
- ADR-055 §3.1 方案 C（「远期可 reconsider」）的落地提案
- 若 ADR-072 的 WebXR 路径在 Android 可行，本 ADR 降级为兜底；若不可行，本 ADR 为「真 AR」唯一路径

---

## 十、决策状态
🟡 **提案**（2026-07-09）。受 ADR-072 探针结果影响——仅当 WebXR 不可行且产品需真 AR 时推进 P1。
