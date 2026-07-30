# ADR-210: 环境光照字段名名实相符重命名（envIntensity/envBrightness）

- **状态**: ✅ 已完成
- **日期**: 2026-07-30
- **相关**: ADR-132（envBrightness 全局明暗基准）、ADR-137（EnvState 单一源 Schema）、ADR-173（setEnvState middleware）
- **源码锚点**: `core/env-state-schema.ts`、`scene/env/env-bridge.ts:_migrators`、`internal/app/app.go:EnvState.UnmarshalJSON`

## 背景

天空菜单三个光照滑块的字段名与真实语义不符，误导性强（UI 文案改名见前序 i18n 提交）：

| 旧字段名 | 字面歧义 | 实际语义 |
|----------|----------|----------|
| `envIntensity` | "环境光强度" | IBL 环境反射强度，写入 `scene.environmentIntensity`（金属反光/PBR 环境光贡献） |
| `envBrightness` | "环境亮度" | 全局明暗总倍数，乘进天空/云/水/主光/环境光的最终亮度 |

两者并列（一个 Intensity 一个 Brightness、词根都是 `env`），字面近义但职责完全不同——一个是 IBL 反射**输入**强度，一个是全局亮度**输出**倍数，任何读者都易混淆。

额外陷阱：`envIntensity` 这个名字被**两处不同语义**占用——`envState.envIntensity`（IBL 强度）与 water shader 的 `mat.setFloat('envIntensity', ...)` uniform（水面 cubemap 反射强度，见 `water.frag.glsl`）恰好同名但互不相关。任何无脑全局改名都会误伤 shader uniform。

## 决策

重命名两个 envState 字段，`skyBrightness` 保持不动（其名本就准确，只管天空盒渐变亮度）：

| 旧名 | 新名 | 语义 |
|------|------|------|
| `envIntensity` | `iblIntensity` | IBL 环境反射强度 |
| `envBrightness` | `globalBrightness` | 全局明暗总倍数 |

### 1. 前端 Schema 与消费点

- `core/env-state-schema.ts`：字段改名 + 补语义注释（含"与 water shader 同名 uniform 无关"警示）。
- `core/state.ts`：`buildDefaultEnvState` 同步。
- 消费点：`env-sky.ts`、`env-clouds.ts`、`env-bridge.ts`（含 `changed.has('globalBrightness')` dispatch key）、`env-lighting.ts`（天空预设快照字段清单）、`env-time-of-day.ts`（预设动画 setEnvState）、`render/lighting.ts`、`menus/env-sky-levels.ts`（bind）、`menus/env-preset-levels.ts`（7 个内置预设数据）。
- **water shader uniform `'envIntensity'` 保留不动**（`env-water.ts` 三处），它不是 envState 字段。

### 2. 前端存档迁移（env-bridge `_migrators`）

复用 ADR 既有的 `_migrators` 机制新增两个迁移器 `migrateIblIntensity` / `migrateGlobalBrightness`：旧存档经 `setEnvState(loaded)` 时，`envIntensity → iblIntensity`、`envBrightness → globalBrightness` 自动转换并删除旧 key。

### 3. Go 后端跨语言契约（关键）

`internal/app/app.go` 的 `EnvState` 结构体 JSON tag 同步改名（`iblIntensity`/`globalBrightness`）。为兼容旧 `config.json`（持久化了旧 key），新增 `EnvState.UnmarshalJSON`：读取时同时接收旧 key（`envIntensity`/`envBrightness`）作为 fallback，新 key 优先。若无此兜底，Go 读旧盘时这两字段会静默归零，用户设置丢失。

## 影响

- 变量名名实相符：`iblIntensity`（反射输入）与 `globalBrightness`（亮度输出）语义清晰，消除 `env*` 双字段歧义。
- 双向兼容：前端内存态迁移（_migrators）+ Go 读盘兼容（UnmarshalJSON），新旧存档无损。
- water shader uniform 零误伤。

## 测试

- `go build ./...` 通过。
- 前端相关单测全过：`env-state.test.ts`、`env-bridge/*.int.test.ts`、`bindings/app.contract.test.ts`、`env-feature-levels.contract.test.ts`（含预设应用、facade ambientColor 由 iblIntensity 驱动、绑定契约）共 100 项。
- 契约测试断言字段由 `envIntensity` 改为 `iblIntensity`；mock 工厂同步。

## 备注

局部变量名 `envBrightness`（函数内临时）、`rebakeEnvBrightness`、`_prevEnvBrightness` 保留未改——它们是内部实现命名、不参与持久化 key、语义（"重算亮度"）不误导，改动收益低而波及面大。

> **遗留交叉引用（审核补充）**：`globalBrightness` 名为「全局」但 `group: 'sky'`（env-state-schema.ts:50），dispatch 与命名仍存在错位——修改 `skyColor` 时触发重烘焙，命名说"全局"却和天空绑一起。本 ADR 仅改名未修 `group`，该错位由 ADR-212（命名 vs 功能审计）问题 5 记录为 P2「注释澄清」项，属独立决策链，不在本次范围。
