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
// env 域
registerSchema('env:sky', getSkySchema);
registerSchema('env:wind', getWindSchema);
registerSchema('env:fog', getFogSchema);
registerSchema('env:cloud', getCloudSchema);
registerSchema('env:shadow', getShadowSchema);
registerSchema('env:water', getWaterSchema);
registerSchema('env:ground', getGroundSchema);
registerSchema('env:experimental', getExperimentalSchema);
registerSchema('env:particle', buildParticleSchema);
// scene 域
registerSchema('scene:postprocess-core', buildPostProcessCoreSchema);
registerSchema('scene:postprocess-color', buildPostProcessColorSchema);
// motion 域
registerSchema('motion:gaze', getGazeSchema);
// settings 域
registerSchema('settings:camera', buildCameraSchema);
registerSchema('settings:frame-quality', buildFrameQualitySchema);
registerSchema('settings:effects', buildEffectsSchema);
registerSchema('settings:physics-hud', buildPhysicsHudSchema);
