// @vitest-environment node
// [audit:P3] isCameraMode 运行时校验单测 —— 桥接入口/反序列化的 mode 守卫契约
import { describe, it, expect } from 'vitest';
import { isCameraMode, CAMERA_MODES } from '@/scene/camera/camera-state';

describe('isCameraMode [audit:P3]', () => {
    it('合法 mode 全部通过', () => {
        for (const m of CAMERA_MODES) {
            expect(isCameraMode(m), `${m} 应为合法 CameraMode`).toBe(true);
        }
    });

    it('非法字符串全部拒绝', () => {
        for (const bad of ['', 'orbit2', 'FOO', 'camera', 'null', 'undefined', 'beatcut2']) {
            expect(isCameraMode(bad), `${bad} 应为非法`).toBe(false);
        }
    });

    it('CAMERA_MODES 与 CameraMode 联合类型全集一致（8 个）', () => {
        expect(CAMERA_MODES).toHaveLength(8);
        expect(CAMERA_MODES).toEqual([
            'orbit',
            'freefly',
            'surround',
            'concert',
            'oneshot',
            'vmd',
            'ar',
            'beatcut',
        ]);
    });
});
