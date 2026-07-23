```mermaid
graph TD;

    n0["config.ts"]

    n1["core/audio-bus.ts"]
    n2["core/backend/browser-adapter.ts"]
    n3["core/backend/go-adapter.ts"]
    n4["core/backend/idb.ts"]
    n5["core/backend/index.ts"]
    n6["core/backend/types.ts"]
    n7["core/color-helpers.ts"]
    n8["core/config.ts"]
    n9["core/dev-hooks.ts"]
    n10["core/dialog.ts"]
    n11["core/dispose-helpers.ts"]
    n12["core/dom.ts"]
    n13["core/env-state-schema.ts"]
    n14["core/events.ts"]
    n15["core/fileservice.ts"]
    n16["core/freefly-state.ts"]
    n17["core/i18n/goerr.ts"]
    n18["core/i18n/locale.ts"]
    n19["core/i18n/locales/en.ts"]
    n20["core/i18n/locales/ja.ts"]
    n21["core/i18n/locales/ko.ts"]
    n22["core/i18n/locales/zh-CN.ts"]
    n23["core/i18n/locales/zh-TW.ts"]
    n24["core/i18n/t.ts"]
    n25["core/icons-bundle.ts"]
    n26["core/icons.ts"]
    n27["core/init.ts"]
    n28["core/library-state.ts"]
    n29["core/load-manager.ts"]
    n30["core/logger.ts"]
    n31["core/main.ts"]
    n32["core/observer-handle.ts"]
    n33["core/orbit.ts"]
    n34["core/platform.ts"]
    n35["core/playback-state.ts"]
    n36["core/reactivity.ts"]
    n37["core/render-loop.ts"]
    n38["core/runtime-mode.ts"]
    n39["core/safe-call.ts"]
    n40["core/scene-state.ts"]
    n41["core/shortcut-app.ts"]
    n42["core/shortcut-registry.ts"]
    n43["core/state.ts"]
    n44["core/status-bar.ts"]
    n45["core/toast.ts"]
    n46["core/types.ts"]
    n47["core/ui-advanced-rows.ts"]
    n48["core/ui-collapsible.ts"]
    n49["core/ui-constants.ts"]
    n50["core/ui-focus-trap.ts"]
    n51["core/ui-fullscreen-overlay.ts"]
    n52["core/ui-helpers.ts"]
    n53["core/ui-keyboard-nav.ts"]
    n54["core/ui-preset.ts"]
    n55["core/ui-resource-panel.ts"]
    n56["core/ui-rows.ts"]
    n57["core/ui-slide-row.ts"]
    n58["core/ui-slider-controller.ts"]
    n59["core/ui-state.ts"]
    n60["core/ui-types.ts"]
    n61["core/ui-virtual-grid.ts"]
    n62["core/utils.ts"]
    n63["core/wails-bindings.ts"]
    n64["core/watch-import.ts"]
    n65["core/wind-utils.ts"]

    n66["menus/env-cloud-levels.ts"]
    n67["menus/env-experimental-levels.ts"]
    n68["menus/env-fog-levels.ts"]
    n69["menus/env-ground-levels.ts"]
    n70["menus/env-level-helpers.ts"]
    n71["menus/env-menu-state.ts"]
    n72["menus/env-menu.ts"]
    n73["menus/env-preset-levels.ts"]
    n74["menus/env-shadow-levels.ts"]
    n75["menus/env-sky-levels.ts"]
    n76["menus/env-water-levels.ts"]
    n77["menus/env-wind-levels.ts"]
    n78["menus/library-actions.ts"]
    n79["menus/library-browse.ts"]
    n80["menus/library-core.ts"]
    n81["menus/library-session-store.ts"]
    n82["menus/library-setup.ts"]
    n83["menus/library.ts"]
    n84["menus/menu-factory.ts"]
    n85["menus/menu-schema.ts"]
    n86["menus/menu.ts"]
    n87["menus/model-detail.ts"]
    n88["menus/model-material.ts"]
    n89["menus/model-preset.ts"]
    n90["menus/motion-binding-ui.ts"]
    n91["menus/motion-camera-levels.ts"]
    n92["menus/motion-cloth-levels.ts"]
    n93["menus/motion-detail-ui.ts"]
    n94["menus/motion-feet-levels.ts"]
    n95["menus/motion-gaze-levels.ts"]
    n96["menus/motion-override-levels.ts"]
    n97["menus/motion-popup.ts"]
    n98["menus/motion-pose-levels.ts"]
    n99["menus/motion-procmotion-levels.ts"]
    n100["menus/motion-root-ui.ts"]
    n101["menus/outfit-ui.ts"]
    n102["menus/plaza-browser.ts"]
    n103["menus/plaza-creators.ts"]
    n104["menus/plaza-download.ts"]
    n105["menus/plaza-sites.ts"]
    n106["menus/plaza-state.ts"]
    n107["menus/plaza-thumbnail.ts"]
    n108["menus/preset-list-viewer.ts"]
    n109["menus/render-menu.ts"]
    n110["menus/resource-detail-helpers.ts"]
    n111["menus/scene-drag-levels.ts"]
    n112["menus/scene-menu-state.ts"]
    n113["menus/scene-menu.ts"]
    n114["menus/scene-physics-levels.ts"]
    n115["menus/scene-prop-levels.ts"]
    n116["menus/scene-render-levels.ts"]
    n117["menus/scene-render-presets.ts"]
    n118["menus/scene-stage-levels.ts"]
    n119["menus/scene-stage-lights.ts"]
    n120["menus/settings-about.ts"]
    n121["menus/settings-actions.ts"]
    n122["menus/settings-appearance.ts"]
    n123["menus/settings-controls.ts"]
    n124["menus/settings-graphics.ts"]
    n125["menus/settings-language.ts"]
    n126["menus/settings-media.ts"]
    n127["menus/settings-resources.ts"]
    n128["menus/settings-shared.ts"]
    n129["menus/settings-system.ts"]
    n130["menus/settings-targets.ts"]
    n131["menus/settings.ts"]

    n132["motion-algos/beat-detector.ts"]
    n133["motion-algos/feet-adjustment-math.ts"]
    n134["motion-algos/footstep-detect-fallback.ts"]
    n135["motion-algos/footstep-detect.ts"]
    n136["motion-algos/lipsync.ts"]
    n137["motion-algos/pose-preset.ts"]
    n138["motion-algos/proc-motion-autodance-bones-limbs.ts"]
    n139["motion-algos/proc-motion-autodance-bones-trunk.ts"]
    n140["motion-algos/proc-motion-autodance-bones.ts"]
    n141["motion-algos/proc-motion-autodance-emotion.ts"]
    n142["motion-algos/proc-motion-autodance.ts"]
    n143["motion-algos/proc-motion-idle.ts"]
    n144["motion-algos/proc-motion-shared.ts"]
    n145["motion-algos/procedural-motion.ts"]
    n146["motion-algos/vmd-evaluator.ts"]
    n147["motion-algos/vmd-writer.ts"]
    n148["motion-algos/vpd-parser.ts"]

    n149["outfit/audio.ts"]
    n150["outfit/outfit-overlay.ts"]
    n151["outfit/outfit.ts"]

    n152["physics/physics-bridge.ts"]
    n153["physics/wind-physics.ts"]

    n154["scene/ar/ar-camera.ts"]
    n155["scene/ar/ar-scene.ts"]
    n156["scene/ar/ar-webxr-probe.ts"]
    n157["scene/camera/camera-state.ts"]
    n158["scene/camera/camera.ts"]
    n159["scene/camera/invertablePointersInput.ts"]
    n160["scene/env/accessory.ts"]
    n161["scene/env/env-bridge.ts"]
    n162["scene/env/env-clouds.ts"]
    n163["scene/env/env-context.ts"]
    n164["scene/env/env-dispatcher.ts"]
    n165["scene/env/env-ground.ts"]
    n166["scene/env/env-impl.ts"]
    n167["scene/env/env-lighting.ts"]
    n168["scene/env/env-particles.ts"]
    n169["scene/env/env-reflection.ts"]
    n170["scene/env/env-sky.ts"]
    n171["scene/env/env-terrain.ts"]
    n172["scene/env/env-texture.ts"]
    n173["scene/env/env-type-helpers.ts"]
    n174["scene/env/env-water.ts"]
    n175["scene/env/env-wetness.ts"]
    n176["scene/env/env.ts"]
    n177["scene/env/mirror-debug.ts"]
    n178["scene/env/planar-reflection.ts"]
    n179["scene/env/preset-manager.ts"]
    n180["scene/env/props.ts"]
    n181["scene/manager/material.ts"]
    n182["scene/manager/model-loader.ts"]
    n183["scene/manager/model-manager.ts"]
    n184["scene/manager/model-ops.ts"]
    n185["scene/manager/thumbnail-capture.ts"]
    n186["scene/manager/thumbnail-key.ts"]
    n187["scene/motion/animation-retargeter.ts"]
    n188["scene/motion/bone-override-store.ts"]
    n189["scene/motion/bone-override.ts"]
    n190["scene/motion/feet-adjustment.ts"]
    n191["scene/motion/footstep.ts"]
    n192["scene/motion/lipsync-bridge.ts"]
    n193["scene/motion/motion-intent.ts"]
    n194["scene/motion/motion-modules/body-posture.ts"]
    n195["scene/motion/motion-modules/finger-pose.ts"]
    n196["scene/motion/motion-modules/hand-symmetry.ts"]
    n197["scene/motion/motion-modules/module-base.ts"]
    n198["scene/motion/motion-modules/motion-history.ts"]
    n199["scene/motion/motion-modules/motion-math.ts"]
    n200["scene/motion/motion-modules/position-offset.ts"]
    n201["scene/motion/motion-modules/preset-types.ts"]
    n202["scene/motion/motion-modules/registry.ts"]
    n203["scene/motion/motion-modules/riding-model.ts"]
    n204["scene/motion/motion-modules/sway-motion.ts"]
    n205["scene/motion/motion-modules/types.ts"]
    n206["scene/motion/motion-pipeline.ts"]
    n207["scene/motion/perception-balance.ts"]
    n208["scene/motion/perception-blinking.ts"]
    n209["scene/motion/perception-breathing.ts"]
    n210["scene/motion/perception-expression.ts"]
    n211["scene/motion/perception-gaze-js.ts"]
    n212["scene/motion/perception-gaze-wasm.ts"]
    n213["scene/motion/perception-gaze.ts"]
    n214["scene/motion/perception-lipsync.ts"]
    n215["scene/motion/perception-observer.ts"]
    n216["scene/motion/perception-shared.ts"]
    n217["scene/motion/perception.ts"]
    n218["scene/motion/playback.ts"]
    n219["scene/motion/proc-motion-bridge.ts"]
    n220["scene/motion/vmd-layers.ts"]
    n221["scene/motion/vmd-loader.ts"]
    n222["scene/motion/wasm-layers-blender.ts"]
    n223["scene/motion/wasm-layers-config.ts"]
    n224["scene/physics/ground-collision.ts"]
    n225["scene/physics/skirt-analyzer.ts"]
    n226["scene/physics/virtual-skirt.ts"]
    n227["scene/pose/camera-angle.ts"]
    n228["scene/pose/composition-guide.ts"]
    n229["scene/pose/watermark.ts"]
    n230["scene/render/light-cone.ts"]
    n231["scene/render/lighting-follow.ts"]
    n232["scene/render/lighting-presets.ts"]
    n233["scene/render/lighting-shadow.ts"]
    n234["scene/render/lighting-stage.ts"]
    n235["scene/render/lighting-state.ts"]
    n236["scene/render/lighting-sun.ts"]
    n237["scene/render/lighting-tween.ts"]
    n238["scene/render/lighting.ts"]
    n239["scene/render/performance-env-bridge.ts"]
    n240["scene/render/performance.ts"]
    n241["scene/render/quality-profile.ts"]
    n242["scene/render/renderer.ts"]
    n243["scene/render/transform-gizmo.ts"]
    n244["scene/scene-bundle.ts"]
    n245["scene/scene-migrate.ts"]
    n246["scene/scene-serialize.ts"]
    n247["scene/scene.ts"]
    n248["scene/transform/transform-adapter.ts"]
    n249["scene/transform/transform-mode.ts"]
    n250["scene/transform/transform-pick.ts"]

    n251["web-loader/library.ts"]
    n252["web-loader/main.ts"]

    n2 --> n6;
    n2 --> n4;
    n3 --> n6;
    n5 --> n6;
    n5 --> n3;
    n5 --> n2;
    n5 --> n34;
    n9 --> n247;
    n9 --> n151;
    n10 --> n24;
    n10 --> n50;
    n12 --> n24;
    n14 --> n8;
    n14 --> n247;
    n14 --> n16;
    n14 --> n158;
    n14 --> n24;
    n14 --> n34;
    n14 --> n12;
    n14 --> n83;
    n14 --> n102;
    n14 --> n106;
    n14 --> n29;
    n14 --> n63;
    n14 --> n184;
    n14 --> n39;
    n14 --> n42;
    n14 --> n62;
    n15 --> n63;
    n17 --> n24;
    n18 --> n36;
    n24 --> n18;
    n24 --> n22;
    n24 --> n19;
    n24 --> n20;
    n24 --> n21;
    n24 --> n23;
    n27 --> n8;
    n27 --> n24;
    n27 --> n17;
    n27 --> n25;
    n27 --> n18;
    n27 --> n63;
    n27 --> n34;
    n27 --> n131;
    n27 --> n128;
    n27 --> n247;
    n27 --> n38;
    n27 --> n44;
    n27 --> n7;
    n27 --> n62;
    n27 --> n45;
    n27 --> n39;
    n27 --> n240;
    n27 --> n83;
    n27 --> n102;
    n27 --> n106;
    n27 --> n158;
    n27 --> n161;
    n27 --> n42;
    n27 --> n9;
    n27 --> n37;
    n27 --> n14;
    n27 --> n41;
    n27 --> n12;
    n27 --> n10;
    n27 --> n246;
    n28 --> n46;
    n29 --> n17;
    n31 --> n27;
    n37 --> n247;
    n37 --> n240;
    n37 --> n8;
    n37 --> n62;
    n37 --> n30;
    n37 --> n32;
    n37 --> n11;
    n38 --> n12;
    n39 --> n30;
    n40 --> n46;
    n41 --> n8;
    n41 --> n24;
    n41 --> n43;
    n41 --> n247;
    n41 --> n158;
    n41 --> n42;
    n41 --> n113;
    n41 --> n198;
    n41 --> n197;
    n41 --> n14;
    n42 --> n30;
    n42 --> n12;
    n42 --> n11;
    n43 --> n36;
    n43 --> n46;
    n43 --> n13;
    n44 --> n12;
    n44 --> n43;
    n44 --> n24;
    n45 --> n24;
    n46 --> n63;
    n46 --> n57;
    n46 --> n13;
    n47 --> n26;
    n47 --> n60;
    n47 --> n56;
    n47 --> n7;
    n47 --> n58;
    n48 --> n26;
    n48 --> n86;
    n51 --> n30;
    n51 --> n12;
    n51 --> n50;
    n51 --> n53;
    n51 --> n24;
    n53 --> n12;
    n54 --> n48;
    n55 --> n26;
    n55 --> n61;
    n55 --> n43;
    n55 --> n11;
    n56 --> n26;
    n56 --> n86;
    n56 --> n60;
    n56 --> n57;
    n56 --> n24;
    n56 --> n58;
    n56 --> n49;
    n57 --> n26;
    n57 --> n86;
    n58 --> n12;
    n59 --> n46;
    n62 --> n12;
    n62 --> n43;
    n62 --> n15;
    n62 --> n44;
    n62 --> n24;
    n62 --> n17;
    n62 --> n86;
    n62 --> n30;
    n63 --> n5;
    n63 --> n6;
    n64 --> n8;
    n64 --> n24;
    n64 --> n63;
    n64 --> n83;
    n64 --> n128;
    n64 --> n62;
    n64 --> n39;
    n65 --> n8;
    n66 --> n8;
    n66 --> n24;
    n66 --> n109;
    n66 --> n85;
    n66 --> n70;
    n67 --> n24;
    n67 --> n109;
    n67 --> n85;
    n67 --> n8;
    n67 --> n70;
    n68 --> n8;
    n68 --> n24;
    n68 --> n109;
    n68 --> n85;
    n68 --> n70;
    n69 --> n8;
    n69 --> n52;
    n69 --> n247;
    n69 --> n24;
    n69 --> n165;
    n69 --> n109;
    n69 --> n85;
    n69 --> n70;
    n69 --> n71;
    n69 --> n112;
    n70 --> n8;
    n70 --> n62;
    n70 --> n71;
    n71 --> n86;
    n72 --> n8;
    n72 --> n84;
    n72 --> n52;
    n72 --> n247;
    n72 --> n238;
    n72 --> n62;
    n72 --> n24;
    n72 --> n109;
    n72 --> n12;
    n72 --> n85;
    n72 --> n75;
    n72 --> n77;
    n72 --> n67;
    n72 --> n68;
    n72 --> n74;
    n72 --> n66;
    n72 --> n70;
    n72 --> n73;
    n72 --> n116;
    n72 --> n71;
    n73 --> n8;
    n73 --> n52;
    n73 --> n62;
    n73 --> n39;
    n73 --> n24;
    n73 --> n17;
    n73 --> n247;
    n73 --> n238;
    n73 --> n167;
    n73 --> n63;
    n73 --> n72;
    n73 --> n108;
    n73 --> n18;
    n74 --> n26;
    n74 --> n8;
    n74 --> n52;
    n74 --> n24;
    n74 --> n238;
    n74 --> n109;
    n74 --> n85;
    n74 --> n70;
    n75 --> n8;
    n75 --> n52;
    n75 --> n247;
    n75 --> n24;
    n75 --> n167;
    n75 --> n161;
    n75 --> n43;
    n75 --> n109;
    n75 --> n85;
    n75 --> n70;
    n76 --> n8;
    n76 --> n52;
    n76 --> n247;
    n76 --> n24;
    n76 --> n174;
    n76 --> n109;
    n76 --> n85;
    n76 --> n70;
    n76 --> n71;
    n77 --> n8;
    n77 --> n24;
    n77 --> n109;
    n77 --> n85;
    n77 --> n70;
    n78 --> n8;
    n78 --> n29;
    n78 --> n247;
    n78 --> n97;
    n78 --> n52;
    n78 --> n12;
    n78 --> n63;
    n78 --> n62;
    n78 --> n24;
    n78 --> n26;
    n78 --> n80;
    n78 --> n81;
    n79 --> n8;
    n79 --> n29;
    n79 --> n86;
    n79 --> n24;
    n79 --> n30;
    n79 --> n63;
    n79 --> n87;
    n79 --> n113;
    n79 --> n247;
    n79 --> n80;
    n79 --> n78;
    n79 --> n82;
    n79 --> n81;
    n80 --> n8;
    n80 --> n86;
    n80 --> n11;
    n80 --> n52;
    n80 --> n55;
    n80 --> n62;
    n80 --> n24;
    n80 --> n18;
    n80 --> n63;
    n80 --> n29;
    n80 --> n247;
    n80 --> n87;
    n80 --> n78;
    n80 --> n79;
    n82 --> n34;
    n82 --> n63;
    n82 --> n8;
    n82 --> n62;
    n82 --> n30;
    n82 --> n39;
    n82 --> n10;
    n82 --> n24;
    n82 --> n17;
    n82 --> n80;
    n82 --> n79;
    n84 --> n8;
    n84 --> n86;
    n84 --> n11;
    n86 --> n8;
    n86 --> n26;
    n86 --> n52;
    n86 --> n57;
    n86 --> n36;
    n86 --> n24;
    n86 --> n18;
    n86 --> n30;
    n86 --> n39;
    n86 --> n11;
    n86 --> n12;
    n87 --> n8;
    n87 --> n247;
    n87 --> n184;
    n87 --> n110;
    n87 --> n88;
    n87 --> n26;
    n87 --> n52;
    n87 --> n51;
    n87 --> n101;
    n87 --> n89;
    n87 --> n94;
    n87 --> n92;
    n87 --> n114;
    n87 --> n231;
    n87 --> n63;
    n87 --> n62;
    n87 --> n30;
    n87 --> n39;
    n87 --> n24;
    n87 --> n109;
    n87 --> n85;
    n87 --> n193;
    n87 --> n97;
    n87 --> n219;
    n87 --> n145;
    n87 --> n99;
    n87 --> n29;
    n88 --> n8;
    n88 --> n247;
    n88 --> n26;
    n88 --> n52;
    n88 --> n86;
    n88 --> n24;
    n88 --> n109;
    n88 --> n85;
    n88 --> n10;
    n89 --> n8;
    n89 --> n29;
    n89 --> n247;
    n89 --> n63;
    n89 --> n62;
    n89 --> n24;
    n89 --> n17;
    n89 --> n108;
    n90 --> n8;
    n90 --> n52;
    n90 --> n29;
    n90 --> n247;
    n90 --> n202;
    n90 --> n193;
    n90 --> n24;
    n90 --> n85;
    n90 --> n109;
    n90 --> n30;
    n90 --> n10;
    n90 --> n97;
    n91 --> n8;
    n91 --> n52;
    n91 --> n62;
    n91 --> n158;
    n91 --> n247;
    n91 --> n242;
    n91 --> n97;
    n91 --> n154;
    n91 --> n156;
    n91 --> n24;
    n91 --> n109;
    n91 --> n85;
    n92 --> n8;
    n92 --> n52;
    n92 --> n247;
    n92 --> n43;
    n92 --> n226;
    n92 --> n97;
    n92 --> n24;
    n92 --> n17;
    n92 --> n109;
    n92 --> n85;
    n92 --> n62;
    n92 --> n30;
    n93 --> n8;
    n93 --> n52;
    n93 --> n247;
    n93 --> n220;
    n93 --> n193;
    n93 --> n24;
    n93 --> n85;
    n93 --> n109;
    n93 --> n96;
    n93 --> n97;
    n94 --> n8;
    n94 --> n52;
    n94 --> n97;
    n94 --> n24;
    n94 --> n109;
    n94 --> n85;
    n95 --> n8;
    n95 --> n217;
    n95 --> n62;
    n95 --> n97;
    n95 --> n24;
    n95 --> n109;
    n95 --> n85;
    n95 --> n52;
    n95 --> n202;
    n96 --> n8;
    n96 --> n52;
    n96 --> n57;
    n96 --> n26;
    n96 --> n97;
    n96 --> n12;
    n96 --> n247;
    n96 --> n46;
    n96 --> n189;
    n96 --> n202;
    n96 --> n198;
    n96 --> n197;
    n96 --> n201;
    n96 --> n24;
    n96 --> n109;
    n96 --> n85;
    n96 --> n10;
    n97 --> n8;
    n97 --> n84;
    n97 --> n29;
    n97 --> n247;
    n97 --> n149;
    n97 --> n145;
    n97 --> n99;
    n97 --> n95;
    n97 --> n91;
    n97 --> n98;
    n97 --> n24;
    n97 --> n193;
    n97 --> n30;
    n97 --> n12;
    n97 --> n90;
    n97 --> n93;
    n97 --> n100;
    n98 --> n8;
    n98 --> n52;
    n98 --> n62;
    n98 --> n30;
    n98 --> n97;
    n98 --> n91;
    n98 --> n242;
    n98 --> n228;
    n98 --> n137;
    n98 --> n247;
    n98 --> n227;
    n98 --> n229;
    n98 --> n113;
    n98 --> n24;
    n98 --> n109;
    n98 --> n85;
    n99 --> n8;
    n99 --> n52;
    n99 --> n247;
    n99 --> n219;
    n99 --> n145;
    n99 --> n24;
    n99 --> n109;
    n99 --> n85;
    n100 --> n8;
    n100 --> n247;
    n100 --> n193;
    n100 --> n93;
    n100 --> n149;
    n100 --> n24;
    n100 --> n63;
    n100 --> n187;
    n100 --> n90;
    n100 --> n97;
    n101 --> n8;
    n101 --> n151;
    n101 --> n26;
    n101 --> n52;
    n101 --> n62;
    n101 --> n30;
    n101 --> n24;
    n101 --> n109;
    n101 --> n85;
    n102 --> n105;
    n102 --> n103;
    n102 --> n106;
    n102 --> n63;
    n102 --> n34;
    n102 --> n62;
    n102 --> n39;
    n102 --> n24;
    n102 --> n17;
    n102 --> n45;
    n102 --> n12;
    n102 --> n11;
    n102 --> n107;
    n102 --> n104;
    n104 --> n44;
    n104 --> n24;
    n104 --> n17;
    n104 --> n45;
    n104 --> n83;
    n104 --> n42;
    n104 --> n62;
    n104 --> n39;
    n104 --> n63;
    n104 --> n106;
    n106 --> n105;
    n106 --> n103;
    n106 --> n62;
    n106 --> n63;
    n108 --> n8;
    n108 --> n10;
    n108 --> n24;
    n108 --> n30;
    n109 --> n85;
    n109 --> n52;
    n109 --> n24;
    n109 --> n202;
    n109 --> n26;
    n109 --> n43;
    n110 --> n8;
    n110 --> n24;
    n110 --> n52;
    n110 --> n184;
    n110 --> n247;
    n110 --> n160;
    n110 --> n238;
    n110 --> n248;
    n110 --> n88;
    n110 --> n86;
    n110 --> n29;
    n111 --> n8;
    n111 --> n24;
    n111 --> n70;
    n111 --> n110;
    n111 --> n112;
    n112 --> n86;
    n113 --> n8;
    n113 --> n84;
    n113 --> n247;
    n113 --> n63;
    n113 --> n62;
    n113 --> n12;
    n113 --> n24;
    n113 --> n17;
    n113 --> n116;
    n113 --> n118;
    n113 --> n119;
    n113 --> n114;
    n113 --> n69;
    n113 --> n76;
    n113 --> n111;
    n113 --> n43;
    n113 --> n72;
    n113 --> n112;
    n113 --> n176;
    n113 --> n249;
    n113 --> n248;
    n113 --> n52;
    n113 --> n49;
    n114 --> n8;
    n114 --> n161;
    n114 --> n247;
    n114 --> n24;
    n114 --> n109;
    n114 --> n85;
    n114 --> n112;
    n114 --> n52;
    n115 --> n8;
    n115 --> n52;
    n115 --> n112;
    n115 --> n110;
    n115 --> n24;
    n116 --> n8;
    n116 --> n247;
    n116 --> n62;
    n116 --> n52;
    n116 --> n244;
    n116 --> n63;
    n116 --> n108;
    n116 --> n112;
    n116 --> n117;
    n116 --> n24;
    n116 --> n17;
    n116 --> n109;
    n116 --> n85;
    n117 --> n8;
    n117 --> n247;
    n117 --> n10;
    n117 --> n62;
    n117 --> n30;
    n117 --> n52;
    n117 --> n63;
    n117 --> n112;
    n117 --> n24;
    n117 --> n17;
    n117 --> n109;
    n117 --> n85;
    n117 --> n108;
    n118 --> n8;
    n118 --> n26;
    n118 --> n52;
    n118 --> n184;
    n118 --> n247;
    n118 --> n112;
    n118 --> n110;
    n118 --> n115;
    n118 --> n24;
    n118 --> n109;
    n118 --> n62;
    n118 --> n85;
    n119 --> n8;
    n119 --> n10;
    n119 --> n52;
    n119 --> n247;
    n119 --> n110;
    n119 --> n232;
    n119 --> n161;
    n119 --> n112;
    n119 --> n24;
    n119 --> n109;
    n119 --> n85;
    n120 --> n63;
    n120 --> n8;
    n120 --> n52;
    n120 --> n24;
    n120 --> n34;
    n120 --> n109;
    n120 --> n85;
    n120 --> n128;
    n120 --> n39;
    n121 --> n63;
    n121 --> n8;
    n121 --> n10;
    n121 --> n80;
    n121 --> n24;
    n121 --> n18;
    n121 --> n39;
    n121 --> n130;
    n121 --> n125;
    n121 --> n86;
    n122 --> n63;
    n122 --> n8;
    n122 --> n52;
    n122 --> n62;
    n122 --> n86;
    n122 --> n24;
    n122 --> n128;
    n122 --> n109;
    n122 --> n85;
    n122 --> n18;
    n122 --> n43;
    n122 --> n34;
    n123 --> n24;
    n123 --> n8;
    n123 --> n52;
    n123 --> n158;
    n123 --> n42;
    n123 --> n10;
    n123 --> n12;
    n123 --> n30;
    n123 --> n11;
    n123 --> n128;
    n123 --> n109;
    n123 --> n85;
    n124 --> n63;
    n124 --> n24;
    n124 --> n8;
    n124 --> n52;
    n124 --> n62;
    n124 --> n86;
    n124 --> n240;
    n124 --> n247;
    n124 --> n37;
    n124 --> n242;
    n124 --> n238;
    n124 --> n128;
    n124 --> n109;
    n124 --> n85;
    n125 --> n8;
    n125 --> n24;
    n125 --> n18;
    n126 --> n8;
    n126 --> n24;
    n126 --> n17;
    n126 --> n52;
    n126 --> n86;
    n126 --> n63;
    n126 --> n149;
    n126 --> n1;
    n126 --> n219;
    n126 --> n128;
    n126 --> n109;
    n126 --> n85;
    n127 --> n63;
    n127 --> n8;
    n127 --> n52;
    n127 --> n10;
    n127 --> n86;
    n127 --> n80;
    n127 --> n24;
    n127 --> n62;
    n127 --> n30;
    n127 --> n130;
    n127 --> n121;
    n127 --> n34;
    n127 --> n109;
    n127 --> n85;
    n127 --> n128;
    n128 --> n63;
    n128 --> n8;
    n128 --> n62;
    n128 --> n7;
    n128 --> n24;
    n128 --> n43;
    n129 --> n63;
    n129 --> n8;
    n129 --> n52;
    n129 --> n10;
    n129 --> n12;
    n129 --> n26;
    n129 --> n62;
    n129 --> n39;
    n129 --> n24;
    n129 --> n17;
    n129 --> n161;
    n129 --> n240;
    n129 --> n247;
    n129 --> n37;
    n129 --> n158;
    n129 --> n149;
    n129 --> n130;
    n129 --> n121;
    n129 --> n128;
    n129 --> n86;
    n129 --> n109;
    n129 --> n85;
    n131 --> n84;
    n131 --> n24;
    n131 --> n8;
    n131 --> n130;
    n131 --> n122;
    n131 --> n124;
    n131 --> n123;
    n131 --> n127;
    n131 --> n126;
    n131 --> n129;
    n131 --> n120;
    n131 --> n121;
    n134 --> n144;
    n134 --> n135;
    n137 --> n147;
    n138 --> n147;
    n138 --> n144;
    n138 --> n140;
    n139 --> n147;
    n139 --> n144;
    n139 --> n140;
    n140 --> n147;
    n140 --> n144;
    n141 --> n147;
    n141 --> n30;
    n142 --> n147;
    n142 --> n144;
    n142 --> n140;
    n142 --> n141;
    n143 --> n147;
    n143 --> n144;
    n144 --> n147;
    n145 --> n144;
    n148 --> n147;
    n148 --> n30;
    n149 --> n63;
    n149 --> n8;
    n149 --> n132;
    n149 --> n43;
    n150 --> n8;
    n150 --> n63;
    n150 --> n62;
    n150 --> n30;
    n150 --> n39;
    n151 --> n63;
    n151 --> n8;
    n151 --> n181;
    n151 --> n150;
    n151 --> n46;
    n151 --> n24;
    n153 --> n65;
    n155 --> n247;
    n155 --> n166;
    n155 --> n169;
    n155 --> n154;
    n155 --> n217;
    n158 --> n161;
    n158 --> n247;
    n158 --> n159;
    n158 --> n157;
    n160 --> n8;
    n160 --> n24;
    n160 --> n30;
    n161 --> n224;
    n161 --> n167;
    n161 --> n176;
    n161 --> n164;
    n161 --> n238;
    n161 --> n242;
    n161 --> n241;
    n161 --> n247;
    n161 --> n239;
    n161 --> n240;
    n162 --> n163;
    n162 --> n176;
    n162 --> n164;
    n165 --> n171;
    n165 --> n178;
    n165 --> n169;
    n165 --> n172;
    n165 --> n163;
    n165 --> n176;
    n165 --> n174;
    n165 --> n173;
    n166 --> n172;
    n166 --> n163;
    n166 --> n164;
    n166 --> n174;
    n166 --> n177;
    n166 --> n170;
    n166 --> n165;
    n166 --> n168;
    n168 --> n164;
    n168 --> n176;
    n168 --> n163;
    n168 --> n172;
    n168 --> n175;
    n169 --> n163;
    n169 --> n164;
    n169 --> n242;
    n170 --> n163;
    n170 --> n176;
    n170 --> n238;
    n171 --> n172;
    n171 --> n165;
    n172 --> n173;
    n174 --> n163;
    n174 --> n178;
    n174 --> n169;
    n174 --> n172;
    n174 --> n164;
    n176 --> n166;
    n176 --> n161;
    n177 --> n163;
    n177 --> n161;
    n178 --> n173;
    n179 --> n167;
    n180 --> n247;
    n180 --> n176;
    n180 --> n181;
    n180 --> n185;
    n180 --> n250;
    n180 --> n186;
    n180 --> n248;
    n181 --> n30;
    n181 --> n46;
    n182 --> n185;
    n182 --> n186;
    n182 --> n193;
    n182 --> n153;
    n182 --> n181;
    n182 --> n238;
    n182 --> n166;
    n182 --> n250;
    n183 --> n181;
    n184 --> n30;
    n184 --> n176;
    n184 --> n158;
    n184 --> n218;
    n184 --> n247;
    n184 --> n202;
    n184 --> n183;
    n184 --> n248;
    n185 --> n186;
    n188 --> n189;
    n189 --> n206;
    n190 --> n30;
    n190 --> n206;
    n191 --> n190;
    n192 --> n217;
    n192 --> n216;
    n194 --> n189;
    n194 --> n205;
    n194 --> n197;
    n195 --> n189;
    n195 --> n205;
    n195 --> n197;
    n196 --> n189;
    n196 --> n202;
    n196 --> n205;
    n196 --> n197;
    n197 --> n202;
    n197 --> n198;
    n197 --> n205;
    n200 --> n189;
    n200 --> n205;
    n200 --> n197;
    n201 --> n202;
    n202 --> n205;
    n202 --> n188;
    n202 --> n194;
    n202 --> n196;
    n202 --> n204;
    n202 --> n195;
    n202 --> n203;
    n202 --> n200;
    n202 --> n193;
    n203 --> n189;
    n203 --> n202;
    n203 --> n205;
    n203 --> n199;
    n203 --> n197;
    n204 --> n189;
    n204 --> n202;
    n204 --> n205;
    n204 --> n199;
    n204 --> n197;
    n207 --> n144;
    n207 --> n216;
    n208 --> n144;
    n208 --> n216;
    n209 --> n144;
    n209 --> n216;
    n210 --> n144;
    n210 --> n216;
    n211 --> n216;
    n211 --> n209;
    n211 --> n213;
    n212 --> n216;
    n212 --> n213;
    n213 --> n154;
    n213 --> n216;
    n213 --> n212;
    n213 --> n211;
    n214 --> n219;
    n214 --> n216;
    n215 --> n209;
    n215 --> n208;
    n215 --> n210;
    n215 --> n207;
    n215 --> n214;
    n215 --> n213;
    n215 --> n216;
    n215 --> n166;
    n217 --> n206;
    n217 --> n247;
    n217 --> n166;
    n217 --> n216;
    n217 --> n213;
    n217 --> n207;
    n217 --> n144;
    n217 --> n188;
    n217 --> n202;
    n217 --> n215;
    n218 --> n158;
    n218 --> n183;
    n219 --> n247;
    n219 --> n217;
    n219 --> n193;
    n219 --> n220;
    n221 --> n193;
    n221 --> n158;
    n222 --> n217;
    n222 --> n223;
    n222 --> n206;
    n222 --> n183;
    n226 --> n225;
    n226 --> n152;
    n226 --> n34;
    n226 --> n30;
    n227 --> n158;
    n227 --> n247;
    n227 --> n8;
    n231 --> n235;
    n231 --> n152;
    n231 --> n250;
    n231 --> n248;
    n231 --> n230;
    n232 --> n238;
    n233 --> n235;
    n233 --> n234;
    n234 --> n230;
    n234 --> n235;
    n234 --> n238;
    n234 --> n233;
    n234 --> n248;
    n234 --> n250;
    n235 --> n230;
    n235 --> n238;
    n236 --> n235;
    n237 --> n235;
    n237 --> n234;
    n237 --> n232;
    n237 --> n231;
    n238 --> n243;
    n238 --> n240;
    n238 --> n235;
    n238 --> n234;
    n238 --> n233;
    n238 --> n236;
    n238 --> n237;
    n238 --> n231;
    n240 --> n238;
    n240 --> n242;
    n240 --> n239;
    n240 --> n241;
    n242 --> n240;
    n242 --> n238;
    n244 --> n8;
    n244 --> n24;
    n244 --> n62;
    n244 --> n246;
    n244 --> n63;
    n245 --> n145;
    n245 --> n217;
    n246 --> n63;
    n246 --> n24;
    n246 --> n17;
    n246 --> n8;
    n246 --> n45;
    n246 --> n62;
    n246 --> n30;
    n246 --> n193;
    n246 --> n158;
    n246 --> n221;
    n246 --> n245;
    n246 --> n149;
    n246 --> n151;
    n246 --> n247;
    n246 --> n181;
    n246 --> n180;
    n246 --> n161;
    n246 --> n224;
    n246 --> n219;
    n246 --> n192;
    n246 --> n145;
    n246 --> n136;
    n246 --> n46;
    n246 --> n217;
    n246 --> n187;
    n246 --> n231;
    n247 --> n153;
    n247 --> n224;
    n247 --> n62;
    n247 --> n30;
    n247 --> n176;
    n247 --> n158;
    n247 --> n8;
    n247 --> n149;
    n247 --> n38;
    n247 --> n181;
    n247 --> n218;
    n247 --> n238;
    n247 --> n231;
    n247 --> n242;
    n247 --> n240;
    n247 --> n169;
    n247 --> n182;
    n247 --> n249;
    n247 --> n250;
    n247 --> n248;
    n247 --> n183;
    n247 --> n219;
    n247 --> n246;
    n247 --> n184;
    n247 --> n155;
    n248 --> n243;
    n248 --> n29;
    n250 --> n248;
    n251 --> n4;
    n252 --> n17;
    n252 --> n5;
    n252 --> n251;
```