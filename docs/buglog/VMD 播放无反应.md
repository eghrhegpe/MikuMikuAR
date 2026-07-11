## VMD 播放无反应

### 当前状态
✅ 已修复。链路：`VmdLoader.loadFromBufferAsync()` → `MmdWasmAnimation` → `createRuntimeAnimation()` → `setRuntimeAnimation()` → `seekAnimation()` → `playAnimation()`。

---

## 测试失败：导入 `../scene/scene` 未桩 babylon-mmd

凡测试导入 `../scene/scene`（会拉起真实 babylon-mmd 运行时），必须在顶部用 `vi.mock` 桩全套 babylon-mmd 子模块（对应 `scene.ts:13-31` 的 15 个引入）+ `@babylonjs/core/scene`/`Cameras/*`；否则真实 babylon-mmd 的装饰器/静态初始化必然抛错，并连锁拖垮 outfit 等下游循环依赖测试——新测试照抄 `model-detail-ui.test.ts` 的 mock 块即可。
