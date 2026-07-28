// orbit camera keyboard input state — leaf module（仿 freefly-state）。
//
// `orbitInput` 由两侧共享，避免 camera↔events 循环依赖：
//   - camera-behaviors.ts : orbit render observer 每帧连续积分（读）
//   - events.ts           : WSAD keydown/keyup 置标记（写）
// 零 import，两侧同源引入，打断循环。
export const orbitInput = {
    /** A：环绕 alpha 减 */
    left: false,
    /** D：环绕 alpha 加 */
    right: false,
    /** W：仰角 beta 减 */
    up: false,
    /** S：仰角 beta 加 */
    down: false,
    /** +：拉近（radius 减） */
    zoomIn: false,
    /** -：推远（radius 加） */
    zoomOut: false,
};
