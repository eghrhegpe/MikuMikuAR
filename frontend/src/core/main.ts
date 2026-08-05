// MikuMikuAR — entry point
// Bootstrap orchestration lives in ./init (ADR-102): wires dev-hooks,
// render-loop, events, and scene init together via bootstrap().
import '../app.css';
import 'iconify-icon';
// [doc:adr-238] menus 子系统加载锚点：ADR-238 将 core→menus 调用改经桥接，
// 但桥接注册（registerSceneAction/registerUiAction）在模块顶层执行，
// 模块不被 import 则永不注册。此 side-effect import 确保加载链：
// library-setup → nav-actions（按钮接线 + ui-action-bridge 注册）
//               → library-core → library-actions（scene-action-bridge 注册）
import '../menus/library-setup';
import { bootstrap } from './init';
import { registerServiceWorker } from './sw-register';
import { isWebEntryMode } from './platform';

bootstrap();

// Web 生产构建注册 Service Worker（二次启动秒开）。
// 桌面 Wails 入口 __MMKU_WEB__ 未声明，dev 模式 import.meta.env.PROD 为 false，均不注册。
registerServiceWorker(import.meta.env.PROD && isWebEntryMode());
