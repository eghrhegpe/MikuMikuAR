// MikuMikuAR — entry point
// Bootstrap orchestration lives in ./init (ADR-102): wires dev-hooks,
// render-loop, events, and scene init together via bootstrap().
import '../app.css';
import 'iconify-icon';
import { bootstrap } from './init';

bootstrap();
