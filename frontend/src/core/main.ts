// MikuMikuAR — entry point
// Bootstrap orchestration lives in ./init (ADR-102): wires dev-hooks,
// render-loop, events, and scene init together via bootstrap().
import '../app.css';
import 'iconify-icon';
import { bootstrap } from './init';
import { registerServiceWorker } from './sw-register';
import { isWebEntryMode } from './platform';

bootstrap();

// Web 生产构建注册 Service Worker（二次启动秒开）。
// 桌面 Wails 入口 __MMKU_WEB__ 未声明，dev 模式 import.meta.env.PROD 为 false，均不注册。
registerServiceWorker(import.meta.env.PROD && isWebEntryMode());
