# ADR-062: 水面反射渲染目标与通用反射系统

> **状态**: 规划（2026-07-08 创建；2026-07-08 通过架构审计，待 POC 前置验证）
> **背景**: 自研 Gerstner 水面着色器已具备波浪/泡沫/焦散/水下等完整能力，唯一硬能力缺口是"模型本体反射"——当前水面仅反射环境 cubemap，不反射场景几何体（PMX 模型等）。Babylon.js 内置 `WaterMaterial` 通过 mirror RT 实现反射，但其波形为简单正弦叠加，无法替换自研 Gerstner 管线。本 ADR 规划：在保留自研水面的前提下，引入可复用的反射 RT 系统，补齐反射能力。
> **范围**: 仅规划，不实现。落地时可沿用本 ADR 编号作前缀（如 ADR-062.1）。

---

## 一、现状核实

| 能力 | 自研水面 | WaterMaterial（Babylon 内置） |
|------|---------|---------------------------|
| Gerstner 波浪 | ✅ 4 层叠加 + 风向联动 | ❌ 仅正弦叠加 |
| 泡沫 | ✅ 基于波高阈值 | ❌ 无 |
| 焦散 | ✅ 双层滚动纹理 | ❌ 无 |
| 水下效果 | ✅ 雾 + 色调 + 色散 | ❌ 无 |
| Fresnel | ✅ 可调 bias/power | ✅ 内置 |
| 模型反射 | ❌ 仅 cubemap | ✅ mirror RT |
| 移动端友好 | ✅ 无额外 RT 开销 | ❌ mirror RT 代价高 |

**结论**：自研水面在波形/特效上全面占优，唯一缺口是模型反射。应定向补齐，而非替换整个材质。

---

## 二、通用反射 RT 系统设计

### 2.1 架构目标

设计一个**与水面解耦的通用反射系统**，可服务于：
- 水面反射（主场景）
- 镜面/金属地板反射（未来扩展）
- 任何需要平面反射的 ShaderMaterial

### 2.2 核心组件

```
ReflectionSystem
├── ReflectionRTManager      # RT 生命周期管理（创建/销毁/resize）
├── MirrorCamera             # 镜像相机（相对反射平面对称）
├── ReflectionFilter         # 渲染过滤（排除反射面自身、远景优化）
└── ReflectionSampler        # 供 Shader 采样的 uniform 接口
```

### 2.3 MirrorCamera 实现

**原理**：创建一个虚拟相机，位置和朝向相对于反射平面（Y=waterLevel）做镜像对称。

```typescript
class MirrorCamera {
    private rt: RenderTargetTexture;
    private mirrorCam: FreeCamera;

    constructor(scene: Scene, plane: Vector4, private resolution: number = 512) {
        // RT：仅渲染反射可见物体
        this.rt = new RenderTargetTexture('reflectionRT', resolution, scene, false);
        this.rt.activeCamera = this.mirrorCam;
        // 裁剪平面：仅渲染水面以上几何，避免湖底/水底杂物反射到水面之上。
        // 必须用 rt.clipPlane（仅作用于本 RT），绝不用 scene.clipPlane（会裁剪主场景）。
        const waterLevel = plane.w;
        this.rt.clipPlane = new Plane(0, 1, 0, -waterLevel); // 保留 y >= waterLevel 一侧
        this.rt.refreshRate = Constants.TEXTUREFRAMEBUFFERRATE_RENDERONCE; // 按需渲染
    }

    /** 每帧更新镜像相机（位置+朝向关于反射平面镜像）。POC 验证见 §七。 */
    update(mainCamera: Camera, waterLevel: number): void {
        const mirrorPlane = new Plane(0, 1, 0, -waterLevel);
        // 用反射矩阵镜像相机世界矩阵，避免手动翻转 upVector 导致的视锥/朝向异常。
        // 反射为 determinant=-1 变换 → 反射 pass 须关闭背面剔除（否则模型呈空洞，见 §七.2）。
        const refl = Matrix.Reflection(mirrorPlane);
        const mirrorWorld = mainCamera.getWorldMatrix().multiply(refl);
        this.mirrorCam.freezeWorldMatrix(mirrorWorld);
    }
}
```

### 2.4 ReflectionFilter（渲染过滤）

反射 RT 不需要渲染所有物体，优化策略：
- **排除反射面自身**：水面 mesh 不加入 `rt.renderList`
- **LOD 降级**：反射中模型可用低精度 mesh
- **距离裁剪**：超出反射有效范围的物体不渲染
- **帧率控制**：非交互时降低刷新率（每 2-4 帧刷新一次）

### 2.5 ReflectionSampler（Shader 接口）

水面着色器通过 uniform 采样反射 RT：

```glsl
// Fragment shader
uniform sampler2D reflectionTexture;  // 反射 RT
uniform float reflectionIntensity;    // 反射强度 0~1
uniform float reflectionFresnel;      // Fresnel 调制

// 在主颜色计算后叠加
vec2 reflectUV = vec2(vScreenCoord.x, 1.0 - vScreenCoord.y); // 翻转 Y
vec3 sceneReflection = texture2D(reflectionTexture, reflectUV).rgb;
float fresnelFactor = pow(1.0 - max(dot(viewDir, normal), 0.0), reflectionFresnel);
vec3 finalColor = mix(waterColor, sceneReflection, fresnelFactor * reflectionIntensity);
```

---

## 2.6 双反射源共存策略（cubemap + planar RT）

水面当前已用 `scene.environmentTexture`（cubemap，由 ADR-024 ReflectionProbe 提供，其 renderList 仅含 sky/env/ground、**不含模型**）做环境反射。引入 planar RT 后两者必须共存：

- **决策：分层混合（单权重，不改动 Fresnel 数学）**
  - 保留现有 cubemap 反射作远景/天空源（planar RT 视锥外区域由 cubemap 兜底，避免黑边）。
  - planar RT 的 `renderList` 含 sky/env/ground + **模型**（不含水面自身），作近景模型反射源。
  - 通过单一新增 uniform `planarReflectBlend`（0~1，默认 0.65）混合，GLSL 改动最小：
    ```glsl
    vec3 planRefl = texture2D(reflectionTexture, reflectUV).rgb;
    vec3 combined = mix(cubemapRefl, planRefl, planarReflectBlend);
    // 原 color = mix(base, combined, fresnel);  Fresnel 调制保持不变
    ```
  - **不采用**"planar RT 完全替换 cubemap"：planar RT 视锥外（屏幕边缘/大视角）会露黑边，cubemap 填补。
  - **不采用**屏幕空间距离 lerp：需额外深度 sampler，P1 不做。
- **UI**：复用现有反射强度滑块驱动 `planarReflectBlend`，无需新增独立控件。

---

## 三、与水面集成

### 3.1 集成点

在 `env-water.ts` 中：
1. 创建 `ReflectionSystem` 实例（水面启用时）；构造时即设置 `rt.clipPlane`（见 §2.3）
2. 每帧调用 `mirrorCamera.update()` （可节流）
3. 水面着色器新增 `reflectionTexture` uniform **与 `planarReflectBlend` uniform**；保留现有 `#ifdef ENV_TEXTURE` cubemap 反射路径（见 §2.6，二者分层混合，不冲突）
4. 水面参数新增 `reflectionIntensity` / `reflectionFresnel` 滑块（驱动 `planarReflectBlend`）
5. 水面禁用或相机远离时释放 RT（节省显存）

### 3.2 性能分级

| 模式 | RT 分辨率 | 刷新率 | 适用场景 |
|------|----------|--------|---------|
| 高 | 512×512 | 每帧 | 桌面端近景 |
| 中 | 256×256 | 每 2 帧 | 桌面端远景 / 中端设备 |
| 低 | 128×128 | 每 4 帧 | 移动端 / Android |
| 关 | — | — | 性能模式 |

### 3.3 与现有管线的兼容

- **Gerstner 波浪**：反射 UV 可叠加波浪偏移（`uv += waveOffset`），增强动态感
- **焦散**：反射与焦散独立，互不干扰
- **泡沫**：泡沫区域可降低反射强度（泡沫覆盖处不需要反射）
- **水下**：水下时自动禁用反射 RT（相机在水面下看不到反射）

---

## 四、通用性设计

### 4.1 ReflectionSystem 作为独立模块

```
frontend/src/scene/env/reflection/
├── reflection-system.ts     # 核心类：MirrorCamera + RT 管理
├── reflection-filter.ts     # 渲染过滤策略
└── reflection-sampler.ts    # Shader uniform 接口
```

- 不依赖 `env-water.ts`，可被任何 ShaderMaterial 引用
- 水面仅是第一个消费者

> **审计决议（2026-07-08）**：不提前抽象为独立 `reflection/` 模块。P1 先在 `env-water.ts` 内联实现（MirrorCamera + RT + clipPlane + 混合），待出现第二个消费者（镜面地板/玻璃窗）再提取到 `reflection/`。避免过早抽象带来的接口返工。

### 4.2 未来扩展场景

| 场景 | 反射平面 | 说明 |
|------|---------|------|
| 水面反射 | Y=waterLevel | 本 ADR 主目标 |
| 镜面地板 | Y=0 | 舞台/展示场景 |
| 金属球/柱 | 球面反射 | 需 cubemap RT（非平面，二期） |
| 玻璃窗 | 任意平面 | 建筑/室内场景 |

平面反射（planar）本 ADR 覆盖；球面/环境反射（cubemap）留二期。

---

## 五、分期路线

| 分期 | 内容 | 预估难度 |
|------|------|---------|
| **P1** | ReflectionSystem 核心（MirrorCamera + RT + 面过滤） | 中 |
| **P1** | 水面着色器集成（uniform + Fresnel 调制） | 低 |
| **P1** | 性能分级（高/中/低/关） | 低 |
| **P2** | 波浪 UV 偏移增强反射动态感 | 低 |
| **P2** | 泡沫区域反射衰减 | 低 |
| **P3** | cubemap RT（球面反射） | 高 |

---

## 六、风险提醒

1. **移动端显存（中）**：512×512 RGBA RT = 1MB 显存，Android 需默认低分辨率。动态 resize 时注意 GC 压力。
2. **镜像相机裁剪（中）**：反射中可能看到场景边界外的物体，需设置合理裁剪距离。
3. **相机移动时的延迟（低）**：镜像相机跟随主相机有 1 帧延迟，快速移动时反射可能"滑动"。可通过预测主相机运动缓解。
4. **与 SSR 的取舍（低）**：屏幕空间反射（SSR）不需要额外 RT，但只能反射屏幕内物体。平面反射 RT 是 SSR 的超集（能反射屏幕外物体），两者可并存但通常只需其一。

---

## 七、POC 前置验证（实施前必做）

架构审计（2026-07-08）指出三处须先验证再落地，POC 通过后方可进入 P1 实现：

1. **clip plane 方案** — 采用 `rt.clipPlane`（仅裁剪 RT，不动主场景），**禁用 `scene.clipPlane`**（会裁剪主视图）；POC 验证水面以下几何不出现在反射中，并确认 `Plane` 符号（`Plane(0,1,0,-waterLevel)` 保留 y≥waterLevel 一侧）与 Babylon 裁剪约定一致（必要时取反）。
2. **镜像相机方向** — 用 `Matrix.Reflection` 镜像相机世界矩阵、**反射 pass 关闭背面剔除**（反射为 determinant=-1 变换，翻转绕序会导致模型背面剔除空洞）；POC 在 empty scene 旋转相机一圈，确认反射为正像（非上下/左右翻转错乱），且模型无空洞。
3. **双反射源混合** — `planarReflectBlend` 默认 0.65，POC 目测近端模型反射与远端天空过渡自然、无黑边/突变。

POC 建议 ≤ 30 行 demo（empty scene + box + 水面平面），预计 0.5 天。

---

## 八、相关 ADR 索引

- [ADR-024](adr-024-rendering-enhancement-phase2-ssr-reflectionprobe.md) — SSR/ReflectionProbe（本 ADR 的替代方案对比）
- [ADR-026](adr-026-environment-system-enhancement.md) — 环境系统增强（水面子系统所属）
- [ADR-028](adr-028-wind-system-unification.md) — 风系统统一（水面风向联动）
- [ADR-047](adr-047-config-persistence-coverage.md) — 持久化覆盖（水面参数序列化）
