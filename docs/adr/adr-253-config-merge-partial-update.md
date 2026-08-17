# ADR-253: 配置部分更新合并契约损坏 —— mergeUIState bool 覆盖 / mergeEnvState 零值覆盖

> **日期**: 2026-08-06（实施完毕 2026-10-22）
> **状态**: ✅ 已完成（2026-08-06 立项；来源审核第 14 轮：`docs/audit/2026-08-06-round14-*.md` Go 后端核心模块审核 P1#1/P1#2。`mergeUIState` 那一半已于 v1.10.0 落地（`docs/releases/v1.10.0.md`），`mergeEnvState` 那一半 2026-10-22 补齐；两半均改用 presence mask 判定「字段是否被显式提供」）
> **编号**: 253
>
> **关联**: [ADR-137](adr-137-envstate-single-source-schema.md)（EnvState 单一源 Schema）、[ADR-214](adr-214-menu-id-naming.md)（frameCapEnabled 兼容迁移先例）、[ADR-171](adr-171-scene-drag-mode.md)（状态单一写入点）
>
> **来源**: 2026-08-06 第 14 轮代码审核——`internal/app/config.go` 两个部分更新合并函数的契约损坏。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据 1：mergeUIState bool 无条件覆盖（修复前代码，现函数位于 `internal/app/config.go:378`）

```go
// bool 字段无零值歧义，直接覆盖（false 是有效值）
dst.Animations = src.Animations
dst.BlurBg = src.BlurBg
dst.AutoCameraEnabled = src.AutoCameraEnabled
dst.AutoUpdateEnabled = src.AutoUpdateEnabled
dst.FrameCapEnabled = src.FrameCapEnabled
// ... 共 13 个 bool 字段
```

前端 `persistUIState`（env-persist.ts:101 `_buildUIStatePayload`）只发「本会话被触碰过的字段」的部分载荷（注释明示「缺省字段保留原值」），而 `restoreUIState`（init.ts:334-466）不把这些 bool 字段回填到前端 uiState 对象 → 载荷中缺失 → Go 侧 unmarshal 得 false → **无条件覆盖掉上一会话持久化的 true**。

| 场景 | 现状行为 | 风险 |
|------|----------|------|
| 用户上次开了动画/模糊/帧率上限，本次只改音量 | `mergeUIState` 收到 `{volume:...}`（bool 字段缺失=0）→ `dst.Animations=false` 等 | 动画/模糊/帧率上限开关**静默重置为 false**，数据丢失且无日志 |
| `SetUIState` 任意部分更新 | 同左，所有未提供的 bool 字段都被清零 | 任何一次无关 UI 持久化都可能毁掉历史设置 |

### 触发证据 2：mergeEnvState JSON round-trip 零值覆盖（修复前代码，现函数位于 `internal/app/config.go:326`）

```go
func mergeEnvState(dst **EnvState, src EnvState) {
	data, err := json.Marshal(src)      // 非 omitempty 字段零值也会序列化
	_ = json.Unmarshal(data, *dst)      // → 覆盖 dst 的对应字段
}
```

EnvState 除 `MirrorPosition`/`LightingPresetName` 外全部**无 omitempty** → src 中零值字段全部写入 dst。「preserving any dst fields not present in src」的文档承诺只在 omitempty 字段成立。现有测试 `TestMergeEnvStateMirrorGeometryFields`（app_test.go:149-192）恰好只断言 omitempty 的 mirrorPosition，形成错误的安全感。

| 场景 | 现状行为 | 风险 |
|------|----------|------|
| 新调用方/AI 桥做部分 env 更新 | src 中零值（skyMode=""、waterEnabled=false 等）覆盖 dst | sky/water/ground/fog 全部持久化环境设置被清空 |
| 当前主流程 | 前端传全量 envState 掩盖问题 | 契约已损坏，新消费方踩雷即爆 |

## 决策

### 决策 1（已修订并落地）：presence mask，而非 bool 改指针

原决策是「13 个 bool 字段改 `*bool`」。实施时**否决了这条路线**，改用 **presence mask**（记录载荷里实际出现了哪些字段名）：

- **判据**：真正要区分的是「字段没出现」与「字段出现且值为 false」，而不是「值是不是 false」。presence mask 在 JSON 层就完成这个区分，**不必把 Go/TS 双侧类型从 `bool` 改成 `*bool`**——省掉 13 个字段的类型双写、wails 绑定重生成，以及前端每个读取点的 `?? true` 兜底。
- **落地**：`UIState.UnmarshalJSON`（`internal/app/app.go:403`）把载荷的 key 集合收进 `UIState.present`（不入 JSON），`mergeUIState`（`internal/app/config.go:378`）用 `hasField(jsonKey, legacyFn)` 判定「该字段是否被显式提供」。
- **null 语义**：JSON `null` 视为「未提供/清空」，不算显式零值（`strings.TrimSpace(raw) == "null"` 跳过），避免 null 把旧值冲成 Go 零值。
- **向后兼容**：`present == nil`（Go 侧直接构造 struct，非 JSON 往返）时退回旧语义——非零标量才复制、bool 无条件复制，与修复前行为一致。
- **与 ADR-214 先例的关系**：`ShowFpsClock`/`ShowRuntimeBadge`/`KeepAwake` 的 `*bool` 解决的是**单字段**的「未设置 vs 显式关闭」；本 ADR 管的是**整表部分更新**。两者是不同问题，不必强行统一到同一手法——`showFpsClock` 这类指针字段是**类型层**的「三态」，presence mask 是**载荷层**的「哪些键在场」，职责不同。

### 决策 2（已修订并落地）：mergeEnvState 改 presence 感知的 JSON 覆盖合并

原决策是二选一「A · 字段级合并（手写 `if src.X != 零值`）/ B · EnvState 全 omitempty + 指针」。实施时**两条都否决**，落地第三种：

| 方案 | 结论 | 理由 |
|------|------|------|
| A · 手写字段级合并 | ❌ 否决 | EnvState 148 字段手写一遍冗长且必然漂移；且「零值即未提供」的判据与**合法零值**（WaterAnimSpeed=0、GroundLevel=0）冲突——`!= 零值` 会把用户显式设置的合法零值当未提供丢掉 |
| B · 全 omitempty + 指针 | ❌ 否决 | **会引入更隐蔽的新 bug**：`omitempty` 让 `false`/0 不进 JSON，Go 侧读不到该键 →「关掉水面」「帧率上限设为 0」永远写不进去。比原缺陷更难查 |
| C · presence mask + JSON 覆盖合并 | ✅ 落地 | 复用决策 1 已验证的 presence 机制；判据是「键是否出现」而非「值是否为零」，合法零值与显式 false 都能持久化 |

落地要点：

- `EnvState.UnmarshalJSON`（`internal/app/app.go:686`）同样收 presence mask（与 `UIState` 同构）；legacy key 命中时（`envIntensity`→`iblIntensity` 等 10 组，ADR-210/212）把**新字段**标记为显式提供，否则 merge 会跳过它，legacy 值掉在合并之外。
- `mergeEnvState`（`internal/app/config.go:326`）改为在 **raw JSON 层**做覆盖：marshal `src` 与 `dst` → `map[string]json.RawMessage` → 只把 `present` 命中的键覆盖到 `dst` → 合并回写。**struct tag 仍是唯一事实源**（与前端序列化用的是同一套 tag），新字段自动参与合并，不需要补手写清单——这是 ADR-234 parity 防线之外的第二道防漂移。
- `present == nil`（Go 侧直接构造）时保留旧的「全量覆盖」语义，向后兼容。

### 决策 3：补回归测试

- `mergeUIState`：部分更新（只含 volume）不得清零 Animations/BlurBg/FrameCapEnabled 等既有 true。✅ 已落地（`internal/app/app_test.go` 4 组）
- `mergeEnvState`：部分更新（只含 skyMode）不得清零 waterEnabled/groundVisibleEnabled 等既有值（补非 omitempty 字段断言，覆盖现有测试盲区）。✅ 已落地（`internal/app/app_test.go` 6 组）

## 实施记录（2026-10-22）

| 落点 | 改动 |
|------|------|
| `internal/app/app.go:677` | `EnvState` 增 `present map[string]bool`（不入 JSON） |
| `internal/app/app.go:686` | `EnvState.UnmarshalJSON` 收 presence mask + 10 组 legacy alias 标记为显式提供 |
| `internal/app/config.go:326` | `mergeEnvState` 改为 presence 感知的 JSON 覆盖合并 |
| `internal/app/app_test.go` | 新增 6 组 `TestMergeEnvState*` 回归 |

**验证**：`go build ./...` ✅ / `go vet ./internal/app/` ✅ / `go test ./internal/...` ✅（14 组 `TestMerge*` 全绿）/ `npm run check:env-parity` ✅（unexported 字段不进 bindings，parity 防线不受影响）。

**过程中的事实修正**：`mergeUIState` 那一半其实早在 v1.10.0 就落地了（`docs/releases/v1.10.0.md:25` 记「改用 presence mask——合法零值与 partial bool 不再丢失」），而 `docs/status.md` 当时仍写「实现分批跟进」——**status.md 滞后于代码**。本 ADR 的真实缺口只有 `mergeEnvState` 一半。教训同 ADR-234 §6.2：**文档里写「要测/要做」远不如 CI 里有一条真正跑的检查**——ADR 状态必须跟着实现走，不能只跟着立项走。

**遗留（非本 ADR 范围）**：前端 `setEnvState({ lightingPresetName: undefined })`（`frontend/src/menus/scene-menu.ts:97`）想清空预设名，但 `undefined` 会被 JSON 序列化丢弃，Go 侧读不到该键 → 旧值留存。前端改用 `null` 或显式空串可解，属独立小改。

## 与其他 ADR 的关系

- 不取代 [ADR-137](adr-137-envstate-single-source-schema.md)——ADR-137 管 EnvState 字段 schema 本身，本 ADR 管持久化合并语义。
- 不取代 [ADR-214](adr-214-menu-id-naming.md)——frameCapEnabled 的 `*bool` 迁移先例（UnmarshalJSON 兼容旧 vsync key）正是决策 1 的范本，本 ADR 是对其模式的推广。

## 影响与验收

- **验收标准**：`go test ./internal/app/ -run TestMerge` 覆盖两个部分更新场景；前端改音量后 `config.json` 中 animations/blurBg/frameCapEnabled 保持上次值。
- **风险**：`*bool` 化后前端所有读取点需 `?? true`/`?? false` 兜底，改动用 codemod 分批；wails 绑定重生成后 `frontend/bindings/` 差异需一并提交。
- **回退**：两决策独立，任一回退不影响另一。
