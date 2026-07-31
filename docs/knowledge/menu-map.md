# 菜单层级地图（自动生成）

> 由 `scripts/gen-menu-map.mjs` 从 `frontend/src/menus/**/*.ts` 自动提取，**勿手改**。
> 重新生成：`node scripts/gen-menu-map.mjs`（仓库根目录）。

覆盖三部分静态菜单骨架：
1. **Schema 树**（ADR-093 声明式）：`build*Schema(): MenuNode[]` 的层级（folder 嵌套 children）。
2. **根导航 items**：`items.push({...})` / `items: [...]` 的 PopupRow（target 路由）。
3. **target 路由映射**：`case '<target>': return build*Level()`。

> ⚠ 局限：`renderCustom`/`custom` 内部运行时生成的行、命令式 `slideRow` 行无法静态提取。

---

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

### Schema: buildParticleSchema()

- **custom** `env:particle:type` · `env.none`
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

- **custom** `open-with:root` · `model-detail.model`

### Schema: buildModelSchema()


### Schema: buildModelInfoSchema()


### Schema: buildModelTagsSchema()


### Schema: buildMorphPreviewSchema()

- **custom** `morph-preview:root` · —

### Schema: buildBoneHierarchySchema()


## model-material.ts

### Schema: buildMatRootSchema()

- **custom** `mat-root:groups` · — lucide:layers
- **custom** `mat-root:param-card` · —
- **custom** `mat-root:unlit-fallback` · —
- **custom** `mat-root:reset` · —

## motion-binding-ui.ts

### Schema: buildActionBindingSchema()


## motion-camera-levels.ts

### Schema: buildCameraSchema()

- **custom** `camera:main` · `string`
- **custom** `camera:behavior` · `string`
- **custom** `camera:behavior-na` · —
- **custom** `camera:auto-interval` · —
- **custom** `camera:params` · —
- **custom** `camera:vmd` · —
- **custom** `camera:common` · —
- **custom** `camera:lens` · —

## motion-cloth-levels.ts

### Schema: buildVirtualSkirtSchema()

- **custom** `cloth:toggle` · —
- **custom** `cloth:params` · `cloth.qualityAuto`
- **custom** `cloth:status` · —

## motion-detail-ui.ts

### Schema: buildPlaybackSpeedSchema()

- **custom** `playback-speed:slider` · —

## motion-override-levels.ts

### Schema: buildBoneOverrideSchema()

- **custom** `override:empty` · —

## motion-pose-levels.ts

### Schema: buildPoseStudioSchema()

- **custom** `pose:empty` · —

## motion-procmotion-levels.ts

### 导航 items（items.push）

| kind | label | icon | target |
|------|-------|------|--------|
| action | `PROC_LABELS` | isNone | — |

### Schema: buildProcMotionSchema()

- **custom** `procmotion:main` · `motion.modeOff`
- **custom** `procmotion:params` · —
- **folder** `procmotion:bone-micro` · `motion.boneMicro` lucide:activity
  - **custom** `procmotion:bone-micro-content` · —
- **custom** `procmotion:advanced` · `motion.interpAuto`

## motion-root-ui.ts

### 导航 items（items.push）

| kind | label | icon | target |
|------|-------|------|--------|
| sectionTitle | `motion.section.loadedMotion` | — | — |
| action | `motion.section.loadedMotionEmpty` | lucide:inbox | — |
| action | `motion.vmdName` | radioIcon | `__motion_detail__:${motion.id ?? ''}` |
| divider | — | — | — |
| sectionTitle | `motion.section.loadedProc` | — | — |
| action | `_procLabel` | radioIcon | — |
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
  - **custom** `postprocess:optical:aa` · —
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
- **custom** `light:list` · — lucide:plus
- **custom** `light:basic` · `scene.spot` lucide:lightbulb
- **custom** `light:cone` · — lucide:flashlight
- **custom** `light:spot-params` · — lucide:sliders
- **custom** `light:point-params` · — lucide:sliders
- **custom** `light:dir-params` · — lucide:compass
- **custom** `light:shadow` · `scene.hardShadow` lucide:cloud
- **custom** `light:follow` · — lucide:crosshair
- **custom** `light:transform` · — lucide:move-3d
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

- **custom** `diagnostic:panel` · `string`

## settings-graphics.ts

### Schema: buildFrameQualitySchema()

- **toggle** `settings:graphics:frame-cap` · `settings.perf.frameCap` lucide:monitor-check
- **custom** `settings:graphics:frame-cap-hint` · —
- **slider** `settings:graphics:fps` · `settings.perf.fpsCap` lucide:gauge
- **custom** `settings:graphics:fps-hint` · —
- **slider** `settings:graphics:render-scale` · `settings.perf.renderScale` lucide:scan
- **custom** `settings:graphics:render-scale-hint` · —

### Schema: buildEffectsSchema()

- **custom** `settings:graphics:toggles` · `string`

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

