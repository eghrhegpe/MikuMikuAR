# ADR-100: 相机系统「控制方案 × 运动行为」双轴拆分

> **状态**: 实施中
> **关联**: ADR-055（AR 相机模式·`CameraMode` 契约）、ADR-070（演唱会/环绕拆分）
> **编号说明**: 原议题拟用 ADR-099，但该号已被 `adr-099-mpr-coop-coep-poc.md` 占用，按「编号唯一」铁律顺延为 ADR-100。

---

## 一、问题

当前 `CameraMode` 单枚举把**两件正交的事**塞进同一个互斥选项，导致一系列「失效 / 冲突 / 语义打架」的怪象：

- **控制方案**（用哪种相机类 + 何种输入）
- **运动行为**（相机如何自动运动）

因两者共用一个枚举位，任意时刻只能选其一，无法组合，衍生出三类症状：

| 症状 | 根因 |
|------|------|
| 演唱会已能自动运镜，`自动运镜` 开关显得多余 | `concert` 本质是「运动行为」，却与 `自动运镜` 这个第四运动行为抢同一台 ArcRotate 相机 |
| `自动运镜` 在 `oneshot`/`surround` 下点了没反应 | 它被绑死在 `_cameraMode === 'orbit' \|\| 'concert'` 判断上，而非「ArcRotate + 有节拍源」这个真正前提（`camera.ts:1178` 区域） |
| `surround` 被自动运镜显式排除（ADR-070 §4.1）、`concert` 却纳入 | 排除逻辑不一致，因为它们在枚举层面无法表达「基座控制 + 可叠加行为」 |

---

## 二、现状证据：7 个「模式」实为两轴混合

`CameraMode = 'orbit' | 'freefly' | 'surround' | 'concert' | 'oneshot' | 'vmd' | 'ar'`
（双写于 `core/types.ts:518` 与 `scene/camera/camera.ts:21`）

| 当前模式 | 相机类 | 输入方式 | 程序化运动 | 真实本质 |
|---------|--------|----------|-----------|---------|
| `orbit` 环绕 | ArcRotate | 指针可拖 | 慢自转 | **控制方案** + 默认自转行为 |
| `freefly` 自由 | Universal | 键鼠飞行 | 无 | **控制方案** |
| `ar` | AR(设备) | 陀螺仪/摄像头 | 无 | **控制方案** |
| `surround` 环绕* | ArcRotate | 无 | 整圈匀速自转 | **运动行为**（转盘） |
| `concert` 演唱会 | ArcRotate | 无 | 扫掠 + 上下摆动 | **运动行为**（跟拍） |
| `vmd` | ArcRotate | 无 | VMD 脚本 | **运动行为**（脚本） |
| `oneshot` 单拍 | ArcRotate | 指针 | 无（预留脚本） | 控制方案（预留） |

`自动运镜`（`_autoCameraEnabled`，`camera.ts:1111`；状态存于 `UIState.autoCameraEnabled/autoCameraBeatsPerSwitch`，`types.ts:322-323`）是**第四个运动行为**（beatcut 节拍切镜），却被做成游离于枚举之外的独立开关，再硬塞进 `orbit/concert` 生效条件里——这是全部症状的结构性来源。

---

## 三、目标架构：两条正交轴

### 轴 A — 控制方案 `CameraControl`（决定相机类 + 输入）

```ts
type CameraControl = 'orbit' | 'freefly' | 'ar';
//  orbit   : ArcRotateCamera + 指针输入（可拖拽/缩放）
//  freefly : UniversalCamera  + 键鼠飞行
//  ar      : AR 相机 + 设备传感器
```

### 轴 B — 运动行为 `CameraBehavior`（仅对 ArcRotate 生效，可独立开关）

```ts
type CameraBehavior =
  | 'none'        // 静止，纯手动指针控制（今 orbit / oneshot 的基座——orbit 实为手动，无内建自转）
  | 'turntable'   // 整圈匀速自转（今 surround）
  | 'concert'     // 扫掠 + 上下摆动（今 concert，ADR-070 语义不变）
  | 'beatcut'     // 节拍切镜（今 自动运镜）
  | 'scripted';   // VMD 脚本（今 vmd / oneshot，含 loop / oneshot 子态，见 §6.4）
```

> **实证更正**：`createOrbitCamera`（`camera.ts:359`）为纯手动 ArcRotate，无自动旋转循环；原草案的 `autorotate` 行为在代码中不存在，故从枚举移除，`orbit` 映射为 `behavior:'none'`。

**组合语义（新架构下旧模式的等价表达）**：

| 旧单模式 | = 控制 A | + 行为 B |
|---------|---------|---------|
| `orbit`（手动） | `orbit` | `none` |
| `surround` | `orbit` | `turntable` |
| `concert` | `orbit` | `concert` |
| `vmd` | `orbit` | `scripted`（子态 loop） |
| `自动运镜`（原叠加态） | `orbit` | `beatcut` |
| `freefly` | `freefly` | `none`（行为轴对 Universal 不适用） |
| `ar` | `ar` | `none`（行为轴对 AR 不适用） |
| `oneshot` | `orbit` | `scripted`（子态 oneshot，决策 #2） |

**关键约束**：行为轴 B 仅当控制轴 A = `orbit`（ArcRotate）时可用。`freefly`(Universal) / `ar` 非 ArcRotate，选中它们时行为轴强制为 `none` 并在 UI 置灰。这正是当前 `surround`/`concert` 被 ArcRotate 绑死、`自动运镜` 又只认 `orbit`/`concert` 的深层原因——拆分后该约束显式化，不再是隐式散落的 `instanceof` 判断。

拆分后「互斥」问题自然消解：
- `orbit + concert` = 今天的演唱会
- `orbit + turntable` = 今天的环绕
- `orbit + beatcut` = 今天的自动运镜（**不再与 concert 抢枚举位**，冲突从架构上消除）
- 是否允许多行为叠加（如 `concert + beatcut`）由 §六 决策：**初版互斥**，只保留单一活动行为，规避 ADR-070 已知的「扫掠途中硬切」不连贯问题。

---

## 四、方案对比

### 方案 A：维持单枚举，仅打补丁（把 beatcut 收窄为仅 orbit）

```
优点：改动最小，1 行修复
缺点：治标不治本，双轴混淆仍在；未来加任何新行为/控制都会重蹈覆辙
结论：❌ 仅作为 §六「过渡期」的临时兜底，非终局
```

### 方案 B：双轴拆分（本 ADR 决策）

```
优点：控制与行为正交，组合自由；beatcut 冲突从根消除；行为轴可扩展（未来加 dolly/crane 等）
缺点：涟漪面大——契约(types×2)/序列化(CameraState)/UI(mode 选择器)/i18n/测试/存档迁移
结论：✅ 采用，分期落地（见 §七）
```

### 方案 C：保留枚举但引入「行为叠加位」（enum + flags 混合）

```
优点：序列化改动小（enum 不变，新增可选 flags 字段）
缺点：概念仍不清晰（orbit 既是控制又隐含 autorotate 行为）；两套心智模型并存，维护成本更高
结论：❌ 半拉子抽象，不如一次拆干净
```

---

## 五、决策

采用 **方案 B**：将 `CameraMode` 单枚举拆为 `CameraControl`（控制方案）× `CameraBehavior`（运动行为）双轴，行为轴仅对 `orbit` 控制生效，初版行为互斥（单一活动行为）。

---

## 六、迁移路径（旧 7 模式 → 新两轴映射）

### 6.1 运行时状态迁移

现有 `let _cameraMode: CameraMode`（`camera.ts:164`）拆为：

```ts
let _cameraControl: CameraControl = 'orbit';
let _cameraBehavior: CameraBehavior = 'none';
```

`switchCameraMode(mode)`（`camera.ts:484`）保留为**兼容 shim**，内部翻译为 `setCameraControl + setCameraBehavior`，避免一次性重写所有调用点（AR 进入/退出的 `_previousMode` 逻辑、VMD 回退等）：

```ts
// 兼容映射表（旧 mode → {control, behavior}）
const LEGACY_MODE_MAP: Record<CameraMode, {control: CameraControl; behavior: CameraBehavior}> = {
  orbit:    { control: 'orbit',   behavior: 'none'      },
  surround: { control: 'orbit',   behavior: 'turntable' },
  concert:  { control: 'orbit',   behavior: 'concert'   },
  vmd:      { control: 'orbit',   behavior: 'scripted'  }, // 子态 loop
  oneshot:  { control: 'orbit',   behavior: 'scripted'  }, // 子态 oneshot（决策 #2）
  freefly:  { control: 'freefly', behavior: 'none'      },
  ar:       { control: 'ar',      behavior: 'none'      },
};
```

`自动运镜` 的 `_autoCameraEnabled=true` → 迁移为 `_cameraBehavior='beatcut'`（当且仅当控制为 `orbit`）。

### 6.2 存档序列化迁移（沿用 ADR-070 探测范式）

`CameraState`（`camera.ts:993`）当前形态：`{ mode: CameraMode; preset: CameraPreset{orbit/freefly/surround/concert}; fov; alpha; beta; radius; target*; position* }`。

新增可选字段，**保持向后兼容**（不删 `mode`，加 `control`/`behavior`）：

```ts
export interface CameraState {
    mode?: CameraMode;          // 保留，旧存档识别用；新存档仍写入等价值供降级兼容
    control?: CameraControl;    // 新
    behavior?: CameraBehavior;  // 新
    preset: CameraPreset;
    // ...其余不变
}
```

`setCameraState`（`camera.ts:1031`）迁移逻辑（在现有 ADR-070 `concert→surround` 探测**之后**追加）：

1. 若存在 `control && behavior` → 新存档，直接用。
2. 否则回退旧 `mode`（经 ADR-070 迁移后的值）→ 查 `LEGACY_MODE_MAP` 得到 `{control, behavior}`。
3. 若旧存档 `UIState.autoCameraEnabled === true` 且映射结果 `control==='orbit'` → `behavior` 覆写为 `'beatcut'`。
4. `preset` 深合并逻辑不变（防 NaN）。

`getCameraState`（`camera.ts:1008`）：新存档同时写入 `control`/`behavior` **和**降级用的等价 `mode`（取 `LEGACY_MODE_MAP` 反查），保证旧版本读新档不炸。

> `UIState.autoCameraEnabled/autoCameraBeatsPerSwitch`（`types.ts:322-323`）：`beatsPerSwitch` 保留为 `beatcut` 行为的参数；`autoCameraEnabled` 标记为 `@deprecated`，仅读不写，读到后按上述步骤 3 迁移。

### 6.3 对 ADR-070 的影响评估

- ADR-070 的**运动公式与语义完全保留**：`concert`（扫掠+摆动）、`surround`（整圈自转）原样成为行为轴的 `concert`/`turntable`。
- ADR-070 §4.1「`surround` 不纳入自动运镜」的**特殊排除逻辑可删除**：新架构下行为互斥（同一时刻仅一个行为活动），`turntable` 与 `beatcut` 天然不会共存，无需 `if (mode !== 'surround')` 硬编码排除。
- ADR-070 §五的 `concert→surround` 存档迁移**必须保留并前置**于本 ADR 的映射（先把旧 concert 整圈形态归位为 surround，再映射到 `turntable`）。
- 建议在 ADR-070 文件头补一行修订注记：「运动语义于 ADR-100 升级为『运动行为轴』，本文档公式仍为权威实现来源」。

---

## 七、影响面与分期实施

### 7.1 涟漪清单

| 层 | 文件 | 改动 |
|----|------|------|
| 契约 | `core/types.ts`、`scene/camera/camera.ts`（双写 CameraMode） | 新增 `CameraControl`/`CameraBehavior`；`CameraMode` 降级为 `@deprecated` 兼容别名 |
| 运行时 | `scene/camera/camera.ts` | `_cameraMode` 拆双变量；`switchCameraMode` 转 shim；`_onAutoCameraBeat` 生效条件改判 `_cameraBehavior==='beatcut'` |
| 序列化 | `scene/camera/camera.ts` `get/setCameraState` | 新增 control/behavior 字段 + 迁移逻辑（§6.2） |
| UI | `menus/motion-camera-levels.ts` | 模式单选（`:77-85`）拆为「控制方案」+「运动行为」两级；行为轴在非 orbit 时置灰；`自动运镜` toggle（`:134`）降级为行为轴的 `beatcut` 选项 |
| i18n | zh-CN/zh-TW/en/ja/ko | 新增 `motion.control*`/`motion.behavior*` 系列 key；旧 `motion.autoCamera`/`camSurround` 等保留（复用为行为标签） |
| 绑定 mock | `__tests__/mocks/binding-factories.ts` | `autoCameraEnabled/beatsPerSwitch`（`:58-59`）保留，补 control/behavior 默认 |
| 测试 | `__tests__/camera.test.ts` | 补双轴 getter/setter、LEGACY_MODE_MAP 映射、存档往返迁移断言；旧 44 项经 shim 应全绿 |

### 7.2 分期

| 阶段 | 内容 | 可独立验证 | 状态 |
|------|------|-----------|------|
| **P1 契约 + shim** | 定义双轴类型；`switchCameraMode` 转 shim；旧枚举保留别名 | 旧测试全绿（零行为变化） | ✅ 已完成 |
| **P2 运行时接线** | `beatcut` 生效条件改判 `_cameraBehavior==='beatcut'`；beatcut 与 concert/turntable 互斥（选中即停对方）；beatcut 订阅集中到 camera 内部并覆盖 restore 路径（解决「饿死」） | 单元测试 + 手动切镜 | ✅ 已完成 |
| **P3 序列化迁移** | `get/setCameraState` 双写 + 迁移；旧存档往返测试 | camera.test 往返断言 | ✅ 已完成 |
| **P4 UI 重构** | 控制/行为两级选择器；`自动运镜` toggle 降级为行为选项；置灰约束 | 手动 UX 走查 | ✅ 已完成 |
| **P5 收尾** | `CameraMode` 别名清理评估（保留别名，附理由）；ADR-070 补注记；文档同步 | check + build | ✅ 已完成 |

#### P1–P2 实现落点（供 P3+ 续接）

| 关注点 | 位置 |
|--------|------|
| 双轴类型 + `LEGACY_MODE_MAP` + `deriveLegacyMode` | `frontend/src/scene/camera/camera.ts` §Types（同步双写 `core/types.ts`）|
| 单一写入点 `_syncAxesFromMode` + `_resolveBehavior`（beatcut 叠加/互斥派生）| `camera.ts` line ~231 |
| 集中订阅 `_subscribeAutoCameraBeat` / `_unsubscribeAutoCameraBeat`（缺省回退 `getProcBeatDetector()`）| `camera.ts` line ~1216 |
| restore 饿死修复 | `restoreAutoCameraState`（`camera.ts`）恢复时调 `_subscribeAutoCameraBeat()` + `_syncAxesFromMode` |
| 门控改判 `_cameraBehavior !== 'beatcut'`（抑制期不消耗 beat 计数）| `_onAutoCameraBeat`（`camera.ts`）|
| 单测 | `camera.test.ts` 新增 11 例（6 映射 + 5 beatcut 运行时）；mock 须用 `@/scene/scene`、`@/core/config` 别名规格匹配 camera 实际导入 |

> **互斥语义（P2 实现细节）**：beatcut 作为**运行时叠加行为**，仅在 `control==='orbit' && 基底行为==='none'` 时由 `_resolveBehavior` 派生。切到 concert/turntable/scripted 时基底行为非 none → 不派生 beatcut（自动抑制，`_autoCameraEnabled` 保留、切回 orbit 自动恢复）。已知限制：在 concert 模式下开启「自动运镜」toggle 会保持挂起态直至切回 orbit——P4 UI 重构将以两级选择器从源头消除该组合。

> **修订（2026-07-13, P4 后）**：P4 `setCameraControl`（`camera.ts:397`）在 `control!=='orbit'` 时显式 `setAutoCameraEnabled(false)`，使 `_autoCameraEnabled` 标志在**离开 orbit 的瞬间即被清除**。因此上段「切回 orbit 自动恢复 beatcut」在 P4 交互路径下**不再成立**——离 orbit 后 beatcut 被丢弃，回 orbit 不会自动恢复，需用户在行为轴重新选择 `beatcut`。此为显性双轴模型的**预期行为**（行为轴是独立状态，而非 orbit 的隐式挂起态）。`_resolveBehavior` 的自动恢复机制仍存于代码，但 P4 的显式清除使其在该路径下不再触发。`setCameraState` 的序列化双写不受影响——显式 `behavior:'beatcut'` 仍精确还原。

---

## 八、风险与权衡

| 风险 | 等级 | 缓解 |
|------|------|------|
| 一次性重写 `switchCameraMode` 所有调用点易漏（AR 进出/VMD 回退/reset） | 🟠 高 | P1 用 shim 保持旧签名，调用点零改动，行为等价先验证 |
| 存档双写导致新旧版本互读边界 case | 🟡 中 | `get` 同时写 `mode`+`control`+`behavior`；`set` 按「新字段优先、旧字段兜底」；补往返测试 |
| beatcut 节拍源「饿死」 | 🟠 高 | **实证更正**：`procBeatDetector` 于 scene 初始化即创建（`scene.ts:191`）并在播放时逐帧 `update()`（`playback.ts:67`），全局常驻——非「仅程序化动作时创建」。真实饿死点仅在**存档恢复**：`restoreAutoCameraState`（`camera.ts:1118`）置 `_autoCameraEnabled=true` 却从不订阅 `onBeat`。P2 将 beatcut 的订阅集中到 camera 内部（经 `getProcBeatDetector`），同时覆盖 toggle 与 restore 两条路径。 |
| 行为叠加需求反复（是否允许 concert+beatcut 共存） | 🟢 低 | 初版明确互斥；若未来需要叠加，行为轴改为 `Set<CameraBehavior>` 是增量演进，不推翻本 ADR |
| UI 从「1 个选择器」变「2 级」增加操作深度 | 🟡 中 | 控制轴默认 orbit，行为轴平铺在同卡片；核心路径仍 ≤3 层（符合 AGENTS UX 审核标准） |

---

## 九、决策裁定（Ling 已拍板 2026-07-13）

| # | 议题 | 裁定 |
|---|------|------|
| 1 | 行为是否允许叠加 | **互斥**：同一时刻仅一个活动行为（`_cameraBehavior` 单值），规避 ADR-070「扫掠途中硬切」不连贯。若未来需叠加，改 `Set<CameraBehavior>` 为增量演进，不推翻本 ADR。 |
| 2 | `oneshot` 归宿 | **直接实现为 `scripted` 单拍变体**：`oneshot` 不再映射 `none`，而是 `behavior='scripted'`；`scripted` 内部区分「循环 VMD」与「单拍定格」两态（见 §6.4）。`LEGACY_MODE_MAP.oneshot` 相应改为 `{control:'orbit', behavior:'scripted'}`。 |
| 3 | `CameraMode` 别名清理时机 | **保留兼容别名至全部调用点迁移完**（P1 不清理），别名清理评估延后至 P5。 |
| 4 | 落地节奏 | **先 P1–P2**（契约 + shim + 运行时接线）验证组合可行，再续 P3–P5。 |

### 6.4 `scripted` 单拍/循环双态（承决策 #2）

`oneshot`（单拍）与 `vmd`（循环脚本）统一收敛到 `behavior='scripted'`，由子状态区分：

```ts
// scripted 行为的子模式（camera.ts 内部状态）
type ScriptedSubMode = 'loop' | 'oneshot';
//  loop    : VMD 相机脚本随播放循环驱动（今 vmd）
//  oneshot : 加载 VMD 后仅取首帧/指定帧定格，不随播放推进（今 oneshot 的预留语义落地）
```

- `LEGACY_MODE_MAP`：`vmd → {orbit, scripted}`（子态 loop）；`oneshot → {orbit, scripted}`（子态 oneshot）。
- 迁移探测：旧 `mode==='oneshot'` → `behavior='scripted'` + `scriptedSubMode='oneshot'`。
- P1-P2 仅落地类型与映射；`oneshot` 定格的具体取帧实现随 P4 行为完善（本轮保持「加载即定格首帧」的最小语义）。

---

## 十、P5 别名清理评估（`CameraMode` 兼容别名）

### 10.1 现状清点（P3–P4 落地后）

| 别名/旧入口 | 当前去向 | 是否仍被引用 |
|------------|---------|-------------|
| `CameraMode` 类型（deprecated） | 仍作为 `switchCameraMode` / `_cameraMode` / `LEGACY_MODE_MAP` 键 / `deriveLegacyMode` 反查 / `CameraState.mode` 的兼容字段 | 是（核心迁移枢纽，删除即破坏存档与 shim） |
| `switchCameraMode(mode)` shim | 内部仍由 `_syncAxesFromMode` 派生双轴；P4 UI 已改用 `setCameraControl`/`setCameraBehavior` | 是（AR 进出、`restoreAutoCameraState`、VMD 回退等调用点仍走 shim） |
| `UIState.autoCameraEnabled` / `autoCameraBeatsPerSwitch` | 保留为「只读兼容」：beatcut 行为的等价来源；P4 由 `behavior==='beatcut'` 表达，但旧存档仍靠此 flag 叠加 | 是（存档迁移依赖） |
| `getCameraMode()` | 返回 `_cameraMode`（deprecated 别名）；P4 UI 改用 `getCameraControl`/`getCameraBehavior` | 是（其他遗留调用点） |

### 10.2 评估结论

**保留 `CameraMode` 别名与 shim，本次不清理。** 理由：

1. **迁移枢纽不可断**：`LEGACY_MODE_MAP` / `deriveLegacyMode` / `CameraState.mode` 全部以 `CameraMode` 为键或兼容字段。删除别名须同步重写这三处 + 所有 `switchCameraMode` 调用点（AR 进出 / VMD 回退 / reset），属一次性大重构，与「双轴已落地、组合已验证」的当前目标正交，风险/收益比不划算。
2. **向后兼容价值仍在**：旧存档（仅含 `mode`）经 `setCameraState` 兜底路径仍能正确迁移（P3 已验证）；旧版本读取新存档时 `CameraState.mode` 降级字段保证不炸。清理别名会切断这条降级链。
3. **`autoCameraEnabled` flag 同理**：它是旧存档 beatcut 的唯一来源（P3 §6.2 step3），去掉后旧存档自动运镜丢失。须待「全量存档已含 `behavior` 字段」的版本普及后再评估移除。

### 10.3 未来移除路径（增量演进，非阻断）

当且仅当同时满足以下条件时，可启动别名清理：

- 新存档格式（含 `control`/`behavior`）已通过至少一个大版本发布，旧 `mode`-only 存档在生产中可忽略；
- 全部 `switchCameraMode` 调用点已改为 `setCameraControl`/`setCameraBehavior`（shim 内联）；
- `UIState.autoCameraEnabled` 已确认无旧存档依赖（或提供一次性迁移脚本）。

届时清理内容：删除 `CameraMode` 类型与 `CameraState.mode`；`switchCameraMode` 退化为内部 helper 或直接删除；`LEGACY_MODE_MAP`/`deriveLegacyMode` 收敛为仅存档导入期一次性探测（迁入 `setCameraState` 入口）。本 ADR 不阻塞该演进，仅明确「当前不清理」的裁定。
