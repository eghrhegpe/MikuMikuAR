# ADR-070: 相机模式「演唱会」语义重构（拆分出「环绕」模式）

> **状态**: 已实施
> **关联**: ADR-055（AR 相机模式·`CameraMode` 契约）

---

## 一、问题

原 `concert` 相机模式**命名与实现严重不符**：

| 维度 | 原 `concert` 实现（`startConcert`） | 「演唱会」应有的镜头语言 |
|------|--------------------------------------|--------------------------|
| 水平角度 | `alpha = -π/2 + t·speed`，**无限制整圈 360° 自转** | **±60°（共 120°）扫掠限位**，前排粉丝机位左右摇摄 |
| 垂直视野 | `beta` 被**硬编码 `π/3` 不变** | **正弦上下摆动**，模拟手持设备晃动 / 跟拍升降台 |
| 运动质感 | 恒定角速度转盘 | sin 在两端自然减速的「扫视」手感 |

实质问题：原 `concert` 只是个转台/环绕模式，与此前用户期望的演唱会镜头语言无关。

---

## 二、方案对比

### 方案 A：原地改写 `concert` 为 fan-cam

```
优点：改动集中，无新增模式
缺点：旧的整圈自转能力丢失，部分用户已有的「转台」使用场景断层
结论：❌ 牺牲既有能力
```

### 方案 B：拆分 —— 旧整圈行为独立为「环绕（`surround`）」，`concert` 重定义为粉丝机位

```
优点：命名诚实（环绕≠演唱会）；旧能力以独立模式保留；concert 获得真实语义
缺点：需新增一个 CameraMode id，涟漪到 union / UI / i18n / 测试 / 存档迁移
结论：✅ 采用
```

### 方案 C：仅改名不改逻辑（「演唱会」→「环绕」）

```
优点：成本最低
缺点：丧失用户期望的演唱会镜头语言
结论：❌ 未解决核心诉求
```

---

## 三、决策

采用 **方案 B**：

- 新增模式 **`surround`**（id `'surround'`，UI 文案「环绕」），承载原整圈自转行为。
- `concert` 重定义为 **粉丝机位（fan-cam）**：水平限角度扫掠 + 正弦上下摆动。

---

## 四、实施细节

### 4.1 `scene/camera/camera.ts`

- 新增 `SurroundParams { radius; height; speed }`（原 `ConcertParams` 形态）。
- `ConcertParams` 重构为：`{ radius; height; sweepAngle; sweepSpeed; baseBeta; bobAmplitude; bobSpeed }`。
- `CameraPreset` 增加 `surround` 子对象；`defaultCameraPreset()` 补 `surround` 默认与新的 `concert` 默认（sweepAngle 120、sweepSpeed 0.6、baseBeta π/3、bobAmplitude 12、bobSpeed 0.7）。
- `switchCameraMode` 增加 `surround` 的 create/start/stop 分支；`_onAutoCameraBeat` 仍只对 `orbit`/`concert` 生效（自转/扫掠与预设切歌互斥，surround 不纳入）。
- 共享暂停标志 `_concertPaused`：`getSurroundPaused`/`setSurroundPaused` 复用之。

**运动公式**

```
surround:  angle += animRatio · speed · dt/1000
           alpha = -π/2 + angle ;  beta = π/3            （整圈匀速自转）

concert:   alpha = -π/2 + (sweepAngle/2) · sin(t · sweepSpeed)   （水平限角扫掠）
           beta  = baseBeta + bobAmplitude · sin(t · bobSpeed)    （正弦上下摆动）
           t    += animRatio · dt/1000
```

### 4.2 `menus/motion-camera-levels.ts`

- 模式列表新增 `{ value: 'surround', label: t('motion.camSurround') }`。
- `renderSurroundParams`：轨道半径 / 目标高度 / 旋转速度 / 暂停。
- `renderConcertParams`：轨道半径 / 目标高度 / **扫掠角度** / **扫掠速度** / **中心俯仰** / **上下摆幅** / **上下频率** / 暂停。

### 4.3 `core/types.ts`

`CameraMode` 补 `'surround'`，并补齐此前缺失的 `'vmd'`/`'ar'`，消除与 `camera.ts` 契约的历史不一致。

### 4.4 i18n（zh-CN / zh-TW / en / ja / ko）

新增：`camSurround`、`camSurroundSettings`、`sweepAngle`、`sweepSpeed`、`basePitch`、`bobAmplitude`、`bobSpeed`。

---

## 五、迁移与兼容性

旧场景存档的 `concert` 预设为 `{radius, height, speed}` 形态（无 `sweepAngle`）。`setCameraState` 在加载时：

1. 识别旧 schema（`'speed' in concert && !('sweepAngle' in concert)`）→ 将其字段迁移为 `surround`，并将存档 `mode` 由 `concert` 重定向为 `surround`；
2. 将加载预设**深合并**到 `defaultCameraPreset()`，补齐缺失字段，防止新公式读取 `undefined` 产生 `NaN`。

新存档的 `concert` 即为粉丝机位语义，符合预期。

---

## 六、验证

- `npm run check`（tsc）：通过，无类型错误。
- `src/__tests__/camera.test.ts`：44 项全部通过（含 surround 新增 getter/setter、concert 新字段断言、validModes 扩充）。
- `src/__tests__/model-ops.test.ts`：36 项通过。
