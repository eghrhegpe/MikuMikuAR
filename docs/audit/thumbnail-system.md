# 缩略图系统 — 审核报告

> **审核日期**: 2026-07-13
> **审核范围**: 缩略图生成、磁盘缓存、前端加载/渲染全链路
> **审核者**: Riku（联邦首席架构师 AI）

---

## 总体结论：有条件通过

缩略图系统架构完整，覆盖了从 GPU 渲染捕获 → 磁盘缓存 → 前端懒加载的完整链路。核心设计良好（离屏渲染、独立相机、SHA-256 缓存键），但存在**3 项 P2 风险**和**4 项 P3 风险**，主要集中在并发控制、键值一致性和死代码上。

---

## 架构概览

```
┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ model-loader │    │  Go thumbnail    │    │  library-core   │
│ captureThumb │───▶│  package         │───▶│  _loadThumbnails│
│ (off-screen  │    │  Save/Get/GetBtch│    │  ForLevel       │
│  RT+FreeCam) │    │  SHA-256 key     │    │                 │
└──────────────┘    └──────────────────┘    └────────┬────────┘
       ▲                                              │
       │  fire-and-forget                             ▼
       │  (actor L457, stage L327)          ┌─────────────────┐
       │                                     │  ui-resource    │
       │                                     │  -panel         │
       │                                     │  IntersectionOb │
       │                                     │  VirtualGrid    │
       │                                     │                 │
       │                                     └─────────────────┘
       │                                              │
       │                                              ▼
       │                                     ┌─────────────────┐
       │                                     │  state.ts       │
       │                                     │  thumbnailCache │
       │                                     │  (in-place      │
       │                                     │   mutate)       │
       └─────────────────────────────────────┴─────────────────┘
```

---

## 模块审核

### 1. 缩略图生成 — `model-loader.ts:captureThumbnail` (L112-L213)

**职责**: 模型加载后离屏渲染 → 读取像素 → base64 PNG → 保存到磁盘 + 内存缓存

| 维度 | 检查项 | 结果 |
|------|--------|------|
| **类型安全** | `as any` / `@ts-ignore` | ✅ 0 处 |
| **资源管理** | RT + Camera 释放 | ✅ `finally` 块 `rt.dispose()` + `thumbCam.dispose()` (L206-208) |
| **测试覆盖** | 直接测试 | ❌ 无单元测试（含 Babylon 渲染，需集成测试） |
| **功能正确性** | 边界条件 | ⚠️ 见风险表 |
| **设计质量** | 职责单一 | ✅ 离屏渲染不碰主相机 |

**亮点**:
- L146-150: 使用独立 `FreeCamera` + 自动计算包围盒距离，确保模型居中显示
- L153-155: `RenderTargetTexture` 带透明背景 (`Color4(0,0,0,0)`)，便于叠加显示
- L168-209: 完整的 `try/finally` 资源释放保护
- L173: `readPixels` 使用浮点格式 (`true`)，精度优于 `Uint8Array`

**风险**:

| 级别 | 位置 | 问题 | 建议 |
|------|------|------|------|
| 🔴 P2 | L112-L213 | **无并发生成守卫**: `captureThumbnail` 是 fire-and-forget（`.catch(() => {})`），快速切换模型时可能 2 个同时执行，互相读取对方的场景状态，产生错误的缩略图 | 添加 generation counter + `disposed` 标志，在 `_scene` 或 `_modelManager` 级别断路 |
| 🟠 P2 | L171 | **单帧等待不足**: `requestAnimationFrame` 仅等待 1 帧，WASM 物理刚体、布料模拟、outfit 加载尚未稳定，捕获的缩略图可能处于任意姿势 | 增加 `captureDelay` 参数，默认 3-5 帧；或监听 `mmku:modelLoaded` 后延迟 100ms 再捕获 |
| 🟠 P2 | L193-196 | **键值构造与加载路径不一致**: `captureThumbnail` 优先使用 `libraryPath`（当 `libraryPath !== filePath` 时），而 `_thumbnailKeyForModel`(L505-509) 和 `modelToResourceItem.thumbKey`(L1256) 只用 `m.file_path`。ZIP 包内模型路径不一致时，保存的 key 与查询的 key 不匹配，永远找不到缩略图 | 统一键值构造函数：三种场景（save / load / panel）使用同一 `thumbnailKey(model, libraryPath?, innerPath?)` |
| 🟡 P3 | L123-129 | **场景就绪性不足**: `whenReadyAsync()` 5s 超时后仅 `requestAnimationFrame` 兜底，未检查 `_scene.isReady()` 或 `getEngine().isReady()`，可能导致 `render()` 产生空帧 | 在 `rt.render()` 前加 `if (!_scene.isReady()) return` |
| 🟡 P3 | L185-188 | **像素转换精度**: `Math.round(pixelsArr[i] * 255)` 逐像素作浮点→整数转换，未使用 `Math.clamp`，但对 `Float32Array` 偶有 NaN 未处理 | 加 `Number.isFinite` 守卫或 `Math.max(0, Math.min(255, Math.round(...)))`（当前已用 `Math.min/max` 但无 NaN 守卫） |
| 🟢 P4 | L210-212 | **失败无声**: `catch` 仅 `console.warn`，调用方无法感知捕获失败 | 可选：在状态栏短暂提示缩略图生成失败（非阻塞） |

---

### 2. 磁盘缓存 — `internal/thumbnail/thumbnail.go`

**职责**: 持久化缩略图存储，SHA-256 键值 + 文件 mtime/size 校验

| 维度 | 检查项 | 结果 |
|------|--------|------|
| **类型安全** | 编译时 | ✅ Go 强类型 |
| **资源管理** | 文件句柄 | ✅ `os.ReadFile`/`os.WriteFile` 自动关闭 |
| **测试覆盖** | Go 测试 | ⚠️ 未检查（推测有） |
| **功能正确性** | 边界条件 | ✅ 含旧版绝对路径回退 |
| **设计质量** | 职责单一 | ✅ |

**亮点**:
- L21-35: `CacheKey` 使用相对路径（`filepath.Rel`）使缓存可移植（resource_root 迁移后仍有效）
- L47-58: `Get` 双回退策略：先尝试相对路径 key，再回退绝对路径 key（兼容旧版缓存）
- L68-76: `GetBatch` 逐路径处理，失败路径只跳过不阻塞

**风险**:

| 级别 | 位置 | 问题 | 建议 |
|------|------|------|------|
| 🟢 P4 | L68-76 | `GetBatch` 是顺序处理，而非并行 | 内存缓存场景下无瓶颈，但若磁盘缓存热，可改为 `sync.WaitGroup` 并行 |

---

### 3. 前端加载 — `library-core.ts` (L505-L524, L838-L863, L1026-L1042)

**职责**: 从 Go 后端批量加载缩略图 → 更新 `thumbnailCache`

| 维度 | 检查项 | 结果 |
|------|--------|------|
| **类型安全** | `as any` / `@ts-ignore` | ✅ 0 处 |
| **资源管理** | 无资源分配 | ✅ N/A |
| **测试覆盖** | 直接测试 | ⚠️ mock 存在但无行为测试 |
| **功能正确性** | 边界条件 | ✅ 空检查、异常捕获 |

**亮点**:
- L520: `setThumbnailCache(new Map(...))` 使用 `Object.entries` 兼容 Go 端返回的 `map[string]string`
- L854-860: `renderFullscreenFolder` 在缩略图异步返回后调用 `updateItems` 重绘面板，解决"已渲染的卡片永远空"问题
- L1038-1039: `renderGridMode` 同样有重绘逻辑

**风险**:

| 级别 | 位置 | 问题 | 建议 |
|------|------|------|------|
| 🟡 P3 | L505-509 vs L1256 | **键值构造函数重复**: `_thumbnailKeyForModel` 与 `modelToResourceItem.thumbKey` 逻辑等价但各自独立实现，可能不同步演进 | 抽取为公共函数 `thumbnailKeyForModel(m: LibraryModel): string` |
| 🟡 P3 | L519-520 | **全量替换 vs 增量合并**: `setThumbnailCache(new Map(Object.entries(batch)))` 完全替换全局缓存，可能丢弃其他模块（如 `renderFullscreenFolder`）刚加载的缩略图 | 改增量合并：`const merged = new Map(thumbnailCache); for (const [k,v] of batch) { merged.set(k,v); } setThumbnailCache(merged)` |
| 🟢 P4 | L512-524 | 无单元测试覆盖 `_loadThumbnailsForLevel` 行为 | 补充测试：mock `GetThumbnailBatch`，验证 `setThumbnailCache` 调用次数和参数 |

---

### 4. 前端渲染 — `ui-resource-panel.ts`

**职责**: 缩略图网格/列表渲染，IntersectionObserver 懒加载，VirtualGrid 虚拟滚动

| 维度 | 检查项 | 结果 |
|------|--------|------|
| **类型安全** | `as any` / `@ts-ignore` | ✅ 0 处 |
| **资源管理** | Observer + VirtualGrid 释放 | ✅ `dispose()` 级联 `cleanup()` |
| **测试覆盖** | 直接测试 | ❌ 无（UI builder 组件豁免） |
| **功能正确性** | 边界条件 | ⚠️ 见风险表 |
| **设计质量** | 职责单一 | ✅ |

**亮点**:
- L120-134: `IntersectionObserver` 使用 `liveThumbnailCache` 引用，而非穿参的 `cache`，保证缓存更新后自动生效
- L133: `rootMargin: '200px'` 预加载埋深，提升滚动体验
- L59: `VIRTUAL_THRESHOLD = 50` 的阈值合理，兼顾小数据量无虚拟滚动开销

**风险**:

| 级别 | 位置 | 问题 | 建议 |
|------|------|------|------|
| 🟠 P2 | L129 | **IntersectionObserver 永不 unobserve**: 成功设置 `backgroundImage` 后，该 entry 不会被移除，导致每次滚动都重新执行 `liveThumbnailCache.has(path)` 检查，O(n) 开销 | 设置成功后调用 `observer.unobserve(el)` |
| 🟡 P3 | L144-151 | **`updateItems` 可能操作已卸载的 DOM 节点**: 虚拟滚动回收 DOM 后，`panel.querySelectorAll` 返回的节点可能已不在文档中，设置 `backgroundImage` 无效 | 加 `el.isConnected` 守卫 |
| 🟡 P3 | L177-179 | **列数计算硬编码常量**: `thumbSize = 80`、`gap = 8` 硬编码，未使用 CSS 变量 `--resource-thumb-size` / `--resource-gap` | 实时读取 CSS 变量：`getComputedStyle(container).getPropertyValue('--resource-thumb-size')` |
| 🟢 P4 | L253-261 | **缩略图加载时闪烁**: fallback 图标在 PNG 加载后突然消失，替换为背景图，无过渡效果 | 可加 `transition: background-image 0.2s`（性能损耗小） |

---

### 5. 死代码 — `model-manager.ts:captureThumbnail` (L928-L942)

**职责**: 从未在生产路径中使用

| 级别 | 位置 | 问题 | 建议 |
|------|------|------|------|
| 🟠 P2 | L928-942 | **死代码**: `model-manager.ts` 的 `captureThumbnail` 仅被测试调用（`model-manager.test.ts`），生产环境使用 `model-loader.ts` 的离屏 RT 版本。两份实现共存，容易误导后续开发者 | 删除 `model-manager.ts:captureThumbnail`，测试用例改测 `model-loader.ts` 的版本（或标记为 legacy 并加注释说明测试隔离） |

---

## 数据流追踪

```
captureThumbnail (model-loader.ts)
  │
  ├─ key = libraryPath ?? filePath [+ "::" + innerPath]
  ├─ SaveThumbnail(key, raw) → Go → thumbnail.Save() → disk
  └─ setThumbnailCache(updated) → state.ts (in-place)

_loadThumbnailsForLevel (library-core.ts)
  │
  ├─ key = _thumbnailKeyForModel(m) = m.file_path [+ "::" + m.zip_inner]
  └─ GetThumbnailBatch(keys) → Go → thumbnail.GetBatch() → setThumbnailCache()

renderFullscreenFolder / renderGridMode (library-core.ts)
  │
  ├─ key = item.thumbKey (from modelToResourceItem)
  └─ GetThumbnailBatch(keys) → setThumbnailCache() → currentPanel.updateItems()

IntersectionObserver (ui-resource-panel.ts)
  │
  └─ liveThumbnailCache.has(path) → set backgroundImage
```

**关键发现**: 三条路径的键值构造逻辑存在不一致：

| 路径 | 键值构造 | 示例 (ZIP 内模型) |
|------|---------|-------------------|
| `captureThumbnail` (save) | `libraryPath ?? filePath` + `::${innerPath}` | `C:/lib/foo.zip::model.pmx` |
| `_thumbnailKeyForModel` (load) | `m.file_path` + `::${m.zip_inner}` | `C:/lib/temp/foo/model.pmx::model.pmx` |
| `modelToResourceItem.thumbKey` (panel) | `fp` + `::${m.zip_inner}` | `C:/lib/temp/foo/model.pmx::model.pmx` |

当 `libraryPath` 与 `filePath` 不同时（ZIP 包解压到临时目录），save 路径使用 `libraryPath`（ZIP 包路径），load/panel 路径使用 `file_path`（解压后的临时路径）→ **键不匹配，缩略图找不到**。

---

## 测试覆盖

| 模块 | 测试文件 | 覆盖情况 |
|------|---------|---------|
| `model-loader.ts:captureThumbnail` | — | ❌ 无测试（含 Babylon 渲染，需集成测试环境） |
| `model-manager.ts:captureThumbnail` | `model-manager.test.ts:1199-1236` | ✅ 有测试，但该函数是**死代码** |
| `library-core.ts:_loadThumbnailsForLevel` | — | ❌ 无行为测试（仅 mock 存在） |
| `library-core.ts:renderFullscreenFolder` | — | ❌ 无行为测试 |
| `ui-resource-panel.ts` | — | ❌ UI builder 组件豁免 |
| `internal/thumbnail/thumbnail.go` | — | ⚠️ 未检查 |

---

## 性能分析

| 阶段 | 复杂度 | 瓶颈 |
|------|--------|------|
| GPU 像素读取 | O(512×512) ≈ 1MB | `readPixels` 同步调用，主线程阻塞 |
| base64 编码 | O(1MB) | `canvas.toDataURL` 压缩 |
| 磁盘写入 | O(1MB) | `os.WriteFile` |
| 批量加载 | O(n) | `GetBatch` 顺序调用 |
| 懒加载渲染 | O(visible) | IntersectionObserver 回调 |

**大数据量场景**（万级模型库）：
- 首次进入目录时 `GetBatch` 加载数千个缩略图，单次请求 body 可能达数十 MB
- `IntersectionObserver` 永不 unobserve 导致每次滚动检查所有已加载项（O(n)）
- 虚拟滚动 `VirtualGrid` 仅渲染可见行，DOM 节点数可控

---

## 改进优先级

| 优先级 | 风险 | 模块 | 建议 |
|--------|------|------|------|
| 🔴 P2 | 并发生成竞态 | `model-loader.ts` | 加 generation counter + disposed 标志 |
| 🔴 P2 | 键值不一致 | 全链路 | 统一 `thumbnailKey` 函数 |
| 🔴 P2 | 死代码 | `model-manager.ts` | 删除未使用的 `captureThumbnail` |
| 🟡 P3 | Observer 永不 unobserve | `ui-resource-panel.ts` | 成功加载后 `unobserve` |
| 🟡 P3 | 全量替换缓存 | `library-core.ts` | 改为增量合并 |
| 🟡 P3 | updateItems 操作已卸载节点 | `ui-resource-panel.ts` | 加 `isConnected` 守卫 |
| 🟡 P3 | 帧等待不足 | `model-loader.ts` | 增加捕获延迟 / 多帧等待 |
| 🟡 P3 | 重复键值函数 | `library-core.ts` | 抽取公共函数 |
| 🟢 P4 | 无测试覆盖 | 全链路 | 补充 `_loadThumbnailsForLevel` 等测试 |
| 🟢 P4 | 列数硬编码 | `ui-resource-panel.ts` | 读取 CSS 变量 |
| 🟢 P4 | 失败无声 | `model-loader.ts` | 状态栏提示 |

---

## 结论

缩略图系统的**架构设计总体合理**：离屏渲染、独立相机、SHA-256 缓存键、双回退策略、IntersectionObserver 懒加载等设计均体现了良好的工程实践。尤其是 `setThumbnailCache` 的原位突变策略，确保了所有 `liveThumbnailCache` 引用自动感知缓存更新——这是经过实战考验的精心设计。

**主要风险集中在三处**：
1. **并发安全**：`captureThumbnail` 无任何并发守卫，快速切换模型时可能产生脏数据
2. **键值一致性**：save 与 load 两条路径使用不同的键构造逻辑，ZIP 包场景下必然失配
3. **死代码**：`model-manager.ts` 中的 `captureThumbnail` 从未在生产路径被调用，纯属测试假人

**建议优先修复 3 项 P2**，然后依次处理 P3 的观察器泄漏和缓存替换策略。修复后补充 `_loadThumbnailsForLevel` 的单元测试，以锁定关键路径的正确性。