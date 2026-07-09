# ADR-072: AR 平面检测 —— WebXR hit-test + plane detection

**日期**：2026-07-09
> **状态**：提案（Proposed）—— ADR-055 Phase 3「WebXR 升级」的细化，待 P1 探针结果后批准
> **关联**：ADR-055(AR 相机模式·Phase 3 WebXR 升级、§3.1 决策第 4 点)、ADR-017(Android 适配)、ADR-071(proc-vs 感知边界)

---

## 一、背景

### 1.1 现状与痛点
ADR-055 确立了「摄像头视频透传 + 模型叠加」的伪 AR（passthrough），已落地三件事：
- 桌面 / Android WebView 通过 `getUserMedia` 取摄像头流做背景（S2 策略：透明 canvas + CSS `<video>` 底层）
- Android WebView 已补 `WebChromeClient.onPermissionRequest` + `CAMERA` 运行时权限（见 ADR-055 实施期修复）
- 模型悬浮感已用**接触阴影（blob shadow）**缓解（半透明径向渐变投影，视觉「踩稳」但非真·落地）

但 passthrough 仍缺 **平面检测 / 锚点 / 6DoF 追踪**：模型与真实世界坐标脱钩，换角度时模型与场景「错位」，无「踩在真实地面」的锚定感。

### 1.2 目标
在不引入原生 AR SDK 的前提下，用**浏览器标准 WebXR Device API** 获得「真·落地面」能力（hit-test 把模型锚到真实平面），作为 ADR-055 方案 A「可平滑迁移到 WebXR hit-test」决策的自然延伸。

### 1.3 平台约束（关键）
| 平台 | WebXR `immersive-ar` 支持 | 说明 |
|------|------|------|
| 桌面 WebView2 (Edge/Chromium) | ❌ 不支持 | 无 XR 后端，仅能 passthrough 降级 |
| Android WebView (System WebView ≥83) | ⚠️ 默认禁用 | 需评估启用机制（设备 / ROM / Compat），兼容性参差 |
| Android Chrome | ✅ | 支持，但 App 内 WebView ≠ Chrome |
| iOS Safari | ❌ 不支持 | 2026 仍无 WebXR |

---

## 二、需求

### 2.1 功能性需求
| # | 需求 | 优先级 |
|---|------|--------|
| F1 | 支持 WebXR 的设备可建立 `immersive-ar` session | P1 |
| F2 | hit-test 将模型锚定到真实平面（点 / 面） | P0 |
| F3 | plane detection 生成可视地面网格（替代接触阴影） | P1 |
| F4 | 与现有 orbit / gaze 协同（锚定后相机绕真实平面转） | P1 |
| F5 | 不支持 WebXR 时**无缝降级**为现有 passthrough（接触阴影保留） | P0 |

### 2.2 非功能性需求
| # | 需求 |
|---|------|
| N1 | 降级路径零破坏——WebXR 不可用时用户无感回退 |
| N2 | 不引入原生 AR SDK（保持纯前端 / Web 栈） |

---

## 三、方案

### 3.1 技术选型对比

#### 方案 A：WebXR `immersive-ar` + XRHitTestSource + XRPlaneDetector（推荐目标形态）
```typescript
const session = await navigator.xr.requestSession('immersive-ar', {
  requiredFeatures: ['hit-test'],
  optionalFeatures: ['plane-detection'],
});
const viewerSpace = await session.requestReferenceSpace('viewer');
const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
// 每帧：hitTestSource.getHitTestResults(frame) → pose → 锚定模型
```
| 优点 | 缺点 |
|------|------|
| 浏览器标准，跨平台同一份代码 | Android WebView 默认不启用 WebXR（见 §1.3） |
| 自带 camera passthrough + hit-test + plane，能力完整 | 与现有 `getUserMedia` passthrough 是两套机制，需二选一（§3.2） |
| 与 Babylon.js WebXR 模块（`WebXRSessionManager` / `WebXRDefaultExperience`）天然契合 | 桌面 / iOS 完全无解，仅 Android Chrome / 部分 WebView 可用 |

#### 方案 B：仅做 WebXR 支持度探针（局部启用）
先不重构渲染，仅探测目标设备 WebView 能否开启 WebXR（flag / `androidx.webkit.WebViewCompat` / ROM 支持），输出兼容性矩阵。
| 优点 | 缺点 |
|------|------|
| 零风险，先回答「能不能做」 | 不交付功能，仅调研 |

#### 方案 C：放弃 WebXR，走原生 ARCore（→ ADR-073）
| 优点 | 缺点 |
|------|------|
| 真·地形识别，能力最强 | 每端独立，工程量爆炸（详见 ADR-073） |

#### 决策
**目标形态选 A**，但**落地顺序以 B（探针）先行**：
1. 先回答「Android WebView 能否启用 WebXR」——这是 A 能否成立的前提
2. 探针通过则推进 A；不通过则 WebXR 路线在 Android 端不可行，转向 ADR-073（原生）
3. 桌面 / iOS 永远降级 passthrough（接触阴影保留）

### 3.2 与现有 passthrough 的集成冲突（必须决策）
WebXR `immersive-ar` session **自带 camera passthrough**（UA 提供相机帧），与 ADR-055 的 `getUserMedia` 方案是两套背景机制。集成时二选一：
- **融合型**：保留 `getUserMedia` 视频背景，仅用 WebXR 做 hit-test —— ❌ 不可行（hit-test 是 `immersive-ar` session 能力，开启即用 UA passthrough）
- **全 WebXR 型**：用 `immersive-ar` 自带 passthrough 取代 `getUserMedia`，hit-test / plane 直接可用 —— ✅ 标准做法，但需改写 ADR-055 的 S2 视频背景为 WebXR 背景
- **降级共存型**：WebXR 可用时全用 WebXR；不可用时回退 `getUserMedia` passthrough + 接触阴影 —— ✅ 推荐，需抽象「背景源」接口

---

## 四、决策对比
| 方案 | 工程量 | 跨平台 | 真·落地 | 与项目栈契合 | 结果 |
|------|--------|--------|-----------|---------------|------|
| A. WebXR 全量 | 中 | ⚠️ 仅 Android Chrome / 部分 WebView | ✅ | ✅（Babylon WebXR 模块） | 🟡 目标形态（受 §1.3 约束） |
| B. 支持度探针 | 低 | — | ❌（仅调研） | ✅ | ✅ 先行 |
| C. 原生 ARCore | 极高 | ⚠️ 每端独立 | ✅ | ❌ | → ADR-073 |

---

## 五、涉及文件（若批准实施）
| 文件 | 变更 |
|------|------|
| `scene/ar/ar-camera.ts` | 抽象「背景源」接口（getUserMedia / webxr）；请求 `immersive-ar` session + hit-test source |
| `scene/ar/ar-scene.ts` | 消费 hit-test / plane 结果建真实地面网格、锚定模型；WebXR 可用时停用接触阴影 |
| `build/android/.../MainActivity.java` | 评估并启用 WebView WebXR（manifest `uses-feature` + 启用机制） |
| `scene/camera/camera.ts` | orbit 模式在 AR 锚定后仍以真实平面为 target |

---

## 六、分期实施
### P1：WebXR 支持度探针（先行，必做）
- Android 真机 / 模拟器上探测 System WebView WebXR 启用方式（flag / Compat / ROM）
- 输出兼容性矩阵，决策 A 是否可行

### P2：桌面 WebView2 评估
- 确认 WebView2 无 XR 后端 → 永久降级 passthrough

### P3：Android WebView 启用 + 集成（若探针通过）
- 启用 WebXR → 抽象背景源 → 全 WebXR 型或降级共存型
- hit-test 锚定模型到真实平面

### P4：plane 可视化 + 接触阴影替换
- plane detection 生成地面网格，取代 blob shadow

---

## 七、风险与边界
| # | 风险 | 缓解 |
|---|------|------|
| R1 | Android WebView WebXR 默认禁用，启用机制不确定 | P1 探针先行，不通过则转 ADR-073 |
| R2 | iOS Safari 无 WebXR（硬约束） | 永久降级 passthrough |
| R3 | 桌面 WebView2 无 WebXR | 永久降级 passthrough |
| R4 | WebXR 自带 passthrough 与现有 getUserMedia 冲突 | §3.2 抽象背景源接口，二选一 |
| R5 | hit-test 精度受光照 / 纹理影响 | 提供「手动锚定」兜底（点击放置） |

### 边界
- 不追求深度遮挡（需 RGB-D / LiDAR，超范围）
- 不处理多平面复杂场景（取最近 / 最大平面）

---

## 八、未来优化
- **手动锚定兜底**：hit-test 失败时允许用户点屏放置模型
- **持久化锚点**：AR 锚点存入 `.mmascene`（跨会话恢复）—— 关联 ADR-055 §八
- **光照估计**：WebXR `light-estimation` 让模型受真实光影响

---

## 九、与 ADR-055 的关系
本 ADR 是 ADR-055 §3.1 决策第 4 点（「方案 A 可平滑迁移到 WebXR hit-test API」）与 §六 Phase 3（「WebXR 升级」）的**细化落地提案**。
- ADR-055 确立 passthrough 基础（已实施）
- 本 ADR 评估在其上叠加「真·平面检测」的标准浏览器路径
- 若 WebXR 在目标平台不可行，则转向 ADR-073（原生 ARCore / ARKit）

---

## 十、决策状态
🟡 **提案**（2026-07-09）。待 P1 探针结果后批准 / 否决。不阻塞 ADR-055 现有 passthrough 功能。
