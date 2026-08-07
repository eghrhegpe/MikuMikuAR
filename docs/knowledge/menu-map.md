---
kind: menu_map
name: 菜单层级地图（自动生成）
tier: architecture
category: ui
scope:
  - frontend/src/menus/*.ts
source_files:
  - frontend/src/menus/diagnostic-chat.ts
  - frontend/src/menus/diagnostic-config.ts
  - frontend/src/menus/diagnostic-session.ts
  - frontend/src/menus/env-menu.ts
  - frontend/src/menus/library-core.ts
  - frontend/src/menus/model-detail.ts
  - frontend/src/menus/model-material.ts
  - frontend/src/menus/motion-binding-ui.ts
  - frontend/src/menus/motion-camera-levels.ts
  - frontend/src/menus/motion-cloth-levels.ts
  - frontend/src/menus/motion-detail-ui.ts
  - frontend/src/menus/motion-override-levels.ts
  - frontend/src/menus/motion-popup.ts
  - frontend/src/menus/motion-pose-levels.ts
  - frontend/src/menus/motion-procmotion-levels.ts
  - frontend/src/menus/motion-root-ui.ts
  - frontend/src/menus/outfit-ui.ts
  - frontend/src/menus/scene-menu.ts
  - frontend/src/menus/scene-physics-levels.ts
  - frontend/src/menus/scene-render-levels.ts
  - frontend/src/menus/scene-render-presets.ts
  - frontend/src/menus/scene-stage-lights.ts
  - frontend/src/menus/settings-controls.ts
  - frontend/src/menus/settings-diagnostic.ts
  - frontend/src/menus/settings-graphics.ts
  - frontend/src/menus/settings-resources.ts
  - frontend/src/menus/settings-system.ts
  - frontend/src/menus/settings.ts
adr:
  - ADR-093
  - ADR-218
invariants:
  - 由 scripts/gen-menu-map.mjs 自动生成，禁止手改（--check 守护一致性）
  - renderCustom/custom 运行时行与 slideRow 行无法静态提取，缺口由对应知识卡 ## UI 入口 补足
tests:
  - npm run gen:menumap -- --check（一致性校验）
use_when:
  - 菜单层级
  - 菜单有哪些项
  - 菜单路由
  - 菜单怎么扩展
  - 菜单地图
---

# 菜单层级地图（自动生成）

> 由 `scripts/gen-menu-map.mjs` 从 `frontend/src/menus/**/*.ts` 自动提取，**勿手改**。
> 重新生成：`node scripts/gen-menu-map.mjs`（仓库根目录）。
> 本文档 `menu-map.md` 为菜单 UI 入口的机器生成事实源（ADR-218），静态归此、动态归对应知识卡。

覆盖三部分静态菜单骨架：
1. **Schema 树**（ADR-093 声明式）：`build*Schema(): MenuNode[]` 的层级（folder 嵌套 children）。
2. **根导航 items**：`items.push({...})` / `items: [...]` 的 PopupRow（target 路由）。
3. **target 路由映射**：`case '<target>': return build*Level()`。

> ⚠ 局限：`renderCustom`/`custom` 内部运行时生成的行、命令式 `slideRow` 行无法静态提取。

---

## 入口一览（怎么打开）

| 入口函数 | 文件 |
|----------|------|
| `showPendingBubble()` | `diagnostic-chat.ts` |
| `buildCloudLevel()` | `env-cloud-levels.ts` |
| `buildExperimentalLevel()` | `env-experimental-levels.ts` |
| `buildFogLevel()` | `env-fog-levels.ts` |
| `buildGroundLevel()` | `env-ground-levels.ts` |
| `buildEnvLevel()` | `env-menu.ts` |
| `buildParticleLevel()` | `env-menu.ts` |
| `buildPresetLevel()` | `env-preset-levels.ts` |
| `buildShadowLevel()` | `env-shadow-levels.ts` |
| `buildSkyLevel()` | `env-sky-levels.ts` |
| `buildWaterLevel()` | `env-water-levels.ts` |
| `buildWindLevel()` | `env-wind-levels.ts` |
| `showModelPopup()` | `library-browse.ts` |
| `buildModelFormationLevel()` | `library-core.ts` |
| `buildCameraLevel()` | `motion-camera-levels.ts` |
| `buildVirtualSkirtLevel()` | `motion-cloth-levels.ts` |
| `buildPlaybackSpeedLevel()` | `motion-detail-ui.ts` |
| `buildGazeTrackingLevel()` | `motion-gaze-levels.ts` |
| `buildAdvancedBoneOverrideLevel()` | `motion-override-levels.ts` |
| `buildPoseStudioLevel()` | `motion-pose-levels.ts` |
| `buildProcLibraryLevel()` | `motion-procmotion-levels.ts` |
| `buildMotionRootLevel()` | `motion-root-ui.ts` |
| `buildRetargetLevel()` | `motion-root-ui.ts` |
| `buildDragModeLevel()` | `scene-drag-levels.ts` |
| `buildPhysicsLevel()` | `scene-physics-levels.ts` |
| `buildWasmPhysicsLevel()` | `scene-physics-levels.ts` |
| `buildPhysicsDebugLevel()` | `scene-physics-levels.ts` |
| `buildPresetScenesLevel()` | `scene-render-levels.ts` |
| `buildPostProcessLevel()` | `scene-render-levels.ts` |
| `buildPresetsLevel()` | `scene-render-presets.ts` |
| `buildStageLevel()` | `scene-stage-levels.ts` |
| `buildStageLightLevel()` | `scene-stage-lights.ts` |
| `buildSettingsLanguageLevel()` | `settings-language.ts` |

## 快捷键（shortcut-app.ts）

| id | label | 默认键 | Ctrl | 分组 |
|----|-------|--------|------|------|
| `toggle:model` | `shortcuts.label.models` | `Digit1` | ✓ | shortcuts.group.popupNav |
| `toggle:motion` | `shortcuts.label.motion` | `Digit2` | ✓ | shortcuts.group.popupNav |
| `toggle:scene` | `shortcuts.label.scene` | `Digit3` | ✓ | shortcuts.group.popupNav |
| `toggle:env` | `shortcuts.label.env` | `Digit4` | ✓ | shortcuts.group.popupNav |
| `toggle:settings` | `shortcuts.label.settings` | `Digit5` | ✓ | shortcuts.group.popupNav |
| `toggle:plaza` | `shortcuts.label.plaza` | `Digit7` | ✓ | shortcuts.group.popupNav |
| `toggle:assistant` | `shortcuts.label.assistant` | `Digit8` | ✓ | shortcuts.group.popupNav |
| `playback:toggle` | `shortcuts.label.playPause` | `Space` | — | shortcuts.group.playbackControl |
| `global:close` | `shortcuts.label.closePopup` | `Escape` | — | shortcuts.group.global |
| `playback:seek-back` | `shortcuts.label.seekBack` | `ArrowLeft` | — | shortcuts.group.playbackControl |
| `playback:seek-forward` | `shortcuts.label.seekForward` | `ArrowRight` | — | shortcuts.group.playbackControl |
| `screenshot:current` | `shortcuts.label.screenshot` | `F2` | — | shortcuts.group.screenshot |
| `motion:undo` | `shortcuts.label.motionUndo` | `KeyZ` | ✓ | shortcuts.group.motionUndoRedo |
| `motion:redo` | `shortcuts.label.motionRedo` | `KeyZ` | ✓ | shortcuts.group.motionUndoRedo |

## diagnostic-chat.ts

### Schema: buildChatSchema()

- **custom** `diagnostic:chat` · —

## diagnostic-config.ts

### Schema: buildConfigSchema()

- **custom** `diagnostic:config` · —

## diagnostic-session.ts

### Schema: buildSessionsSchema()

- **custom** `diagnostic:sessions` · —

## env-menu.ts

### 导航 items（items.push）

| kind | label | icon | target |
|------|-------|------|--------|
| folder | `env.presets` | lucide:bookmark | `env:presets` |
| divider | — | — | — |
| folder | `env.sky` | lucide:sun | `env:sky` |
| folder | `env.particle` | lucide:sparkles | `env:particle` |
| folder | `env.wind` | lucide:wind | `env:wind` |
| folder | `env.fog` | lucide:cloud-fog | `env:fog` |
| folder | `env.shadow` | lucide:umbrella | `env:shadow` |
| folder | `env.experimental` | lucide:flask-conical | `env:experimental` |
| folder | `scene.postProcess` | lucide:wand-2 | `env:postprocess` |
| folder | `env.cloud` | lucide:cloud | `env:cloud` |

### target 路由

| target | builder |
|--------|---------|
| `env:sky` | `buildSkyLevel` |
| `env:particle` | `buildParticleLevel` |
| `env:wind` | `buildWindLevel` |
| `env:fog` | `buildFogLevel` |
| `env:shadow` | `buildShadowLevel` |
| `env:cloud` | `buildCloudLevel` |
| `env:experimental` | `buildExperimentalLevel` |
| `env:presets` | `buildPresetLevel` |
| `env:postprocess` | `buildPostProcessLevel` |

### Schema: buildParticleSchema()

- **custom** `env:particle:type` · —
- **slider** `env:particle:density` · `env.density` lucide:layers
- **slider** `env:particle:size` · `env.size` lucide:maximize
- **slider** `env:particle:speed` · `env.speed` lucide:gauge
- **toggle** `env:particle:splash` · `env.splash` lucide:droplets
- **custom** `env:particle:texture` · —

## library-core.ts

### 导航 items（items.push）

| kind | label | icon | target |
|------|-------|------|--------|
| action | `inst.name` | radioIcon | `scene:${id}` |
| divider | — | — | — |
| folder | `scene.formation` | lucide:layout-grid | `models:formation` |
| folder | `library.loadModel` | lucide:folder | `models:browse` |
| action | `library.importFile` | lucide:file-plus | `models:import-file` |
| action | `library.rescan` | lucide:refresh-cw | `models:rescan` |
| folder | `library.recent` | lucide:clock | `__recent__` |
| folder | `library.tags` | lucide:tag | `__tags__` |

## model-detail.ts

### Schema: buildOpenWithSchema()

- **custom** `open-with:root` · —

### Schema: buildModelSchema()

- **custom** `model:main` · —

### Schema: buildModelInfoSchema()

- **custom** `model-info:root` · —

### Schema: buildModelTagsSchema()

- **custom** `model-tags:fav` · —
- **custom** `model-tags:picker` · —

### Schema: buildMorphPreviewSchema()

- **custom** `morph-preview:root` · —

### Schema: buildBoneHierarchySchema()

- **custom** `bone-hierarchy:root` · —

## model-material.ts

### Schema: buildMatRootSchema()

- **custom** `mat-root:groups` · —
- **custom** `mat-root:param-card` · —
- **custom** `mat-root:unlit-fallback` · —
- **custom** `mat-root:reset` · —

## motion-binding-ui.ts

### Schema: buildActionBindingSchema()

- **custom** `binding:pose` · —
- **custom** `binding:assignment` · —
- **custom** `binding:tools` · —

## motion-camera-levels.ts

### Schema: buildCameraSchema()

- **custom** `camera:main` · —
- **custom** `camera:behavior` · —
- **custom** `camera:behavior-na` · —
- **custom** `camera:auto-interval` · —
- **custom** `camera:params` · —
- **custom** `camera:vmd` · —
- **custom** `camera:common` · —
- **custom** `camera:lens` · —

## motion-cloth-levels.ts

### Schema: buildVirtualSkirtSchema()

- **custom** `cloth:toggle` · —
- **custom** `cloth:params` · —
- **custom** `cloth:status` · —

## motion-detail-ui.ts

### Schema: buildPlaybackSpeedSchema()

- **custom** `playback-speed:slider` · —

## motion-override-levels.ts

### Schema: buildBoneOverrideSchema()

- **custom** `override:empty` · —

## motion-popup.ts

### target 路由

| target | builder |
|--------|---------|
| `motion:camera` | `buildCameraLevel` |
| `motion:playbackSpeed` | `buildPlaybackSpeedLevel` |
| `motion:proc-library` | `buildProcLibraryLevel` |
| `motion:gaze` | `buildGazeTrackingLevel` |
| `motion:poseStudio` | `buildPoseStudioLevel` |
| `motion:retarget` | `buildRetargetLevel` |

## motion-pose-levels.ts

### Schema: buildPoseStudioSchema()

- **custom** `pose:empty` · —

## motion-procmotion-levels.ts

### 导航 items（items.push）

| kind | label | icon | target |
|------|-------|------|--------|
| action | `PROC_LABELS` | isNone | — |

### Schema: buildProcMotionSchema()

- **custom** `procmotion:main` · —
- **custom** `procmotion:presets` · —
- **custom** `procmotion:params` · —
- **folder** `procmotion:bone-micro` · `motion.boneMicro` lucide:activity
  - **custom** `procmotion:bone-micro-content` · —
- **custom** `procmotion:advanced` · —

## motion-root-ui.ts

### 导航 items（items.push）

| kind | label | icon | target |
|------|-------|------|--------|
| sectionTitle | `motion.section.loadedMotion` | — | — |
| action | `motion.section.loadedMotionEmpty` | lucide:inbox | — |
| action | `motion.vmdName` | radioIcon | `__motion_detail__:${motion.id ?? ''}` |
| divider | — | — | — |
| sectionTitle | `motion.section.loadedProc` | — | — |
| action | `_procLabel` | radioIcon | `isNone` |
| divider | — | — | — |
| sectionTitle | `motion.section.library` | — | — |
| action | `motion.browseMotionLibrary` | lucide:folder-search | `__scene_motion_browse__` |
| folder | `motion.procMotion` | lucide:wand-sparkles | `motion:proc-library` |
| action | `getAudioName` | lucide:music | `__music_browse__` |
| divider | — | — | — |
| sectionTitle | `motion.section.more` | — | — |
| folder | `motion.camera` | lucide:video | `motion:camera` |
| folder | `motion.poseStudio.title` | lucide:camera | `motion:poseStudio` |
| folder | `motion.gazeTracking` | lucide:eye | `motion:gaze` |
| folder | `motion.externalImport` | lucide:upload | `motion:retarget` |

### 根级 items（items: [...]）

| kind | label | icon | target |
|------|-------|------|--------|
| action | `motion.retarget.mixamo` | lucide:user | `__retarget_mixamo__` |
| action | `motion.retarget.vrm` | lucide:user | `__retarget_vrm__` |
| action | `motion.retarget.customMap` | lucide:edit | `__retarget_custom__` |

## outfit-ui.ts

### Schema: buildOutfitSchema()

- **custom** `outfit:main` · —

## scene-menu.ts

### 导航 items（items.push）

| kind | label | icon | target |
|------|-------|------|--------|
| folder | `scene.stageLight` | lucide:lightbulb | `scene:stageLight` |
| folder | `env.ground` | lucide:square | `scene:ground` |
| folder | `env.water` | lucide:waves | `scene:water` |
| folder | `scene.dragMode` | lucide:move-3d | `scene:dragMode` |
| folder | `scene.stage` | lucide:monitor | `scene:render:stage` |
| folder | `scene.physics` | lucide:atom | `scene:physics` |
| folder | `scene.presetScenes` | lucide:bookmark | `scene:presets` |
| folder | `scene.mirror` | lucide:scan | `scene:mirror` |
| modeSlider | `env.reflectionQuality` | lucide:monitor | — |
| modeSlider | `env.reflectionMode` | lucide:layers | — |

### target 路由

| target | builder |
|--------|---------|
| `scene:presets` | `buildPresetScenesLevel` |
| `scene:render:stage` | `buildStageLevel` |
| `scene:stageLight` | `buildStageLightLevel` |
| `scene:ground` | `buildGroundLevel` |
| `scene:water` | `buildWaterLevel` |
| `scene:dragMode` | `buildDragModeLevel` |
| `scene:physics` | `buildPhysicsLevel` |
| `scene:mirror` | `buildMirrorLevel` |
| `physics:wasm` | `buildWasmPhysicsLevel` |

## scene-physics-levels.ts

### Schema: buildWasmPhysicsSchema()

- **custom** `wasm:global` · —
- **custom** `wasm:ground` · —

### Schema: buildPhysicsDebugSchema()

- **custom** `debug:wireframe` · —

## scene-render-levels.ts

### Schema: buildPostProcessCoreSchema()

- **folder** `postprocess:bloom` · `scene.bloom` lucide:sun
  - **slider** `postprocess:bloom:weight` · `scene.intensity` lucide:sun
  - **slider** `postprocess:bloom:threshold` · `scene.threshold` lucide:sliders
  - **slider** `postprocess:bloom:kernel` · `scene.kernelSize` lucide:circle
  - **toggle** `postprocess:bloom:outline` · `scene.outline` lucide:square
- **slider** `postprocess:vignette` · `scene.vignette` lucide:circle-dot
- **slider** `postprocess:sharpen` · `scene.sharpen` lucide:focus
- **folder** `postprocess:optical` · `scene.opticalEffects` lucide:sparkles
  - **slider** `postprocess:optical:grain` · `scene.grain` lucide:grid-3x3
  - **slider** `postprocess:optical:chromatic` · `scene.chromatic` lucide:rainbow
  - **slider** `postprocess:optical:glow` · `scene.glow` lucide:sparkles
- **folder** `postprocess:env` · `scene.environmentEffects` lucide:box
  - **toggle** `postprocess:env:ssao` · `scene.ssao` lucide:box
  - **slider** `postprocess:env:ssao:strength` · `scene.ssaoStrength` lucide:contrast
  - **slider** `postprocess:env:ssao:radius` · `scene.ssaoRadius` lucide:circle-dot
  - **slider** `postprocess:env:ssao:samples` · `scene.ssaoSamples` lucide:grid-3x3

### Schema: buildPostProcessColorSchema()

- **folder** `postprocess:tonemapping` · `scene.toneMapping` lucide:palette
  - **custom** `postprocess:tonemapping:mode` · —
  - **slider** `postprocess:tonemapping:exposure` · `scene.exposure` lucide:lightbulb
  - **slider** `postprocess:tonemapping:contrast` · `scene.contrast` lucide:contrast
  - **toggle** `postprocess:tonemapping:cel` · `scene.celShading` lucide:droplet
  - **slider** `postprocess:tonemapping:cel-levels` · `scene.celColorLevels` lucide:layers
  - **slider** `postprocess:tonemapping:cel-edge-threshold` · `scene.celEdgeThreshold` lucide:scan-line
  - **slider** `postprocess:tonemapping:cel-edge-strength` · `scene.celEdgeStrength` lucide:pen-line

## scene-render-presets.ts

### Schema: buildPresetsSchema()

- **custom** `presets:builtin` · —
- **custom** `presets:save` · —
- **custom** `presets:user` · —

## scene-stage-lights.ts

### Schema: buildStageLightSchema()

- **custom** `light:presets` · —
- **custom** `light:list` · —
- **custom** `light:basic` · —
- **custom** `light:cone` · —
- **custom** `light:spot-params` · —
- **custom** `light:point-params` · —
- **custom** `light:dir-params` · —
- **custom** `light:shadow` · —
- **custom** `light:follow` · —
- **custom** `light:transform` · —
- **custom** `light:delete` · —

## settings-controls.ts

### Schema: buildCameraSchema()

- **slider** `settings:perf:cam-sens` · `settings.perf.camSens` lucide:move
- **custom** `settings:perf:cam-sens-hint` · —
- **toggle** `settings:perf:invert-y` · `settings.perf.invertY` lucide:flip-vertical
- **custom** `settings:perf:invert-y-hint` · —
- **toggle** `settings:perf:auto-center` · `settings.perf.autoCenter` lucide:crosshair
- **custom** `settings:perf:auto-center-hint` · —

## settings-diagnostic.ts

### Schema: buildDiagnosticSchema()

- **custom** `diagnostic:panel` · —

## settings-graphics.ts

### Schema: buildFrameQualitySchema()

- **toggle** `settings:graphics:frame-cap` · `settings.perf.frameCap` lucide:monitor-check
- **custom** `settings:graphics:frame-cap-hint` · —
- **slider** `settings:graphics:fps` · `settings.perf.fpsCap` lucide:gauge
- **custom** `settings:graphics:fps-hint` · —
- **slider** `settings:graphics:render-scale` · `settings.perf.renderScale` lucide:scan
- **custom** `settings:graphics:render-scale-hint` · —

### Schema: buildEffectsSchema()

- **custom** `settings:graphics:toggles` · —

### Schema: buildPhysicsHudSchema()

- **toggle** `settings:graphics:default-physics` · `settings.perf.defaultPhysics` lucide:atom
- **custom** `settings:graphics:default-physics-hint` · —
- **toggle** `settings:graphics:show-fps-clock` · `settings.perf.showFpsClock` lucide:gauge
- **toggle** `settings:graphics:show-runtime-badge` · `settings.perf.showRuntimeBadge` lucide:cpu

## settings-resources.ts

### Schema: buildOverrideSchema()

- **custom** `resources:override` · —

## settings-system.ts

### 根级 items（items: [...]）

| kind | label | icon | target |
|------|-------|------|--------|
| action | `settings.software.notFound` | alert-circle | — |

### Schema: buildCacheSchema()

- **custom** `system:cache` · —

## settings.ts

### 导航 items（items.push）

| kind | label | icon | target |
|------|-------|------|--------|
| folder | `settings.appearance` | lucide:palette | `SETTINGS.APPEARANCE` |
| folder | `settings.graphics` | lucide:monitor | `SETTINGS.GRAPHICS` |
| folder | `settings.controls` | lucide:gamepad-2 | `SETTINGS.CONTROLS` |
| folder | `settings.resources` | lucide:folder-tree | `SETTINGS.RESOURCES` |
| folder | `settings.downloads` | lucide:download | `SETTINGS.DOWNLOADS` |
| folder | `settings.media` | lucide:clapperboard | `SETTINGS.MEDIA` |
| folder | `settings.system` | lucide:settings-2 | `SETTINGS.SYSTEM` |
| folder | `settings.about` | lucide:info | `SETTINGS.ABOUT` |

