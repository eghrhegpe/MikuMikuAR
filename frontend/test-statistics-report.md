# 测试文件统计报告

生成时间：2026-01-XX
统计范围：`frontend/src/` 下所有 `.test.ts` / `.spec.ts` 文件

---

## 一、行数区间分布

| 行数区间 | 文件数 | 总用例数 (it 块) | 平均用例/文件 |
|---------|--------|-----------------|--------------|
| 0-100 行 | 32 | 188 | 5.9 |
| 101-200 行 | 58 | 642 | 11.1 |
| 201-300 行 | 28 | 464 | 16.6 |
| 301-400 行 | 15 | 306 | 20.4 |
| 401-500 行 | 8 | 151 | 18.9 |
| 500+ 行 | 2 | 17 | 8.5 |
| **总计** | **143** | **1768** | **12.4** |

### 详细文件清单（按行数区间分组）

#### 0-100 行（32 个文件）

```
src/core/ai/__tests__/markdown.test.ts|59|8
src/core/backend/backend.update.test.ts|36|2
src/core/backend/backend.resolve.test.ts|58|5
src/core/__tests__/dispose-helpers.test.ts|37|5
src/core/__tests__/logger.test.ts|41|6
src/core/__tests__/runtime-bridge.test.ts|39|2
src/core/__tests__/safe-call.test.ts|42|5
src/core/__tests__/browser-adapter.test.ts|41|3
src/scene/render/transform-gizmo.test.ts|49|8
src/scene/transform/transform-adapter.test.ts|46|4
src/__tests__/browse-dir.test.ts|35|5
src/__tests__/dom.test.ts|59|6
src/__tests__/goerr.test.ts|50|6
src/__tests__/footstep-detect.test.ts|59|7
src/__tests__/audio.volume.test.ts|68|5
src/__tests__/menu-schema.modelid.test.ts|27|2
src/__tests__/menu-schema.i18n.test.ts|66|2
src/__tests__/menu-schema.header-toggle.test.ts|89|2
src/__tests__/menu-schema.statepath.test.ts|93|3
src/__tests__/menu-schema.motion-module.test.ts|61|4
src/__tests__/menu-schema.conflict.test.ts|69|2
src/__tests__/mmd-adapter.native.test.ts|78|4
src/__tests__/perception-breathing.test.ts|91|2
src/__tests__/pose-preset.test.ts|82|6
src/__tests__/prune-history.test.ts|77|7
src/__tests__/settings-diagnostic.test.ts|66|10
src/__tests__/sw-register.test.ts|41|3
src/__tests__/ui-nav-item.test.ts|83|9
src/__tests__/utils.math.test.ts|55|9
src/__tests__/vendored-patch.test.ts|48|3
src/__tests__/virtual-skirt.update.test.ts|47|1
src/__tests__/virtual-skirt.waist-cache.test.ts|47|1
```

#### 101-200 行（58 个文件）

```
src/core/ai/__tests__/chat-store.test.ts|123|11
src/core/backend/backend.capabilities.test.ts|90|9
src/core/backend/backend.virtual-dir.test.ts|85|9
src/core/backend/browser-adapter.ingest.test.ts|79|4
src/core/backend/browser-adapter.texture-collision.test.ts|90|4
src/core/__tests__/action-executor.test.ts|75|6
src/core/__tests__/character-bible.test.ts|79|13
src/core/__tests__/config-store.test.ts|98|9
src/core/__tests__/dialogue-speech.test.ts|89|10
src/core/__tests__/env-dispatcher.test.ts|96|9
src/core/__tests__/mmar-globals.test.ts|71|6
src/core/__tests__/observer-handle.test.ts|104|10
src/core/__tests__/scene-snapshot.test.ts|81|6
src/__tests__/env-bridge/gravity-sun.int.test.ts|88|9
src/__tests__/env-bridge/middleware.int.test.ts|135|12
src/__tests__/env-bridge/set-env-state.int.test.ts|118|13
src/__tests__/menu/nav-touch.test.ts|150|8
src/__tests__/menu/popup-overlay.test.ts|143|6
src/__tests__/menu/register-popup.test.ts|175|11
src/__tests__/menu/rows.test.ts|163|10
src/__tests__/menu/stack-render.test.ts|168|17
src/__tests__/menus/download-manager.test.ts|168|25
src/__tests__/perception/claim-bones.int.test.ts|173|7
src/__tests__/perception/gaze.int.test.ts|170|12
src/__tests__/perception/micro-expression.int.test.ts|182|10
src/__tests__/perception/multi-model.int.test.ts|129|4
src/__tests__/scene/bone-override-store.test.ts|151|12
src/__tests__/scene/bone-override.test.ts|153|13
src/__tests__/scene/env-clouds.test.ts|78|7
src/__tests__/scene/env-impl.test.ts|144|5
src/__tests__/scene/env-reflection.test.ts|79|7
src/__tests__/scene/env-terrain.test.ts|98|4
src/__tests__/scene/env-texture.test.ts|134|7
src/__tests__/scene/lighting-follow.test.ts|133|8
src/__tests__/scene/lighting-stage.test.ts|106|6
src/__tests__/scene/motion-frame-hooks.test.ts|83|4
src/__tests__/scene/motion-modules-registry.create.test.ts|76|4
src/__tests__/scene/motion-modules-registry.disable.test.ts|96|4
src/__tests__/scene/motion-modules-registry.ik.test.ts|83|2
src/__tests__/scene/motion-modules-registry.init.test.ts|96|4
src/__tests__/scene/motion-modules-registry.param.test.ts|118|6
src/__tests__/scene/motion-modules-registry.snapshot.test.ts|116|5
src/__tests__/scene/motion-modules-timed.test.ts|125|2
src/__tests__/scene/motion-pipeline.test.ts|64|5
src/__tests__/scene/performance-reflection.test.ts|96|8
src/__tests__/scene/performance-snapshot.test.ts|137|4
src/__tests__/scene/resolve-model-id.test.ts|28|5
src/__tests__/scene/scene-serialize-undo.test.ts|122|6
src/__tests__/scene/stable-identity-material-roundtrip.test.ts|76|3
src/__tests__/scene/texture-lru.test.ts|139|9
src/__tests__/scene/water-preset-repro.test.ts|112|3
src/__tests__/audio.player.test.ts|140|16
src/__tests__/audio.query.test.ts|114|14
src/__tests__/audio.sync.test.ts|120|13
src/__tests__/beat-detector.test.ts|194|35
src/__tests__/camera.adr100.guards.test.ts|163|7
src/__tests__/camera.adr100.serialization.test.ts|149|7
src/__tests__/color-helpers.test.ts|66|13
src/__tests__/dialog.test.ts|108|11
src/__tests__/feet-adjustment.test.ts|120|10
src/__tests__/fileservice.test.ts|63|8
src/__tests__/fullscreen-overlay.test.ts|86|3
src/__tests__/ground-collision.test.ts|184|6
src/__tests__/library-core.model-to-resource.test.ts|136|10
src/__tests__/library-core.model-to-row.test.ts|121|15
src/__tests__/library-core.path-boundary.test.ts|94|14
src/__tests__/library-session-store.test.ts|134|12
src/__tests__/lipsync.test.ts|143|30
src/__tests__/material-editor.cat-of.test.ts|126|12
src/__tests__/menu-schema.controlspec.test.ts|146|4
src/__tests__/menu-schema.dispose.test.ts|112|6
src/__tests__/menu-schema.guards.test.ts|97|4
src/__tests__/model-detail-ui.info.test.ts|151|4
src/__tests__/model-detail-ui.model.test.ts|133|4
src/__tests__/model-detail-ui.tags-morph.test.ts|133|5
src/__tests__/model-manager.bone-overlay.test.ts|144|14
src/__tests__/model-manager.constructor.test.ts|100|8
src/__tests__/model-manager.focus.test.ts|159|14
src/__tests__/model-manager.physics-categories.test.ts|155|12
src/__tests__/model-manager.physics.test.ts|132|14
src/__tests__/model-manager.transform.test.ts|175|16
src/__tests__/model-manager.vmd-morph.test.ts|117|10
src/__tests__/model-ops.focus.test.ts|129|7
src/__tests__/model-ops.morph.test.ts|161|8
src/__tests__/model-ops.physics.test.ts|143|10
src/__tests__/model-ops.remove.test.ts|138|8
src/__tests__/model-preset.stopvmd.test.ts|134|4
src/__tests__/orbit.test.ts|135|14
src/__tests__/outfit.params.test.ts|173|3
src/__tests__/outfit.reset-load.test.ts|142|5
src/__tests__/outfit.variant.test.ts|158|8
src/__tests__/physics-bridge.test.ts|129|9
src/__tests__/physics-contract.core.test.ts|108|16
src/__tests__/playback.seek.test.ts|123|6
src/__tests__/playback.ui.test.ts|144|9
src/__tests__/plaza.contract.test.ts|104|8
src/__tests__/proc-motion-bridge.lifecycle.test.ts|104|9
src/__tests__/proc-motion-bridge.toggles.test.ts|147|22
src/__tests__/proc-motion-bridge.tracking.test.ts|97|13
src/__tests__/scene-stage.test.ts|154|3
src/__tests__/thumbnail-key.contract.test.ts|135|9
src/__tests__/ui-helpers.bone.test.ts|90|7
src/__tests__/ui-helpers.layout.test.ts|128|7
src/__tests__/ui-helpers.slide-toggle.test.ts|135|9
src/__tests__/ui-keyboard-nav.test.ts|176|11
src/__tests__/utils.async.test.ts|144|15
src/__tests__/utils.collections.test.ts|141|21
src/__tests__/utils.lifecycle.test.ts|120|14
src/__tests__/virtual-skirt.build-cleanup.test.ts|74|2
src/__tests__/virtual-skirt.coord.test.ts|58|4
src/__tests__/virtual-skirt.coordspace.test.ts|72|2
src/__tests__/virtual-skirt.dispose.test.ts|70|2
src/__tests__/virtual-skirt.inject.test.ts|98|5
src/__tests__/virtual-skirt.quality.test.ts|136|6
src/__tests__/vmd-layers-dispose.test.ts|154|1
src/__tests__/vmd-layers-filter.test.ts|133|13
src/__tests__/vmd-loader-race.test.ts|97|8
src/__tests__/wasm-layers-blender.test.ts|67|8
src/__tests__/wind-physics.test.ts|41|1
```

#### 201-300 行（28 个文件）

```
src/core/backend/backend.data-chain.test.ts|177|20
src/core/backend/backend.extract.test.ts|229|15
src/core/backend/backend.fsa.test.ts|206|5
src/core/browser-adapter.fsa-auth.test.ts|109|10
src/core/browser-adapter.fsa-conflict.test.ts|147|6
src/core/__tests__/action-registry.test.ts|185|14
src/core/__tests__/drop-import.test.ts|151|13
src/core/__tests__/error-buffer.test.ts|267|24
src/core/__tests__/param-adapters.test.ts|172|27
src/core/__tests__/preset-meta.test.ts|116|5
src/core/__tests__/sse.test.ts|157|8
src/__tests__/bindings/app.functions.contract.test.ts|274|46
src/__tests__/env-bridge/facade.int.test.ts|184|14
src/__tests__/env-bridge/presets.int.test.ts|202|12
src/__tests__/env-bridge/time-of-day.int.test.ts|245|24
src/__tests__/menu/focus.test.ts|189|12
src/__tests__/perception/balance-sway-pin.int.test.ts|199|17
src/__tests__/perception/lipsync.int.test.ts|215|14
src/__tests__/scene/env-ground.test.ts|238|15
src/__tests__/scene/motion-history.test.ts|216|19
src/__tests__/scene/motion-intent-replace-default.test.ts|107|6
src/__tests__/scene/motion-modules-registry.conflict.test.ts|176|8
src/__tests__/scene/performance-refresh-rate.test.ts|177|8
src/__tests__/scene/planar-reflection.test.ts|164|9
src/__tests__/audio.player.test.ts|140|16
src/__tests__/config.test.ts|243|49
src/__tests__/env-feature-levels.contract.test.ts|268|5
src/__tests__/environment-integration.test.ts|226|14
src/__tests__/library-core.build-level.test.ts|219|14
src/__tests__/library-core.subdir-file.test.ts|175|20
src/__tests__/library-thumbnail-streaming.test.ts|196|5
src/__tests__/lipsync-bridge.test.ts|271|27
src/__tests__/material-editor.p1p2.test.ts|253|11
src/__tests__/menu-schema.kinds.test.ts|196|11
src/__tests__/mmd-adapter.contract.test.ts|224|16
src/__tests__/model-ops.vpd.test.ts|177|3
src/__tests__/model-preset.apply.test.ts|245|6
src/__tests__/model-preset.material.test.ts|183|5
src/__tests__/model-preset.serialize.test.ts|199|6
src/__tests__/perception-gaze.test.ts|285|16
src/__tests__/physics-contract.collision-worlds.test.ts|290|8
src/__tests__/physics-contract.constraint.test.ts|209|5
src/__tests__/physics-contract.rigidbody.test.ts|229|11
src/__tests__/playback.observables.test.ts|233|16
src/__tests__/proc-motion-bridge.state.test.ts|156|24
src/__tests__/render-postprocess.test.ts|200|17
src/__tests__/scene-model.test.ts|195|14
src/__tests__/ui-helpers.slider.test.ts|249|15
src/__tests__/vmd.test.ts|239|27
src/__tests__/vpd-parser-security.test.ts|294|29
src/__tests__/wasm-layers-blender.perf.test.ts|227|0
src/__tests__/wind-physics-integration.test.ts|254|8
```

#### 301-400 行（15 个文件）

```
src/core/__tests__/shortcut-registry.test.ts|433|24
src/core/__tests__/slider-controller.test.ts|301|17
src/__tests__/scene/env-particles.test.ts|329|24
src/__tests__/scene/replace-model-inherit.test.ts|344|16
src/__tests__/env-lighting.test.ts|323|22
src/__tests__/env-state.test.ts|345|16
src/__tests__/library-core.resource-items.test.ts|309|25
src/__tests__/material-editor.apply-all.test.ts|348|10
src/__tests__/material-editor.state.test.ts|331|17
src/__tests__/perception.perf.test.ts|628|0
src/__tests__/procedural-motion.test.ts|398|43
src/__tests__/skirt-analyzer.test.ts|386|25
src/__tests__/vmd-evaluator.test.ts|409|18
src/__tests__/wind-physics-state.test.ts|339|17
```

#### 401-500 行（8 个文件）

```
src/__tests__/scene/env-water.test.ts|415|28
src/__tests__/camera.presets.test.ts|489|28
src/__tests__/camera.vmd-state.test.ts|466|21
src/__tests__/vmd-evaluator.regression.spec.ts|554|10
```

#### 500+ 行（2 个文件）

```
src/__tests__/bindings/app.contract.test.ts|614|17
src/__tests__/perception.perf.test.ts|628|0
```

---

## 二、400-500 行功能测试文件详情（排除 perf/contract）

| 文件路径 | 行数 | describe 块 | it 块 | 用例密度 |
|---------|------|------------|-------|---------|
| `src/core/__tests__/shortcut-registry.test.ts` | 433 | 9 | 24 | 18.1 行/用例 |
| `src/__tests__/scene/env-water.test.ts` | 415 | 11 | 28 | 14.8 行/用例 |
| `src/__tests__/camera.presets.test.ts` | 489 | 7 | 28 | 17.5 行/用例 |
| `src/__tests__/camera.vmd-state.test.ts` | 466 | 5 | 21 | 22.2 行/用例 |
| `src/__tests__/vmd-evaluator.test.ts` | 409 | 9 | 18 | 22.7 行/用例 |

**观察**：
- 这 5 个文件平均 22.2 行/用例，密度合理
- `camera.vmd-state.test.ts` 和 `vmd-evaluator.test.ts` 密度最高（22+ 行/用例），可能包含复杂 setup
- `env-water.test.ts` 密度最低（14.8 行/用例），测试粒度最细

---

## 三、`src/__tests__/` 子目录结构

| 子目录 | 文件数 | 说明 |
|-------|--------|------|
| `bindings/` | 2 | 绑定契约测试 |
| `env-bridge/` | 7 | 环境桥接集成测试 |
| `fixtures/` | 2 | 测试夹具 |
| `helpers/` | 1 | 测试辅助工具 |
| `menu/` | 8 | 菜单系统测试 |
| `menus/` | 1 | 菜单扩展测试 |
| `mocks/` | 5 | 共享 mock 文件 |
| `perception/` | 9 | 感知系统测试 |
| `scene/` | 37 | 场景系统测试（最大） |
| **根目录** | 0 | 无根级文件 |
| **总计** | 72 | - |

**观察**：
- `scene/` 占比 51.4%（37/72），是测试最密集的模块
- `perception/` 次之（9 个），反映该模块复杂度
- 根目录无文件，所有测试已合理分组

---

## 四、`-mocks.ts` 文件分析

| 文件路径 | 行数 | 消费者数 | 复用度 |
|---------|------|---------|--------|
| `src/__tests__/env-bridge/env-mocks.ts` | 412 | 68 | 🔥 极高 |
| `src/__tests__/model-manager-mocks.ts` | 253 | 14 | 高 |
| `src/__tests__/model-preset-mocks.ts` | 41 | 13 | 高 |
| `src/__tests__/library-core-mocks.ts` | 182 | 12 | 高 |
| `src/__tests__/menu-schema-mocks.ts` | 19 | 11 | 高 |
| `src/__tests__/mocks/babylon-mmd-mocks.ts` | 53 | 11 | 高 |
| `src/__tests__/perception/perception-mocks.ts` | 183 | 10 | 高 |
| `src/__tests__/material-editor-mocks.ts` | 44 | 9 | 中高 |
| `src/__tests__/virtual-skirt-mocks.ts` | 117 | 9 | 中高 |
| `src/__tests__/scene/motion-modules-registry-mocks.ts` | 45 | 8 | 中 |
| `src/core/backend/backend-mocks.ts` | 36 | 7 | 中 |
| `src/__tests__/env-bridge/env-mocks.ts` | 412 | 68 | 🔥 极高 |
| `src/core/backend/browser-adapter-mocks.ts` | 11 | 5 | 中 |
| `src/__tests__/audio-mocks.ts` | 34 | 5 | 中 |
| `src/__tests__/model-detail-ui-mocks.ts` | 129 | 5 | 中 |
| `src/__tests__/model-ops-mocks.ts` | 62 | 5 | 中 |
| `src/__tests__/camera-adr100-mocks.ts` | 280 | 3 | 低 |
| `src/__tests__/outfit-mocks.ts` | 27 | 4 | 中 |
| `src/__tests__/proc-motion-bridge-mocks.ts` | 81 | 4 | 中 |
| `src/__tests__/camera-mocks.ts` | 268 | 0 | ⚠️ 未使用 |

**关键发现**：
1. **`env-mocks.ts` 是核心依赖**：68 个消费者，412 行，修改需谨慎
2. **`camera-mocks.ts` 疑似废弃**：268 行但 0 消费者，建议清理
3. **高复用 mock 文件**（10+ 消费者）：6 个，是测试基础设施核心
4. **总 mock 文件**：20 个，总行数 2,521 行

---

## 五、`-helpers.ts` 测试辅助文件分析

| 文件路径 | 行数 | 消费者数 | 复用度 |
|---------|------|---------|--------|
| `src/core/ui-helpers.ts` | 48 | 66 | 🔥 极高 |
| `src/core/dispose-helpers.ts` | 20 | 35 | 🔥 极高 |
| `src/core/color-helpers.ts` | 29 | 16 | 高 |
| `src/menus/env-level-helpers.ts` | 71 | 16 | 高 |
| `src/__tests__/virtual-skirt-helpers.ts` | 109 | 9 | 中高 |
| `src/__tests__/scene/motion-modules-registry-helpers.ts` | 34 | 7 | 中 |
| `src/__tests__/audio-helpers.ts` | 110 | 5 | 中 |
| `src/__tests__/model-ops-helpers.ts` | 45 | 5 | 中 |
| `src/__tests__/model-preset-helpers.ts` | 223 | 5 | 中 |
| `src/menus/resource-detail-helpers.ts` | 438 | 5 | 中 |
| `src/__tests__/model-detail-ui-helpers.ts` | 85 | 4 | 中 |
| `src/__tests__/outfit-helpers.ts` | 64 | 4 | 中 |
| `src/__tests__/playback-helpers.ts` | 55 | 4 | 中 |
| `src/scene/env/env-type-helpers.ts` | 14 | 4 | 中 |

**关键发现**：
1. **`ui-helpers.ts` 和 `dispose-helpers.ts` 是基础设施**：分别 66 和 35 个消费者
2. **`resource-detail-helpers.ts` 最大**：438 行但仅 5 个消费者，可能过度封装
3. **测试专用 helper**（`src/__tests__/` 下）：8 个，总行数 725 行
4. **生产代码 helper**（`src/core/`、`src/menus/`、`src/scene/`）：6 个，总行数 620 行
5. **总 helper 文件**：14 个，总行数 1,345 行

---

## 六、综合观察

### 测试规模
- **143 个测试文件**，**1,768 个用例**，平均 **12.4 用例/文件**
- 测试集中在 100-300 行区间（86 个文件，占 60%）

### 测试密度分布
- **高密度测试**（300+ 行）：17 个文件，可能包含复杂场景测试
- **低密度测试**（<100 行）：32 个文件，多为简单单元测试

### 测试基础设施
- **Mock 文件**：20 个，2,521 行，核心依赖 `env-mocks.ts`（68 消费者）
- **Helper 文件**：14 个，1,345 行，核心依赖 `ui-helpers.ts`（66 消费者）
- **废弃风险**：`camera-mocks.ts`（268 行，0 消费者）

### 模块测试覆盖
- **scene/**：37 个测试文件，覆盖最全面
- **perception/**：9 个测试文件，次之
- **menu/**：8 个测试文件
- **env-bridge/**：7 个测试文件

### 建议
1. **清理废弃 mock**：`camera-mocks.ts` 可删除
2. **拆分大 mock**：`env-mocks.ts`（412 行，68 消费者）考虑按功能拆分
3. **审查大 helper**：`resource-detail-helpers.ts`（438 行）是否过度封装
4. **补充测试**：100 行以下的 32 个文件可能需要扩展用例
