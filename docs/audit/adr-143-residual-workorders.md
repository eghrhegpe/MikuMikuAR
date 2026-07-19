# ADR-143 残差作战工单（2026-07-19 校准）

> **背景校准**：2026-07-19 的「方向研判」曾把 Observer 生命周期、滑块重写、空 catch、AbortSignal 透传列为 P1 未竟之业；经代码核实，**这些均已落地**：
> - ADR-139（ObserverRegistry）：`core/observer-handle.ts` 已建，`mesh.metadata` 中 0 个 observer 句柄。✅
> - ADR-140（DragSliderController）：`core/ui-slider-controller.ts` 已建，4 个 builder 全迁移。✅
> - 空 `catch {}`：生产代码 0 处命中（仅测试 6 处）。✅
> - ADR-143 四个主题：persistEnvState 助手、loadManager.signal 参数、addActionRow/addDisabledRow、SCENE_EVENTS 枚举均**已存在**。
>
> 以下仅收束**经核实仍残留的 3 个小项**，按"信任但验证"标准逐项确认真实位置。

---

## 工单① persistUIState 对称助手（主题 3 残差）

**真实状态**：env 侧 4 处重复 `.catch` 已被 `persistEnvState`（env-bridge.ts:180）收敛（`SetEnvState(payload` 全库仅 1 处，在助手内）。但 `flushUIState` 内仍有一处 **UI 侧裸 catch 副本**未对称收敛。

**涉及文件与行号**：`frontend/src/scene/env/env-bridge.ts:646-651`（裸 `SetUIState(...).catch`）

**当前代码**：
```ts
// env-bridge.ts ~646
export function flushUIState(): void {
    ...
    SetUIState(payload as unknown as import('../../core/wails-bindings').UIState).catch((err) => {
        logWarn('flushUIState', 'persist failed', err);
        setStatus(t_i18n('env.persistFailed'), false);
    });
}
```

**整改 diff**：
```diff
+ /** 与 persistEnvState 对称：持久化 UI state，统一错误上报。 */
+ function persistUIState(payload: Partial<UIState>): void {
+     SetUIState(payload as unknown as import('../../core/wails-bindings').UIState).catch((err) => {
+         logWarn('persistUIState', 'persist failed', err);
+         setStatus(t_i18n('env.persistFailed'), false);
+     });
+ }

  export function flushUIState(): void {
      ...
-     SetUIState(payload as unknown as import('../../core/wails-bindings').UIState).catch((err) => {
-         logWarn('flushUIState', 'persist failed', err);
-         setStatus(t_i18n('env.persistFailed'), false);
-     });
+     persistUIState(payload);
  }
```

**验收**：
```bash
grep -n "SetUIState(payload" frontend/src/scene/env/env-bridge.ts
# 仅应命中 persistUIState 内部一处
```

---

## 工单② loadAudioFile 透传 signal（主题 5 残差）

**真实状态**：`loadManager.load(req, signal?)`（load-manager.ts:88）已存在，dispatch（:136）已将 signal 透传至 actor/stage/prop/vmd/camera-vmd **5 个分支**；唯独 `case 'audio'`（:203-205）漏传，且 `loadAudioFile`（audio.ts:248）无 signal 形参。

**涉及文件与行号**：
- `frontend/src/core/load-manager.ts:205`（调用点漏传）
- `frontend/src/outfit/audio.ts:248`（`loadAudioFile` 签名无 signal）

**当前代码**：
```ts
// load-manager.ts:203-205
case 'audio': {
    const { loadAudioFile } = await import('../outfit/audio');
    await loadAudioFile(req.path);          // ← 未传 signal
    ...

// audio.ts:248
export async function loadAudioFile(filePath: string): Promise<void> {
    const bytes = await readFileBytes(filePath);
```

**整改 diff**：
```diff
// load-manager.ts:205
-     await loadAudioFile(req.path);
+     await loadAudioFile(req.path, signal);

// audio.ts:248
- export async function loadAudioFile(filePath: string): Promise<void> {
+ export async function loadAudioFile(filePath: string, signal?: AbortSignal): Promise<void> {
+     if (signal?.aborted) return;
      const bytes = await readFileBytes(filePath);
```

**验收**：
```bash
grep -n "loadAudioFile(req.path, signal)" frontend/src/core/load-manager.ts   # 应命中
grep -n "loadAudioFile(filePath: string, signal" frontend/src/outfit/audio.ts # 应命中
```

---

## 工单③ SLIDER_QUARTER_* 常量接线（主题 7 残差，可选/低优先）

**真实状态**：`core/ui-constants.ts` 已定义 `SLIDER_QUARTER_LARGE_STEP=0.15`（:7）、`SLIDER_QUARTER_SMALL_STEP=0.05`（:9）、`SCENE_EVENTS.SAVE='scene:save'`（:25），且 `scene-menu.ts` 已用 `SCENE_EVENTS.SAVE`（:273/:446）。**唯一缺口**：`SLIDER_QUARTER_*` 已定义但**无任何消费者**（grep 仅命中定义行）；`env-state-schema.ts` 的 `0.15/0.05` 是语义不同的环境默认值，**不可混用**。

**建议（预防性，非强制）**：未来凡 slider builder 需四分位步进处，用常量替代字面量：
```diff
- step: 0.15,
+ step: SLIDER_QUARTER_LARGE_STEP,
```
**不强行改 env-state-schema 的 0.15/0.05**（语义不同，改之改变环境默认值行为）。

**验收（仅当执行）**：
```bash
grep -rn "SLIDER_QUARTER_" frontend/src   # 除定义外至少 1 个消费点
```

---

## 总验收（合并）

```bash
# ① UI persist 收敛
grep -n "SetUIState(payload" frontend/src/scene/env/env-bridge.ts   # 1 处（助手内）
# ② audio signal 透传
grep -n "loadAudioFile(req.path, signal)" frontend/src/core/load-manager.ts  # 1 处
# ③ 字面量归零（SCENE_EVENTS 已完成，验证用）
grep -rn "'scene:save'" frontend/src   # 仅 ui-constants.ts:25 定义处
```

> **结论**：大统一主线（ADR-137~143）已近收尾，残差仅为 3 个低风险对称/接线项。联邦当前应进入「收尾验收 + 长尾 ADR（084/085/088/104）了断」阶段，而非继续铺新功能。
