# ADR-227: 个人灯阴影按需开关与分辨率可调

> **日期**: 2026-08-01
> **状态**: 已完成
> **关联**：ADR-168（个人灯 / 动态追光）、ADR-175（灯光多入口强度治理）、舞台灯阴影 `_ensureStageShadow`（`lighting-shadow.ts`）

---

## 背景

个人灯（Personal Light，ADR-168）的阴影此前为**硬绑定常开**：`attachPersonalLight` 在挂载时**无条件** `new ShadowGenerator(512, light)`，每次挂灯必建、dispose 时释放，但**没有任何「enabled 旁路」**。由此产生三处不一致与空缺：

1. **无开关能力**：`PersonalLightSettings` 接口无 `shadowEnabled` 字段，用户无法关闭个人灯阴影；
2. **UI 无入口**：`menus/model-detail.ts` 个人灯卡片中无任何阴影相关控件（grep 命中 0）；
3. **范式割裂**：舞台灯阴影走 `lighting-shadow.ts:_ensureStageShadow`，受 `state.enabled && state.shadowEnabled` 门控、按字段按需建/拆；个人灯却把生成器**焊死**在 attach 路径里，与全局阴影开关体系脱节。

个人灯阴影在某些场景属性能开销（每盏灯一张 RTT + PCF），且并非所有 actor 都需要自投影——应允许按需关闭，并与舞台灯保持同一套「字段 → 生成器按需建/拆」契约。

## 决策

为 `PersonalLightSettings` 增加 `shadowEnabled: boolean` 与 `shadowResolution: number` 两个字段，抽离 `_ensurePersonalShadow(modelId)` 受 `shadowEnabled` 门控的按需创建/重建逻辑，复刻舞台灯 `_ensureStageShadow` 范式：

- **`attachPersonalLight`** 不再内联建生成器，改为入参 `shadowGen: null` + 末尾调 `_ensurePersonalShadow(modelId)`；
- **`setPersonalLightState`** 派生 `shadowChanged = 'shadowEnabled' in partial || 'shadowResolution' in partial`，变化时调 `_ensurePersonalShadow` 重建；
- **`_ensurePersonalShadow(modelId)`** 先 `dispose()` 旧生成器再按 `shadowEnabled` 门控创建，受 `modelRegistry.get(modelId)` 守卫；
- **UI**（`menus/model-detail.ts` 个人灯卡片）新增「阴影」开关 + 开启时的「阴影分辨率」滑块（512/1024/1536/2048），与既有 `coneEnabled` 开关范式完全一致；
- **序列化** 经既有 `getAllPersonalLights` / `restorePersonalLights` 自动落盘，无需改造；旧场景缺新字段经 `Object.assign` 保留默认 `shadowEnabled: true`，向后兼容。

默认 `shadowEnabled: true` / `shadowResolution: 512` —— 与既有常开行为逐字节一致。

## 方案

### 1. 接口与默认值（lighting-follow.ts）

```typescript
export interface PersonalLightSettings {
    // ...既有字段...
    /** [doc:adr-227] 是否生成阴影（默认 true，向后兼容既有常开行为） */
    shadowEnabled: boolean;
    /** [doc:adr-227] 阴影贴图分辨率 */
    shadowResolution: number;
}

export const DEFAULT_PERSONAL_LIGHT: PersonalLightSettings = {
    // ...
    shadowEnabled: true,
    shadowResolution: 512,
};
```

`PersonalLightEntry.shadowGen` 类型由 `ShadowGenerator` 收窄为 `ShadowGenerator | null`，消费点全部 null-safe。

### 2. 按需生成器（_ensurePersonalShadow）

```typescript
function _ensurePersonalShadow(modelId: string): void {
    const entry = _entries.get(modelId);
    if (!entry) return;
    if (entry.shadowGen) { entry.shadowGen.dispose(); entry.shadowGen = null; } // 重建前释放
    if (!entry.settings.shadowEnabled) return;
    const model = modelRegistry.get(modelId);
    if (!model) return;
    const gen = new ShadowGenerator(entry.settings.shadowResolution, entry.light);
    gen.usePercentageCloserFiltering = true;
    gen.bias = 0.001;
    for (const m of model.meshes) {
        if (m instanceof Mesh) { gen.addShadowCaster(m); m.receiveShadows = true; }
    }
    entry.shadowGen = gen;
}
```

### 3. 状态驱动重建（setPersonalLightState）

`Object.assign(entry.settings, partial)` 之后，若 `shadowChanged` 为真即调 `_ensurePersonalShadow`，与既有 intensity / angle / range / indicator / cone 更新同层。

### 4. UI 与 i18n

`buildPersonalLightLevel(id)` 个人灯卡片追加：

```typescript
addToggleRow(inner, t('model-detail.personalLightShadow'), pls.shadowEnabled,
    (v) => setPersonalLightState(id, { shadowEnabled: v }), 'lucide:moon');
if (pls.shadowEnabled) {
    addSliderRow(inner, t('model-detail.personalLightShadowResolution'), pls.shadowResolution,
        512, 2048, 512, (v) => setPersonalLightState(id, { shadowResolution: v }), 'lucide:scan');
}
```

`zh-CN / zh-TW / en / ja / ko` 五语言补 `personalLightShadow` / `personalLightShadowResolution`。

## 对比方案

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. 字段 + 按需生成器（选中，复刻舞台灯范式）** | 与 `_ensureStageShadow` 同一套契约；开关/分辨率即时生效；向后兼容 | 需抽函数 + UI 双语言 | ✅ |
| B. 保留常开，仅 UI 隐藏阴影视觉效果 | 改动最小 | 不消除根因，RTT 仍占显存；无分辨率控制 | ❌ |
| C. 复用全局 `lightingState.shadowEnabled` 控制个人灯 | 复用现有开关 | 个人灯应独立于主光 CSM 开关，被全局劫持违背「角色专属灯」语义 | ❌ |

## 不变量（迁移前后必须保持）

- **默认 `shadowEnabled: true`** → 旧场景 / 旧 localStorage 默认值加载后阴影照常，逐字节兼容。
- **dispose 配对**：`_ensurePersonalShadow` 重建前 `dispose()` 旧生成器；`detachPersonalLight` 经 `safeDispose(entry.shadowGen)`（null-safe）释放 RTT，无泄漏。
- **状态唯一源** 为 `entry.settings`，`shadowEnabled` / `shadowResolution` 两字段经 `setPersonalLightState` 单点写入。
- **`receiveShadows` 不回退**：个人灯阴影关闭时 mesh 仍 `receiveShadows = true`（继续接收舞台灯阴影），仅该灯自身不再投影。
- 快速连点切换为同步操作，无异步竞态，`_entries` 守卫防重复挂载。

## 涉及文件

| 文件 | 操作 | 阶段 |
|------|------|------|
| `docs/adr/adr-227-personal-light-shadow-toggle.md` | 新增 | 本回合 |
| `frontend/src/scene/render/lighting-follow.ts` | `PersonalLightSettings` 增字段；抽 `_ensurePersonalShadow`；`attachPersonalLight` / `setPersonalLightState` 接入；`PersonalLightEntry.shadowGen` 可空 | 已完成 |
| `frontend/src/menus/model-detail.ts` | 个人灯卡片增「阴影」开关 + 分辨率滑块 | 已完成 |
| `frontend/src/core/i18n/locales/{zh-CN,zh-TW,en,ja,ko}.ts` | 补 2 键 | 已完成 |
| `frontend/src/__tests__/scene/lighting-follow.test.ts` | 默认值断言 + 开关切换 + 分辨率重建用例 | 已完成 |

## 风险

- **UI 分辨率滑块非实时显隐**（P4）：`shadowEnabled` 运行时切换后，分辨率滑块需面板重建才出现/消失——与既有 `coneEnabled` 开关范式（model-detail.ts:1262）完全一致，属既有 UI 架构限制，行为可接受，不特例修。
- **测试未断言生成器实例**（P3）：现有用例验证「不抛错 + settings 同步」，未断言 `entry.shadowGen` 在 ON 时非 null、OFF 时为 null；`PersonalLightEntry` 未导出，建议后续补 test-only getter 或数 `scene` 的 shadow generators 强化。
- **文档引用悬空已收口**：本 ADR 落定后，`lighting-follow.ts` 内 `[doc:个人灯阴影开关]` 三处引用已改为 `[doc:adr-227]`。
