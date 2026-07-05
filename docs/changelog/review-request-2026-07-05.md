# Code Review Request — MikuMikuAR 2026-07-05

## 项目背景

Babylon.js + Wails v3 的桌面/移动 PMX 3D 播放器。TypeScript 前端，Go 后端。3D 渲染 + MMD 物理 + 程序化动作。

本次提交涉及 3 个需要架构审核的改动。

---

## Review 1: Motion Layers（多 VMD 动画叠加）

### 问题

同一模型需要同时播放两条 VMD（如体舞 + 表情），当前系统一次只能绑定一个动画。

### 方案

用 babylon-mmd 的 `MmdCompositeAnimation` 将多个 VMD 混合为一个动画，每层独立 weight 控制混合比例。

### 关键代码

```typescript
// vmd-layers.ts — 核心混合逻辑
async function _rebuildCompositeAnimation(modelId: string): Promise<void> {
    const enabledLayers = inst.vmdLayers.filter(l => l.enabled);

    // 单图层：直接加载，无额外开销
    if (enabledLayers.length === 1 && inst.vmdLayers.length === 1) {
        await loadVMDMotion(enabledLayers[0].data, enabledLayers[0].name, modelId);
        return;
    }

    // 多图层：MmdCompositeAnimation 混合
    const composite = new MmdCompositeAnimation('motionLayers');
    for (const layer of enabledLayers) {
        const mmdAnimation = await vmdLoader.loadFromBufferAsync(layer.name, layer.data);
        const span = new MmdAnimationSpan(mmdAnimation, 0, mmdAnimation.endFrame, 0, layer.weight);
        composite.addSpan(span);
    }

    // WASM 运行时不支持 composite（缺 createRuntimeModelAnimation），回退主图层
    if (mmdRuntime instanceof MmdWasmRuntime) {
        await loadVMDMotion(enabledLayers[0].data, enabledLayers[0].name, modelId);
        return;
    }

    // JS 运行时：类型断言绑定
    const runtimeAnimation = composite as unknown as IMmdBindableModelAnimation;
    inst.mmdModel.setRuntimeAnimation(null);
    const handle = inst.mmdModel.createRuntimeAnimation(runtimeAnimation);
    inst.mmdModel.setRuntimeAnimation(handle);
}
```

### 审核点

1. WASM 回退策略是否合理？有没有更好的方式让 composite 在 WASM 下工作？
2. `MmdCompositeAnimation` 的 weight 是归一化还是绝对值？多层 weight=1.0 时行为是否正确？
3. 序列化/反序列化场景文件时，vmdLayers 的 path 引用是否健壮？

---

## Review 2: 材质编辑器增量更新

### 问题

材质列表的色块点击和行选择原来调 `reRender()` 全量重建 DOM（~200 行折叠列表），导致输入框焦点丢失和视觉闪烁。

### 方案

色块点击改为内联 DOM 操作（改 style + class），行选择改为只重建参数卡片容器。

### 关键代码

```typescript
// model-material.ts — 色块点击增量更新
swatch.addEventListener('click', (e) => {
    e.stopPropagation();
    const newState = !isMatEnabled(id, idx);
    setMatEnabled(id, idx, newState);
    // 内联更新，不触发 reRender
    if (newState) {
        swatch.style.cssText = `background:rgb(${r},${g},${b})`;
        swatch.classList.remove('mat-swatch-disabled');
        row.classList.remove('mat-disabled');
    } else {
        swatch.style.cssText = 'background:transparent;border:2px dashed var(--text-muted);';
        swatch.classList.add('mat-swatch-disabled');
        row.classList.add('mat-disabled');
    }
});

// 行点击：只更新参数卡片
row.addEventListener('click', () => {
    const prev = inner.querySelector('.slide-focused');
    if (prev) prev.classList.remove('slide-focused');
    row.classList.add('slide-focused');
    _selectedMat = { cat, index: idx };
    _renderParamCard(id, modelName, cat, idx, detailList); // 只重建参数区域
});
```

### 审核点

1. 直接 DOM 操作 vs ADR-027 的 `registerControl` + `updateControls` 模式，哪种更可维护？
2. `_paramCardEl` 作为模块级变量存储容器引用，是否有内存泄漏风险？
3. 重置操作仍用 `reRender()`，这个 split 是否合理？

---

## Review 3: 预设动画天空纹理节流

### 问题

环境预设切换时有 2 秒过渡动画，每帧调 `setEnvState` → `applySky` → 重建天空纹理。60fps × 2s = 120 次纹理重建。

### 方案

动画循环中天空颜色更新限制为每 3 帧一次（~20fps），灯光保持每帧更新。

### 关键代码

```typescript
// env-bridge.ts — 动画循环节流
let frameCount = 0;
const animLoop = () => {
    frameCount++;

    // 天空：每 3 帧更新（~20fps），texture rebuild 从 ~120 降到 ~40
    if (frameCount % 3 === 0 || t >= 1) {
        setEnvState({ skyMode: 'procedural', skyColorTop, skyColorMid, skyColorBot, ... }, true);
    }

    // 灯光：每帧更新（开销小，无纹理重建）
    setLightState(interpLight);

    if (t >= 1) { /* 结束 */ } else { requestAnimationFrame(animLoop); }
};
```

### 审核点

1. `frameCount % 3` 的硬编码节流 vs 时间戳节流（如每 50ms），哪种更健壮？
2. 最后一帧 `t >= 1` 强制更新是否能保证最终状态一致？
3. 如果未来动画时长改为可配置，这个节流逻辑需要同步调整吗？

---

## 环境信息

- Babylon.js 9.14.0 + babylon-mmd
- TypeScript strict: false（历史遗留）
- 测试：Vitest 982 tests 全通过
- 构建：Vite + Go (Wails v3 alpha2.105)
