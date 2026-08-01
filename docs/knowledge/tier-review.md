# 知识卡 tier 标注复核队列（ADR-218 P3）

> 生成时间：2026-08-01 ｜ 模式：preview
> 机器自动判 architecture（import 广度 ≥ 2 顶层目录）：**76 张**（--apply 已写入 / 待写入）
> 需人工复核：**121 张**

## 一、机器已自动标 architecture（广度 ≥ 2）

| 卡 | 广度 | 引用顶层目录 |
|----|------|--------------|
| ai-config-store.md | 2 | core,menus |
| ai-error-buffer.md | 2 | core,menus |
| ai-scene-snapshot.md | 2 | core,scene |
| ai-service.md | 2 | core,menus |
| android-file-access.md | 2 | core,menus |
| animation-retargeter.md | 2 | menus,scene |
| ar-camera.md | 2 | menus,scene |
| audio-bus.md | 2 | menus,scene |
| bone-override.md | 2 | menus,scene |
| camera-state.md | 2 | core,scene |
| camera.md | 3 | core,menus,scene |
| core-backend.md | 3 | core,menus,scene |
| env-bridge.md | 3 | core,menus,scene |
| env-collision.md | 2 | menus,scene |
| env-gravity.md | 2 | menus,scene |
| env-ground.md | 2 | scene,menus |
| env-impl.md | 2 | motion-algos,scene |
| env-lighting.md | 2 | menus,scene |
| env-menu.md | 2 | core,menus |
| env-persist.md | 2 | menus,scene |
| env-time-of-day.md | 3 | core,menus,scene |
| env-water.md | 2 | scene,menus |
| feedback.md | 3 | core,menus,scene |
| goerr.md | 3 | core,menus,scene |
| gpu-capabilities.md | 2 | core,scene |
| i18n-t.md | 4 | core,menus,outfit,scene |
| library-actions.md | 2 | core,menus |
| library-core.md | 2 | core,menus |
| library-setup.md | 2 | core,menus |
| lighting-follow.md | 2 | menus,scene |
| lighting-presets.md | 2 | menus,scene |
| lipsync-bridge.md | 2 | core,scene |
| load-manager.md | 3 | core,menus,scene |
| load-refresh-registry.md | 3 | core,menus,scene |
| locale.md | 2 | core,menus |
| material.md | 2 | outfit,scene |
| menu-overlay.md | 2 | core,menus |
| menu-schema.md | 2 | menus,scene |
| menu-stack-registry.md | 2 | core,menus |
| menu.md | 2 | core,menus |
| mmd-adapter.md | 3 | outfit,physics,scene |
| model-ops.md | 3 | core,menus,scene |
| model-preset-ui.md | 2 | menus,scene |
| motion-binding-ui.md | 2 | core,menus |
| motion-detail-ui.md | 2 | core,menus |
| motion-feet-adjustment.md | 2 | motion-algos,scene |
| motion-history.md | 3 | core,menus,scene |
| motion-intent.md | 3 | core,menus,scene |
| motion-menu-levels.md | 2 | core,menus |
| motion-module-base.md | 3 | core,menus,scene |
| motion-modules-registry.md | 2 | menus,scene |
| motion-playback.md | 2 | core,scene |
| observer-handle.md | 5 | core,motion-algos,outfit,physics,scene |
| orbit-state.md | 2 | core,scene |
| perception.md | 2 | menus,scene |
| performance.md | 3 | core,menus,scene |
| platform.md | 2 | core,menus |
| plaza-state.md | 2 | core,menus |
| proc-motion-bridge.md | 3 | core,menus,scene |
| reactivity.md | 3 | core,menus,scene |
| render-loop.md | 2 | core,menus |
| renderer.md | 2 | menus,scene |
| runtime-mode.md | 2 | core,scene |
| safe-call.md | 5 | core,menus,motion-algos,outfit,physics |
| scene-menu.md | 2 | core,menus |
| scene-serialize.md | 2 | core,scene |
| settings-shared.md | 2 | core,menus |
| shortcut-registry.md | 2 | core,menus |
| transform-adapter.md | 2 | menus,scene |
| transform-mode.md | 2 | menus,scene |
| transform-selection.md | 2 | menus,scene |
| ui-keyboard-nav.md | 2 | core,menus |
| vmd-layers.md | 2 | menus,scene |
| vmd-loader.md | 2 | core,scene |
| wails-bindings.md | 4 | core,menus,outfit,scene |
| wind-physics.md | 2 | core,scene |

## 二、待人工复核（建议 tier + 理由）

| 卡 | 广度 | 引用顶层目录 | 建议 | 理由 |
|----|------|--------------|------|------|
| ai-intent-dispatcher.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| ai-sse.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| ar-scene.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| ar-webxr-probe.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| assistant-panel.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| bone-override-store.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| camera-angle.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| camera-auto.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| camera-behaviors.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| camera-bone-lock.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| camera-factory.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| camera-vmd.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| character-bible.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| chat-store.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| composition-guide.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| core-orbit.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| dev-hooks.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| diagnostic-actions.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| diagnostic-chat.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| diagnostic-config.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| diagnostic-control.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| diagnostic-session.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| diagnostic-state.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| drop-import.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| env-caustics.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-clouds.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-context.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-dispatcher.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-menu-levels.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| env-particles.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-reflection.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-sky.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-terrain.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-texture.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-underwater-fog.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| env-wetness.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| events.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| fileservice.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| ground-collision.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| hand-symmetry.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| init.md | 0 | — | leaf | 未检测到外部引用，纯叶子/内部用途 → 建议 leaf |
| library-browse.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| library-session-store.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| light-cone.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| lighting-shadow.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| lighting-stage.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| lighting-state.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| lighting-sun.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| lighting-tween.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| markdown.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| menu-factory.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| menu-registry.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| menu-schema-register.md | 0 | — | leaf | 未检测到外部引用，纯叶子/内部用途 → 建议 leaf |
| mirror-debug.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| mmar-globals.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| model-detail.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| model-id.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| model-manager.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| model-material-ui.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| motion-footstep.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| motion-math.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| motion-module-types.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| motion-modules-body-posture.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| motion-modules-feet.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| motion-modules-riding.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| motion-override-levels.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| motion-preset-types.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| outfit-ui.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| perception-balance.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-blinking.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-breathing.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-expression.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-gaze-js.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-gaze-wasm.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-gaze.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-lipsync.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-observer.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| perception-shared.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| performance-env-bridge.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| physics-bridge.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| planar-reflection.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| plaza-browser.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| plaza-creators.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| plaza-download.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| plaza-sites.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| plaza-thumbnail.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| pmx-meta.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| preset-list-viewer.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| preset-meta.md | 0 | — | leaf | 未检测到外部引用，纯叶子/内部用途 → 建议 leaf |
| quality-profile.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| render-menu.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| scene-bundle.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| scene-drag-levels.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| scene-menu-levels.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| scene-menu-state.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| scene-migrate.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| settings-about.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-actions.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-appearance.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-controls.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-diagnostic.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-graphics.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-language.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-media.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-resources.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-system.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| settings-targets.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| shortcut-app.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| skirt-analyzer.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| texture-lru.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| thumbnail-capture.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| transform-gizmo.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| transform-pick.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| ui-focus-trap.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| ui-nav-item.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| ui-preset.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| ui-slider-controller.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| ui-state.md | 1 | core | leaf | 仅被 1 个顶层目录引用（core），单调用方倾向 → 建议 leaf |
| virtual-skirt.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
| wasm-layers-blender.md | 1 | scene | leaf | 仅被 1 个顶层目录引用（scene），单调用方倾向 → 建议 leaf |
| watermark.md | 1 | menus | leaf | 仅被 1 个顶层目录引用（menus），单调用方倾向 → 建议 leaf |
