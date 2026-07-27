# Babylon-mmd 官方文档索引

> 联邦项目开发时优先参考此索引定位上游文档。
> 在线版：https://noname0310.github.io/babylon-mmd/
> **本地版本**：`docs/upstream/babylon-mmd-docs/`（含 57 篇 markdown + 图片 + 演示视频）

---

## 快速索引

| 场景 | 文档章节 | 本地路径 |
|------|---------|---------|
| 加载 PMX 模型 | get-started/load-mmd-model | `babylon-mmd-docs/get-started/load-mmd-model/index.md` |
| 加载 VMD 动画 | get-started/load-and-play-vmd-animation | `babylon-mmd-docs/get-started/load-and-play-vmd-animation/index.md` |
| 添加物理 | get-started/add-physics | `babylon-mmd-docs/get-started/add-physics/index.md` |
| 完整示例（含 WASM） | reference/overview | `babylon-mmd-docs/reference/overview/index.md` |
| 动画系统（句柄机制） | reference/overview § VMD Loader | 行 274-287 |
| 动画混合 | reference/runtime/animation/animation-blending | `babylon-mmd-docs/reference/runtime/animation/animation-blending/index.md` |
| WASM 运行时 | reference/runtime/mmd-webassembly-runtime | `babylon-mmd-docs/reference/runtime/mmd-webassembly-runtime/index.md` |
| MMD Runtime | reference/runtime/mmd-runtime | `babylon-mmd-docs/reference/runtime/mmd-runtime/index.md` |
| 加载器 | reference/loader/mmd-model-loader | `babylon-mmd-docs/reference/loader/mmd-model-loader/index.md` |
| 材质构建器 | reference/loader/mmd-model-loader/material-builder | `babylon-mmd-docs/reference/loader/mmd-model-loader/material-builder/index.md` |
| BPMX 格式 | reference/loader/mmd-model-loader/the-babylon-pmx-format | `babylon-mmd-docs/reference/loader/mmd-model-loader/the-babylon-pmx-format/index.md` |
| BVMD 格式 | reference/loader/mmd-animation-loader/the-babylon-vmd-format | `babylon-mmd-docs/reference/loader/mmd-animation-loader/the-babylon-vmd-format/index.md` |
| 音频播放器 | reference/runtime/audio-player | `babylon-mmd-docs/reference/runtime/audio-player/index.md` |
| MMD 相机 | reference/runtime/mmd-camera | `babylon-mmd-docs/reference/runtime/mmd-camera/index.md` |

---

## 关键设计约束（从文档提炼）

以下约束来自文档示例代码和注释，是联邦项目需要遵守的上游设计边界：

### 1. 用具体类型，不用接口

文档所有示例均使用 `MmdModel` / `MmdRuntime` / `MmdWasmRuntime` 等具体类型，从未通过 `IMmdModel` / `IMmdRuntime` 操作。

```typescript
// ✅ 正确做法（与文档一致）
const mmdModel = mmdRuntime.createMmdModel(mmdMesh);
const handle = mmdModel.createRuntimeAnimation(animation);
mmdModel.setRuntimeAnimation(handle);

// ❌ 错误做法（违反上游设计）
function fn(model: IMmdModel) { model.setRuntimeAnimation(handle); }
```

**理由**：两 runtime（JS/WASM）在复杂操作下不可互换。WASM 需处理数据竞争和缓冲求值同步。

### 2. 句柄模式，不直接访问动画对象

```typescript
// ✅ 正确
const handle = mmdModel.createRuntimeAnimation(animation);
mmdModel.setRuntimeAnimation(handle);

// 销毁
mmdModel.destroyRuntimeAnimation(handle);
```

文档第 286 行明确：*"These objects are generally not recommended for direct access, so createRuntimeAnimation returns a handle."*

### 3. `IMmdModel` 保持最小

`IMmdModel` 只暴露跨 runtime 通用的最基本契约。专有方法（如 `createRuntimeAnimation`、`setRuntimeAnimation`、`currentAnimation`）仅存在于具体类上。消费者应通过泛型保留具体类型：

```typescript
function fn<T extends IMmdModel>(mmdModel: T) {
    // T 保留具体类型，可访问专有方法
}
```

### 4. WASM 加载器注册

```typescript
// ✅ 使用 `.pure` 模块 + 显式注册（tree-shakable）
import { RegisterPmxLoader } from "babylon-mmd/esm/Loader/pmxLoader.pure";
RegisterPmxLoader();

// ❌ 避免从根路径导入（有 side-effect）
// import "babylon-mmd";  // 会注册所有组件
```

---

## 获取帮助

- 官方文档：https://noname0310.github.io/babylon-mmd/
- GitHub Issues：https://github.com/noname0310/babylon-mmd/issues
- Playground 示例：https://www.babylonjs-playground.com/#S7XDNP

---

*本索引由 Riku 于 2026-07-27 建立，基于上游 `noname0310/babylon-mmd` 官方文档和 PR 审核反馈。*
