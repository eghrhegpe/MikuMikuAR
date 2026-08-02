// [doc:architecture] Menu Schema 集中注册 — ADR-093 元测试基础设施
// 各 *-levels.ts 只导出 getXxxSchema()，不依赖 registry；
// 此文件集中调用 registerSchema，供测试 import 触发。
// 新增面板时：在对应 *-levels.ts 导出 getXxxSchema()，然后在此处加一行。

import { registerSchema } from './menu-registry';
// —— env 域 ——
import { getSkySchema } from './env-sky-levels';
import { getWindSchema } from './env-wind-levels';
import { getFogSchema } from './env-fog-levels';
import { getCloudSchema } from './env-cloud-levels';
import { getShadowSchema } from './env-shadow-levels';
import { getWaterSchema } from './env-water-levels';
import { getGroundSchema } from './env-ground-levels';
import { getExperimentalSchema } from './env-experimental-levels';
import { buildParticleSchema } from './env-menu';
// —— scene 域 ——
import { buildPostProcessCoreSchema, buildPostProcessColorSchema } from './scene-render-levels';
// —— motion 域 ——
import { getGazeSchema } from './motion-gaze-levels';
// —— settings 域 ——
import { buildCameraSchema } from './settings-controls';
import {
    buildFrameQualitySchema,
    buildEffectsSchema,
    buildPhysicsHudSchema,
} from './settings-graphics';

// 一次性注册所有已导出的 schema
// env 域 —— 常规面板零 nav 声明（快照生成器默认推导：folder:env:<slug>）
registerSchema('env:sky', getSkySchema);
registerSchema('env:wind', getWindSchema);
registerSchema('env:fog', getFogSchema);
registerSchema('env:cloud', getCloudSchema);
registerSchema('env:shadow', getShadowSchema);
// 特例 [ADR-229 §2.1]：地面/水面已迁至场景菜单（scene-menu.ts target 'scene:ground'/'scene:water'），
// panelId 前缀 env 不可信，需显式覆写 domain + 一级 folder testid
registerSchema('env:water', getWaterSchema, {
    domain: 'scene',
    subLevelTestId: 'folder:scene:water',
    subLevelLabel: '水',
});
registerSchema('env:ground', getGroundSchema, {
    domain: 'scene',
    subLevelTestId: 'folder:scene:ground',
    subLevelLabel: '地面',
});
registerSchema('env:experimental', getExperimentalSchema);
registerSchema('env:particle', buildParticleSchema);
// scene 域 —— 特例：postprocess 实际挂 env 域的"后处理"folder 下
registerSchema('scene:postprocess-core', buildPostProcessCoreSchema, {
    domain: 'env',
    subLevelTestId: 'folder:env:postprocess',
});
registerSchema('scene:postprocess-color', buildPostProcessColorSchema, {
    domain: 'env',
    subLevelTestId: 'folder:env:postprocess',
});
// motion 域 —— 常规面板零 nav 声明（默认推导：folder:motion:<slug>）
registerSchema('motion:gaze', getGazeSchema);
// settings 域 —— 特例：需二级 folder testid（节点 id 前缀与导航 folder 无映射，不可推导）
registerSchema('settings:camera', buildCameraSchema, {
    domain: 'settings',
    subLevel2TestId: 'folder:settings:controls',
});
registerSchema('settings:frame-quality', buildFrameQualitySchema, {
    domain: 'settings',
    subLevel2TestId: 'folder:settings:graphics',
});
registerSchema('settings:effects', buildEffectsSchema, {
    domain: 'settings',
    subLevel2TestId: 'folder:settings:graphics',
});
registerSchema('settings:physics-hud', buildPhysicsHudSchema, {
    domain: 'settings',
    subLevel2TestId: 'folder:settings:graphics',
});
