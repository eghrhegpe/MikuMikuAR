# 坏味道扫描原始结果

- 扫描文件数: 88  | 总行数: 32642

## 全局计数

- @ts-ignore: **1**
- @ts-expect-error: **0**
- any(显式): **33**
- console.*: **175**
- debugger: **0**
- TODO/FIXME/HACK: **0**

## 按文件坏味道密度（Top 20，按总行数加权）

| 坏味道数 | 文件 | 行数 | @ts-ignore | @ts-exp | any | console | debugger | TODO |
|---|---|---|---|---|---|---|---|---|
| 37 | scene\motion\proc-motion-bridge.ts | 698 | 0 | 0 | 21 | 16 | 0 | 0 |
| 16 | scene\scene-serialize.ts | 771 | 0 | 0 | 2 | 14 | 0 | 0 |
| 15 | menus\settings.ts | 1366 | 0 | 0 | 0 | 15 | 0 | 0 |
| 13 | menus\library-core.ts | 969 | 0 | 0 | 0 | 13 | 0 | 0 |
| 12 | core\main.ts | 871 | 1 | 0 | 0 | 11 | 0 | 0 |
| 7 | scene\manager\model-loader.ts | 373 | 0 | 0 | 1 | 6 | 0 | 0 |
| 7 | scene\env\props.ts | 294 | 0 | 0 | 0 | 7 | 0 | 0 |
| 7 | outfit\outfit-overlay.ts | 256 | 0 | 0 | 0 | 7 | 0 | 0 |
| 6 | scene\motion\vmd-loader.ts | 259 | 0 | 0 | 2 | 4 | 0 | 0 |
| 6 | scene\manager\model-manager.ts | 975 | 0 | 0 | 0 | 6 | 0 | 0 |
| 6 | scene\env\env.ts | 178 | 0 | 0 | 0 | 6 | 0 | 0 |
| 6 | scene\env\env-bridge.ts | 432 | 0 | 0 | 0 | 6 | 0 | 0 |
| 5 | scene\render\renderer.ts | 791 | 0 | 0 | 0 | 5 | 0 | 0 |
| 5 | scene\env\env-water.ts | 919 | 0 | 0 | 5 | 0 | 0 | 0 |
| 5 | core\utils.ts | 544 | 0 | 0 | 0 | 5 | 0 | 0 |
| 4 | scene\motion\vmd-layers.ts | 492 | 0 | 0 | 0 | 4 | 0 | 0 |
| 4 | scene\manager\material.ts | 526 | 0 | 0 | 0 | 4 | 0 | 0 |
| 4 | scene\env\env-impl.ts | 655 | 0 | 0 | 1 | 3 | 0 | 0 |
| 4 | outfit\audio.ts | 250 | 0 | 0 | 0 | 4 | 0 | 0 |
| 4 | motion-algos\procedural-motion.ts | 1007 | 0 | 0 | 0 | 4 | 0 | 0 |

## 疑似重复代码块（跨文件或高频，Top 25）

| 出现次数 | 涉及文件数 | 示例首行 | 位置样本 |
|---|---|---|---|
| 20 | 11 | `});` | menus\env-feature-levels.ts:96, menus\env-feature-levels.ts:286, menus\env-feature-levels.ts:407, menus\env-menu.ts:88, menus\env-menu.ts:152, menus\model-detail.ts:81 |
| 13 | 7 | `}` | menus\env-feature-levels.ts:207, menus\env-feature-levels.ts:355, menus\model-detail.ts:208, menus\model-detail.ts:253, menus\model-detail.ts:585, menus\model-material.ts:82 |
| 7 | 5 | `},` | menus\env-feature-levels.ts:95, menus\env-feature-levels.ts:285, menus\env-feature-levels.ts:406, menus\env-menu.ts:151, menus\motion-cloth-levels.ts:163, menus\scene-render-levels.ts:270 |
| 6 | 2 | `dir: '',` | menus\env-feature-levels.ts:22, menus\env-feature-levels.ts:104, menus\env-feature-levels.ts:215, menus\env-feature-levels.ts:313, menus\env-feature-levels.ts:363, menus\env-menu.ts:202 |
| 5 | 3 | `});` | menus\model-detail.ts:207, menus\model-material.ts:81, menus\model-material.ts:137, menus\motion-popup.ts:169, menus\motion-popup.ts:336 |
| 5 | 3 | `}` | scene\env\env-impl.ts:485, scene\render\renderer.ts:402, scene\render\renderer.ts:403, scene\render\renderer.ts:404, scene\scene-bundle.ts:97 |
| 5 | 1 | `for (let mi = 0; mi < inst.meshes.length; mi++) {` | outfit\outfit.ts:330, outfit\outfit.ts:363, outfit\outfit.ts:394, outfit\outfit.ts:470, outfit\outfit.ts:487 |
| 4 | 2 | `}` | menus\settings-software.ts:192, menus\settings-software.ts:234, menus\settings.ts:266, menus\settings.ts:699 |
| 4 | 2 | `id,` | scene\env\props.ts:62, scene\manager\model-loader.ts:135, scene\manager\model-loader.ts:186, scene\manager\model-loader.ts:237 |
| 4 | 2 | `dir: '',` | menus\env-preset-levels.ts:199, menus\model-detail.ts:266, menus\model-detail.ts:410, menus\model-detail.ts:511 |
| 3 | 3 | `});` | menus\motion-popup.ts:462, menus\scene-stage-lights.ts:360, menus\settings.ts:837 |
| 3 | 3 | `});` | menus\model-material.ts:368, menus\model-preset.ts:444, menus\scene-render-levels.ts:128 |
| 3 | 3 | `c.appendChild(row);` | menus\model-material.ts:369, menus\model-preset.ts:445, menus\scene-render-levels.ts:129 |
| 3 | 2 | `});` | menus\env-feature-levels.ts:94, menus\env-feature-levels.ts:284, menus\scene-render-levels.ts:269 |
| 3 | 2 | `} else {` | core\ui-advanced-rows.ts:197, core\ui-rows.ts:23, core\ui-rows.ts:115 |
| 3 | 2 | `if (iconEl) {` | core\ui-advanced-rows.ts:195, core\ui-rows.ts:21, core\ui-rows.ts:113 |
| 3 | 2 | `if (icon) {` | core\ui-advanced-rows.ts:191, core\ui-rows.ts:17, core\ui-rows.ts:109 |
| 3 | 2 | `iconBox.className = 'cs-icon';` | core\ui-advanced-rows.ts:193, core\ui-rows.ts:19, core\ui-rows.ts:111 |
| 3 | 2 | `iconBox.appendChild(iconEl);` | core\ui-advanced-rows.ts:196, core\ui-rows.ts:22, core\ui-rows.ts:114 |
| 3 | 2 | `const iconEl = createIconifyIcon(icon);` | core\ui-advanced-rows.ts:194, core\ui-rows.ts:20, core\ui-rows.ts:112 |
| 3 | 2 | `const iconBox = document.createElement('span');` | core\ui-advanced-rows.ts:192, core\ui-rows.ts:18, core\ui-rows.ts:110 |
| 3 | 2 | `const fb = document.createElement('span');` | core\ui-advanced-rows.ts:198, core\ui-rows.ts:24, core\ui-rows.ts:116 |
| 3 | 2 | `break;` | core\ui-advanced-rows.ts:82, core\ui-advanced-rows.ts:253, core\ui-rows.ts:190 |
| 3 | 2 | `);` | menus\motion-procmotion-levels.ts:305, menus\motion-procmotion-levels.ts:379, menus\settings-software.ts:114 |
| 2 | 2 | `};` | menus\env-feature-levels.ts:178, menus\env-menu.ts:249 |