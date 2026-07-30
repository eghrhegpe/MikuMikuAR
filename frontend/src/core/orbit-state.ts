// orbit camera keyboard input state — leaf module（仿 freefly-state）。
//
// `orbitInput` 由两侧共享，避免 camera↔events 循环依赖：
//   - camera-behaviors.ts : orbit render observer 每帧连续积分（读）
//   - events.ts           : WSAD keydown/keyup 置标记（写）
// 零 import，两侧同源引入，打断循环。
//
// 语义（自由飞行式平移）：WSAD 平移相机注视点（target），相机整体随之位移；
// 视线朝向的水平投影为前后方向，右轴为左右方向，Q/E 升降。缩放走鼠标滚轮原生。
export const orbitInput = {
    /** W：沿视线水平投影前进 */
    forward: false,
    /** S：沿视线水平投影后退 */
    backward: false,
    /** A：沿相机右轴左移 */
    left: false,
    /** D：沿相机右轴右移 */
    right: false,
    /** Q：注视点上升 */
    up: false,
    /** E：注视点下降 */
    down: false,
};
