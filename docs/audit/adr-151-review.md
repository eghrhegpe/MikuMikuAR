# ADR-151 审核记录（反射系统统一架构）

- **审核日期**: 2026-07-22
- **审核对象**: `docs/adr/adr-151-reflection-unified-architecture.md`（状态 ✅ 已实施，2026-07-22 修订）
- **审核结论**: 通过（架构契合应用场景），附 1 项 P2 行为错位 + 3 项文档/联动滞后
- **前置 ADR 更新状态**: 否（ADR-013/024/062/092 均未回链 ADR-151）

---

## 一、契合度验证（实现与文档一致）

| 验证项 | 结果 | 位置 |
|--------|------|------|
| `reflectionMode` 字段（default `planar`） | ✅ | `env-state-schema.ts:185` |
| `reflectionQuality` 语义保留（default `low`） | ✅ | `env-state-schema.ts:177` |
| `getPlanarQualityOverride` 接入 ground/water | ✅ | `env-ground.ts:534` / `env-water.ts:147`；`planar-reflection.ts:update()` 每帧重算 → 模式切换实时生效 |
| `onModelMeshesReady` 接入模型加载 | ✅ | `scene.ts:448` |
| `setSSRFromReflection` 收口 renderer | ✅ | `renderer.ts:1075` |
| 旧符号移除（bindReflectionProbeToModel / refreshReflectionProbe / ssrEnabled / reflectionProbeEnabled） | ✅ | 已从代码移除（仅注释残留于 renderer.ts:1111、env-reflection.ts:498） |
| UI 下拉 + i18n + 单测 | ✅ | `scene-menu.ts:257`、五语言 locale、env-state.test.ts:137 |

### 场景映射
- `none` → AR / 低性能设备
- `planar` → 角色倒影（地面/水面）—— MMD viewer 最核心反射需求，且为默认，选型恰当
- `probe` → 模型材质环境反射底色
- `ssr` → 屏幕空间动态反射细节
- `hybrid` → 最高画质

五模式覆盖全部真实场景，架构契合。

---

## 二、风险表

| 等级 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟠 P2 | `env-reflection.ts:131` `getPlanarQualityOverride` | 仅对 `planar` 拔高到 `low`，对 `ssr`/`probe`/`hybrid` 返回 `null` → 完全跟随 `reflectionQuality`。非 planar 模式 + `reflectionQuality='off'` 会**静默关闭地面/水面倒影**；hybrid 本意"最高画质"却可能零倒影，与用户预期错位 | hybrid/ssr 模式也至少保底 planar `low`，或在 UI tooltip 显式注明此行为 |
| 🟡 P3 | 全仓 preset / qualityProfile | 无 preset 写 `reflectionMode`，仅默认 `planar` + 手动菜单。AR/低端场景需用户手动切 `none` | AR 模式预设与质量档案显式置 `reflectionMode`，使场景切换自洽 |
| 🟡 P3 | `adr-024` 第 27 行降级策略 | "L1 关闭 SSR，L2/L3 关闭 SSR+Probe" 与现状（ADR-151 把降级改写为只写 `reflectionQuality`，不再切换 `reflectionMode`）不一致 | 修订 ADR-024 降级描述，或补降级→`reflectionMode` 短路 |
| 🟢 P4 | ADR-151 风险表 | 仍列"Probe 退出时 reflectionColor 未还原"为未解决 | 代码已实现 `_savedReflectionColors` + 还原（`env-reflection.ts:177-185`），文档滞后，建议标注已修复 |

---

## 三、前置 ADR 回链状态（已于 2026-07-22 补齐）

> 用户批准补写。ADR-024 直接声明 ReflectionProbe 管理**合并至 ADR-151**（减少迁移难度）；ADR-062/092/013 加交叉引用。

| 前置 ADR | 应补交叉引用 | 紧迫度 |
|----------|--------------|--------|
| ADR-024（SSR/ReflectionProbe） | ReflectionProbe 管理已被 ADR-151 接管（迁至 `env-reflection.ts`）；降级策略被改写 | 🔴 最高 |
| ADR-092（统一平面反射引擎） | ADR-151 经 `getPlanarQualityOverride` 直接协调该引擎 | 🟡 |
| ADR-062（水面平面反射） | ADR-151 协调其 resolution 覆盖 | 🟡 |
| ADR-013（天空系统） | "被 ADR-151 借鉴 applySky 模式" | 🟢 可选 |

注：adr-151 自身已被 adr-152 / adr-164 / adr-173 / adr-115 引用，但上游 4 篇未回链，形成单向引用，不利追溯。
