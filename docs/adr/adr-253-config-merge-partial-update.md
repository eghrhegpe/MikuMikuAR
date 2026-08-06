# ADR-253: 配置部分更新合并契约损坏 —— mergeUIState bool 覆盖 / mergeEnvState 零值覆盖

> **日期**: 2026-08-06
> **状态**: ✅ 已立（2026-08-06 立项；来源审核第 14 轮：`docs/audit/2026-08-06-round14-*.md` Go 后端核心模块审核 P1#1/P1#2）。本 ADR 固化缺陷认知与治理方案，实现分批跟进
> **编号**: 253
>
> **关联**: [ADR-137](adr-137-envstate-single-source-schema.md)（EnvState 单一源 Schema）、[ADR-214](adr-214-menu-id-naming.md)（frameCapEnabled 兼容迁移先例）、[ADR-171](adr-171-scene-drag-mode.md)（状态单一写入点）
>
> **来源**: 2026-08-06 第 14 轮代码审核——`internal/app/config.go` 两个部分更新合并函数的契约损坏。

**决策者**: AtomCode（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

---

## 背景

### 触发证据 1：mergeUIState bool 无条件覆盖（config.go:338-421）

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

### 触发证据 2：mergeEnvState JSON round-trip 零值覆盖（config.go:314-324）

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

### 决策 1：bool 字段改指针（与 showFpsClock/KeepAwake 先例一致）

`mergeUIState` 涉及的 13 个 bool 字段（Animations/BlurBg/AutoCameraEnabled/AutoUpdateEnabled/FrameCapEnabled/DefaultPhysicsEnabled/InvertYAxis/AutoScaleModel/AutoCenterModel/BpmQuantizeEnabled/AutoLoadCompanionAudio/SfxEnabled/FootstepEnabled）改为 `*bool`，merge 时 `if src.X != nil { dst.X = src.X }`。

- 已有先例：`ShowFpsClock`/`ShowRuntimeBadge`/`KeepAwake` 均为 `*bool`（注释「使用指针以区分未设置与显式关闭」）。
- 需同步：Go struct + `frontend/src/core/types.ts` UIState 双写 + wails 绑定重生成 + 消费点适配（前端读 `?? true` 兜底）。
- 批量化建议：一次改完 13 个字段（避免混合状态），用 codemod `add-param` 不宜，直接手改 + 前端类型同步。

### 决策 2：mergeEnvState 改字段级合并或 EnvState 全 omitempty

二选一（实现时选改动小的）：

| 方案 | 做法 | 代价 |
|------|------|------|
| A · 字段级合并 | 手写 `if src.X != 零值 { dst.X = src.X }`（与 mergeUIState 非 bool 部分同风格） | EnvState 字段多（30+），手写冗长但明确 |
| B · 全 omitempty + 指针 | EnvState 所有字段加 omitempty，零值歧义字段（bool/数值）改指针 | 改动面大，但一劳永逸 |

### 决策 3：补回归测试

- `mergeUIState`：部分更新（只含 volume）不得清零 Animations/BlurBg/FrameCapEnabled 等既有 true。
- `mergeEnvState`：部分更新（只含 skyMode）不得清零 waterEnabled/groundVisibleEnabled 等既有值（补非 omitempty 字段断言，覆盖现有测试盲区）。

## 与其他 ADR 的关系

- 不取代 [ADR-137](adr-137-envstate-single-source-schema.md)——ADR-137 管 EnvState 字段 schema 本身，本 ADR 管持久化合并语义。
- 不取代 [ADR-214](adr-214-menu-id-naming.md)——frameCapEnabled 的 `*bool` 迁移先例（UnmarshalJSON 兼容旧 vsync key）正是决策 1 的范本，本 ADR 是对其模式的推广。

## 影响与验收

- **验收标准**：`go test ./internal/app/ -run TestMerge` 覆盖两个部分更新场景；前端改音量后 `config.json` 中 animations/blurBg/frameCapEnabled 保持上次值。
- **风险**：`*bool` 化后前端所有读取点需 `?? true`/`?? false` 兜底，改动用 codemod 分批；wails 绑定重生成后 `frontend/bindings/` 差异需一并提交。
- **回退**：两决策独立，任一回退不影响另一。
