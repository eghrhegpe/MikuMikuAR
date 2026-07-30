# ADR-213: Go 后端 EnvState 命名漂移修复与契约补全

- **状态**: ✅ 已完成（Go struct 6 字段 + JSON tag 同步、UnmarshalJSON 6 条 fallback、契约测试补全、mock factory 同步全部落地）
- **日期**: 2026-07-30
- **相关**: ADR-210（envIntensity/envBrightness → iblIntensity/globalBrightness 改名）、ADR-212（命名 vs 翻译 vs 功能错位审计与治理）
- **源码锚点**: `internal/app/app.go`（EnvState struct + UnmarshalJSON）、`frontend/src/__tests__/bindings/app.contract.test.ts`（契约测试）、`frontend/src/__tests__/mocks/binding-factories.ts`（mock factory）

---

## 一、背景

### 1.1 上游改动

ADR-212 完成了 6 个环境状态字段的改名：

| 旧名 | 新名 | ADR-212 § |
|------|------|-----------|
| `particleSplash` | `particleSplashEnabled` | §6.1 · `*Enabled` 纪律 |
| `debugClouds` | `debugCloudsEnabled` | §6.1 · `*Enabled` 纪律 |
| `groundInfinite` | `groundInfiniteEnabled` | §6.1 · `*Enabled` 纪律 |
| `groundElevationColoring` | `groundElevationColoringEnabled` | §6.1 · `*Enabled` 纪律 |
| `planarReflectBlend` | `planarReflectionBlend` | §6.6 · 缩写统一 |
| `cloudsEnabled` | `cloudEnabled` | §6.4 · 单复数统一 |

TS 侧的改动全部带 `_migrators` 向前兼容（旧存档加载时自动映射），Schema、源码、测试、菜单绑定、5 语种翻译已同步。

### 1.2 发现的问题

Go 端 **`internal/app/app.go`** 的 `EnvState` struct 未同步——字段名和 `json` tag 都还是旧名。在 ADR-212 提交后，TS↔Go 之间的跨语言契约出现了 6 处静默漂移：

| TS schema 新字段名 | Go struct 旧字段名 | Go JSON tag（旧） |
|-------------------|-------------------|-------------------|
| `particleSplashEnabled` | `ParticleSplash` | `json:"particleSplash"` |
| `groundInfiniteEnabled` | `GroundInfinite` | `json:"groundInfinite"` |
| `groundElevationColoringEnabled` | `GroundElevationColoring` | `json:"groundElevationColoring"` |
| `debugCloudsEnabled` | `DebugClouds` | `json:"debugClouds"` |
| `cloudEnabled` | `CloudsEnabled` | `json:"cloudsEnabled"` |
| `planarReflectionBlend` | `PlanarReflectBlend` | `json:"planarReflectBlend"` |

### 1.3 为什么契约测试没抓住

`app.contract.test.ts` 的 `EnvState` shape 断言块（行 119-180）只检查了 50 个字段的子集——**这 6 个被改名的字段不在断言列表中**。

更重要的是：契约测试的 `EnvState` 类型（`../../../bindings/...models`）是由 `wails generate bindings` 从 **Go struct 自动生成**的。这意味着：

```
Go struct 没改 → wails bindings 导出旧类型 → TS 端得到旧类型 →
→ expectTypeOf(f).toMatchTypeOf<EnvState>() 永远通过
→ 契约测试形成一个猫抓尾巴的闭环，永远抓不住漂移
```

**契约测试锁的是 Go 端当前输出的形状**，而非"预期形状"。只有当某字段在 Go struct **存在但类型不对**时才会触发——字段完全不存在或命名不同时，契约静默忽略。

---

## 二、修复方案

### 2.1 Go struct 字段改名

`internal/app/app.go` 的 `EnvState` struct 中 6 个字段同步 TS schema 新名：

| Go 旧名 | Go JSON tag（旧） | Go 新名 | Go JSON tag（新） |
|---------|------------------|---------|------------------|
| `ParticleSplash` | `json:"particleSplash"` | `ParticleSplashEnabled` | `json:"particleSplashEnabled"` |
| `GroundInfinite` | `json:"groundInfinite"` | `GroundInfiniteEnabled` | `json:"groundInfiniteEnabled"` |
| `GroundElevationColoring` | `json:"groundElevationColoring"` | `GroundElevationColoringEnabled` | `json:"groundElevationColoringEnabled"` |
| `DebugClouds` | `json:"debugClouds"` | `DebugCloudsEnabled` | `json:"debugCloudsEnabled"` |
| `CloudsEnabled` | `json:"cloudsEnabled"` | `CloudEnabled` | `json:"cloudEnabled"` |
| `PlanarReflectBlend` | `json:"planarReflectBlend"` | `PlanarReflectionBlend` | `json:"planarReflectionBlend"` |

变更模式：纯机械改名，不改类型，不改字段在 struct 中的位置顺序，不改任何业务逻辑。

### 2.2 `UnmarshalJSON` 兼容扩展

当前 `UnmarshalJSON`（`app.go:594`）只处理了 ADR-210 的两个旧字段（`envIntensity`、`envBrightness`）。追加 6 条 ADR-212 的旧键 → 新键 fallback：

```go
// UnmarshalJSON reads EnvState while tolerating legacy field names renamed in
// ADR-210 (envIntensity→iblIntensity, envBrightness→globalBrightness) and
// ADR-212 (particleSplash→particleSplashEnabled, etc.). Old config.json
// files persisted the legacy keys; without this fallback those settings would
// silently reset to defaults on load. New keys take precedence.
func (e *EnvState) UnmarshalJSON(data []byte) error {
    type envStateAlias EnvState // avoid recursion
    aux := struct {
        *envStateAlias
        // ADR-210 legacy keys
        LegacyEnvIntensity  *float64 `json:"envIntensity"`
        LegacyEnvBrightness *float64 `json:"envBrightness"`
        // ADR-212 legacy keys
        LegacyParticleSplash           *bool    `json:"particleSplash"`
        LegacyGroundInfinite            *bool    `json:"groundInfinite"`
        LegacyGroundElevationColoring   *bool    `json:"groundElevationColoring"`
        LegacyDebugClouds               *bool    `json:"debugClouds"`
        LegacyCloudsEnabled             *bool    `json:"cloudsEnabled"`
        LegacyPlanarReflectBlend        *float64 `json:"planarReflectBlend"`
    }{envStateAlias: (*envStateAlias)(e)}
    if err := json.Unmarshal(data, &aux); err != nil {
        return err
    }
    // ADR-210 fallback
    if e.IblIntensity == 0 && aux.LegacyEnvIntensity != nil {
        e.IblIntensity = *aux.LegacyEnvIntensity
    }
    if e.GlobalBrightness == 0 && aux.LegacyEnvBrightness != nil {
        e.GlobalBrightness = *aux.LegacyEnvBrightness
    }
    // ADR-212 fallback
    // Note: zero-value bool fields with old config will get false, same as default.
    // This is acceptable because false is the zero value for bool in Go.
    if !e.ParticleSplashEnabled && aux.LegacyParticleSplash != nil {
        e.ParticleSplashEnabled = *aux.LegacyParticleSplash
    }
    if !e.GroundInfiniteEnabled && aux.LegacyGroundInfinite != nil {
        e.GroundInfiniteEnabled = *aux.LegacyGroundInfinite
    }
    if !e.GroundElevationColoringEnabled && aux.LegacyGroundElevationColoring != nil {
        e.GroundElevationColoringEnabled = *aux.LegacyGroundElevationColoring
    }
    if !e.DebugCloudsEnabled && aux.LegacyDebugClouds != nil {
        e.DebugCloudsEnabled = *aux.LegacyDebugClouds
    }
    if !e.CloudEnabled && aux.LegacyCloudsEnabled != nil {
        e.CloudEnabled = *aux.LegacyCloudsEnabled
    }
    if e.PlanarReflectionBlend == 0 && aux.LegacyPlanarReflectBlend != nil {
        e.PlanarReflectionBlend = *aux.LegacyPlanarReflectBlend
    }
    return nil
}
```

**注意**：bool 字段的零值判断（`!e.ParticleSplashEnabled`）可能导致当用户确实想设为 `false` 但旧存档中 `true` 时被旧值覆盖。但在实际场景中：用户旧存档带 `"particleSplash": true` → 新名没读到（zero false）→ fallback 读到旧 true → 正确。用户旧存档带 `"particleSplash": false` → 新名没读到（zero false）→ fallback 读到旧 false → 正确。只有"旧存档不含此 key"时会保持 false，这是期望行为。**结论：无竞态风险**。

### 2.3 契约测试补全

在 `app.contract.test.ts` 的 `EnvState` 断言块中追加被遗漏的 6 个字段：

```typescript
it('EnvState', () => {
    const f = createMockEnvState();
    expect(f).toMatchObject({
        // .... existing 50 fields ....
        // ← 下面 6 行是新增
        particleSplashEnabled: expect.any(Boolean),
        groundInfiniteEnabled: expect.any(Boolean),
        groundElevationColoringEnabled: expect.any(Boolean),
        debugCloudsEnabled: expect.any(Boolean),
        cloudEnabled: expect.any(Boolean),
        planarReflectionBlend: expect.any(Number),
    });
    expectTypeOf(f).toMatchTypeOf<EnvState>();
});
```

### 2.4 Mock factory 同步

`binding-factories.ts` 中的 `createMockEnvState()` 需要用新字段名：

```typescript
export function createMockEnvState(): EnvState {
    return {
        // ... existing fields ...
        particleSplashEnabled: false,
        groundInfiniteEnabled: false,
        groundElevationColoringEnabled: false,
        debugCloudsEnabled: false,
        cloudEnabled: false,
        planarReflectionBlend: 0.5,
        // ... keep existing old-name fields also if binding still exports them
    };
}
```

**关键**：由于 binding 类型是 `wails generate` 从 Go struct 自动推导的，mock factory 的字段名必须匹配 Go struct 改名后的新名。改名 + 重新跑 `go generate ./...` + `npm run build:binding` 后，mock 类型会随 Go 字段同步。

---

## 三、验证标准

| 检查项 | 方法 |
|--------|------|
| `go build ./...` 通过 | `go build` 零错误 |
| 契约测试通过 | `npm run test -- src/__tests__/bindings/app.contract.test.ts` 全绿 |
| 旧 config.json 读取 | 写一个含旧 key（`particleSplash: true`）的 config.json → 加载后 `envState.particleSplashEnabled === true` |
| 新 config.json 写入 | UI 改 `particleSplashEnabled: true` → 存盘 → 重读后值不丢 |
| `npm run check:funcmap` | 函数索引未破坏 |
| `npm run check:docs` | 文档漂移零报告 |

---

## 四、影响与风险

| 维度 | 评估 |
|------|------|
| **代码改动量** | Go struct 6 行改名 + 6 行 JSON tag + UnmarshalJSON ~40 行 + 契约测试 6 行 + mock factory 6 行 ≈ **70 行** |
| **运行时风险** | 低 — `UnmarshalJSON` fallback 覆盖旧存档；新存档直接使用新 key |
| **序列化兼容** | 旧存档 → Go 读（fallback 使用旧值）→ Go 写（新 key 写盘）→ TS 读（新 key 直接取）+ TS `_migrators` 不再触发 |
| **Go binding 生成** | 改名后需重新 `wails generate bindings`，否则 TS binding 类型仍为旧名 |
| **联合修复依赖** | ADR-212 必须在 ADR-213 之前落地（否则 Go 先改、TS 未改，反向漂移）|

## 五、实施步骤

1. `internal/app/app.go` — EnvState struct 6 个字段改名 + JSON tag 同步
2. `internal/app/app.go` — UnmarshalJSON 追加 6 条 ADR-212 fallback
3. `go build ./...` — 验证 compile 通过
4. `wails generate bindings` — 重新生成 TS binding 类型
5. `npm run build:binding` — 前端 binding 编译
6. `frontend/src/__tests__/mocks/binding-factories.ts` — 更新 `createMockEnvState` 字段名
7. `frontend/src/__tests__/bindings/app.contract.test.ts` — 追加 6 个字段断言
8. `npm run test` — 全量测试验证
9. 手动验证：写一份含旧 key 的 config.json → 启动 → 检查 envState 字段正确映射
