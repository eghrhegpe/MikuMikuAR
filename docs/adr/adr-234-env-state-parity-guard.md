# ADR-234: env-state ↔ Go EnvState 字段 parity 防线 —— 用检查脚本终结「TS 加字段、Go 忘同步」

> **状态**: ✅ 已完成（2026-08-02 落地，check:docs 全链绿）
> **日期**: 2026-08-02
>
> **编号**: 234
>
> **关联**: [ADR-137](adr-137-envstate-single-source-schema.md)（EnvState 单一源 Schema——本 ADR 落地其 §3.4 承诺但从未实现的字段级 parity 契约测试，**非取代**）、[ADR-231](adr-231-ground-visual-roadmap.md)（地面视觉后续方向，`groundEmissive*` 自发光地屏字段即其规划落地时产生的漂移源）、[ADR-212](adr-212-naming-vs-functionality-audit.md)（命名/功能审计）
>
> **来源**: 2026-08-02 修复镜面几何参数持久化缺失（buglog `2026-08-02-mirror-geometry-persist-gap.md`）时发现：`mirrorWidth/Height/Position/RotationY` 与 `groundEmissive*` 两组共 8 个字段先后静默漂移——TS `env-state-schema.ts` 已注册、Go `EnvState` 结构体未同步，导致 `SetEnvState` 的 JSON round-trip 静默丢弃，config.json 持久化断链、重启回默认值。

**决策者**: Riku（联邦首席架构师 AI）、Jieling（人类侧首席架构师）

**创建日期**: 2026-08-02

---

## 1. 背景

`EnvState` 存在**双源**：TS 侧 `env-state-schema.ts`（权威源，148 字段）与 Go 侧 `internal/app/app.go` 的 `EnvState` 结构体（config.json 持久化承载面）。两者靠**手工同步**：

- 前端 `setEnvState` → `persistEnvState` → Go `SetEnvState` → `mergeEnvState` 走 JSON round-trip（`config.go:286`）
- Go 结构体没有的字段在 `json.Unmarshal` 时被**静默丢弃**——不报错、不告警，config.json 里永远存不下该字段
- 启动 `restoreEnvState`（`init.ts`，注释标注为 authoritative 恢复源）读回 `cfg.env`，缺失字段回落到 schema 默认值

ADR-137 §3.4 当年承诺在 `app.contract.test.ts` 增加「字段级 parity 测试」（遍历 TS schema 所有 key 验证 Go EnvState JSON 输出包含同名字段），**但从未真正落地**：实测 `app.contract.test.ts` 的 EnvState 用例只是 `createMockEnvState()` 的 `toMatchObject` 抽查，抽查列表到 `fogEnd` 截止，mirror 五个字段一个未列；mock 工厂 `binding-factories.ts` 同样缺字段——**防线形同虚设，mock 本身在撒谎**。

### 已发生的漂移（全部为 TS 有、Go 无）

| 批次 | 字段 | 来源 | 影响 |
|------|------|------|------|
| 第 1 次 | `qualityProfile` | ADR-130 Phase 2.3 | 已补（ADR-137 自述） |
| 第 2 次 | `groundInfinite` | ADR-114 Phase 2 | 已补（ADR-137 自述） |
| 第 3 次 | `mirrorWidth/Height/Position/RotationY` | 镜面几何迁入 envState | **本次修复**（buglog 2026-08-02-mirror-geometry-persist-gap） |
| 第 4 次 | `groundEmissiveColor/Strength/ReflectMix/Texture` | ADR-230/231 自发光地屏 | **本次顺带修复** |

同一根因翻车 4 次——不是运气差，是承诺的防线从未建立。

## 2. 决策

**不引入 Go codegen**（沿用 ADR-137 §5 否决理由：维护成本高于收益，手写 Go struct 已稳定），而是落地一个**低成本字段级 parity 检查脚本**，挂入既有 `check:docs` 链：

1. **新增 `scripts/check-env-parity.mjs`**：解析 `env-state-schema.ts` 顶层字段（权威源）与 Wails 生成的 `frontend/bindings/.../models.ts` 的 `EnvState` 接口字段（Go 结构体的自动镜像），做**双向 key diff**：
   - schema-only（TS 有、Go 无）→ 报错：config 持久化断链，须补 Go 字段
   - bind-only（Go 有、TS 无）→ 报错：Go 残留死字段或 TS 漏注册
   - 豁免表（`EXEMPT_SCHEMA_ONLY` / `EXEMPT_BIND_ONLY`）承载**已确认合理差异**，每条带原因
2. **挂入 `check:docs`**（warning 模式，与 `check-schema-groups.mjs` 一致）+ 独立 `check:env-parity`（`--strict` 阻断 CI）
3. **顺带修复第 4 次漂移**：Go `EnvState` 补 `GroundEmissive*` 4 字段 + 重新生成 bindings + mock 补齐

**为什么选 bindings 而非直接解析 app.go**：bindings/models.ts 由 `wails3 generate bindings` 自动生成，是 Go 结构体的**权威镜像**，解析接口字段比解析 Go 源码更稳、且天然覆盖「结构体改了但忘生成 bindings」这类二次漂移。

## 3. 方案详述

### 3.1 脚本设计

```bash
node scripts/check-env-parity.mjs           # warning 模式（check:docs 链内）
node scripts/check-env-parity.mjs --strict  # 未豁免漂移即 exit 1（CI）
```

数据源解析：
- schema：定位 `export const ENV_STATE_SCHEMA = {` 后按 4 空格缩进顶层字段 `name: {` 提取
- bindings：定位 `export interface EnvState {` 提取 `"name":` 与 `"name"?:`（可空字段带 `?`，正则须兼容，否则 `mirrorPosition`/`lightingPresetName` 被误报——首版脚本踩过此坑）

输出三类信息：字段计数对比、豁免清单（含原因）、未豁免漂移（含后果说明与修复指引）。

### 3.2 豁免表（首版）

```ts
// bind-only（Go 有、TS 无，均为死字段残留，非新漂移）
EXEMPT_BIND_ONLY = new Map([
    ['underwaterFogDensity',   'ADR-216 死字段：schema 已删，Go 残留未清理'],
    ['underwaterFogMultiplier','ADR-216 死字段：schema 已删，Go 残留未清理'],
    ['waterFogDensity',        '死字段：schema 从未有，Go 残留，frontend 零消费'],
]);
```

豁免是**显式登记**而非掩盖：脚本输出会列出豁免项及原因，后续清理死字段时可直接从豁免表移除并同步删 Go 字段。

### 3.3 代码落点

| 文件 | 改动 |
|------|------|
| `scripts/check-env-parity.mjs` | **新增**，~150 行 |
| `package.json` | `check:docs` 链插入 + 新增 `check:env-parity` 脚本 |
| `internal/app/app.go` | `EnvState` 补 `GroundEmissiveColor/Strength/ReflectMix/Texture`（值类型即可：默认 0/黑=关闭，零值=缺省，无需指针区分——对比 `MirrorPosition` 用 `*[3]float64`+omitempty 是因 `[0,0,0]` 可能是用户真实设置） |
| `frontend/bindings/.../models.ts` | `wails3 generate bindings` 重新生成 |
| `frontend/src/__tests__/mocks/binding-factories.ts` | `createMockEnvState` 补 mirror 几何 4 + groundEmissive* 4 共 8 字段 |

## 4. 不在范围内

- **Go codegen**：不引入 schema → Go struct 自动生成（ADR-137 §5 维持原判）
- **清理 Go 死字段**（`waterFogDensity`/`underwaterFog*`）：已在豁免表登记，留待专门清理任务，避免扩大本次 diff
- **运行时 schema 校验**：脚本仅作开发/CI 防线，不引入运行时 JSON 校验

## 5. 验证

- `node scripts/check-env-parity.mjs --strict`：未豁免漂移为 0，exit 0
- `npm run check:docs`：全链 exit 0（含新插入的 parity 环节）
- `go build ./...` + `go vet ./internal/app/` + `go test ./internal/app/`：通过
- `tsc --noEmit`：零错误
- `vitest run env-state / bindings/app.contract`：33/33 通过

## 6. 经验

1. **「全量落盘」在跨语言边界不成立**：前端 serializeScene 全量透传没问题，但 Go 端 JSON round-trip 只认结构体声明的字段——前端视角的「全量」到 Go 就变「白名单」，必须以 Go 结构体为准核对。
2. **承诺的测试不落地 = 防线不存在**：ADR-137 §3.4 白纸黑字承诺 parity 测试，四年四次漂移无一被拦截。文档里写了「要测」远不如 CI 里有一条真正跑的检查。
3. **豁免表是显式治理而非掩盖**：死字段残留（Go 有、TS 无）与真漂移（TS 有、Go 无）方向不同、处置不同，脚本区分两者并强制登记原因，让「合理差异」可审计、可清理。
4. **首版脚本的正则要兼容可空字段**：bindings 中 `"mirrorPosition"?: number[] | null` 带 `?`，只匹配 `"name":` 会把它误报为漂移——初版曾因此误报，回归时需覆盖此形态。
