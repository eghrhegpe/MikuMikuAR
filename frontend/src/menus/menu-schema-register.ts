// [doc:architecture] Menu Schema 集中注册 — ADR-093 元测试基础设施
// 各 *-levels.ts 只导出 getXxxSchema()，不依赖 registry；
// 此文件集中调用 registerSchema，供测试 import 触发。
// 新增面板时：在对应 *-levels.ts 导出 getXxxSchema()，然后在此处加一行。

import { registerSchema } from './menu-registry';
import { getSkySchema } from './env-sky-levels';
import { getWindSchema } from './env-wind-levels';
import { getFogSchema } from './env-fog-levels';
import { getCloudSchema } from './env-cloud-levels';
import { getShadowSchema } from './env-shadow-levels';
import { getWaterSchema } from './env-water-levels';
import { getGroundSchema } from './env-ground-levels';
import { getExperimentalSchema } from './env-experimental-levels';
import { buildParticleSchema } from './env-menu';

// 一次性注册所有已导出的 schema
registerSchema('env:sky', getSkySchema);
registerSchema('env:wind', getWindSchema);
registerSchema('env:fog', getFogSchema);
registerSchema('env:cloud', getCloudSchema);
registerSchema('env:shadow', getShadowSchema);
registerSchema('env:water', getWaterSchema);
registerSchema('env:ground', getGroundSchema);
registerSchema('env:experimental', getExperimentalSchema);
registerSchema('env:particle', buildParticleSchema);
