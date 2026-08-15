// @vitest-environment node
// [audit:P3] isCameraMode 运行时校验单测 —— 桥接入口/反序列化的 mode 守卫契约
import { describe, it, expect } from 'vitest';
import { isCameraMode, CAMERA_MODES } from '@/scene/camera/camera-state';
import type { CameraMode } from '@/scene/camera/camera-state';
import type { CameraMode as CoreCameraMode } from '@/core/types';

// 编译期锁定两处 CameraMode 双写契约一致：若 core/types.ts 与 camera-state.ts
// 的联合类型漂移（例如漏加 beatcut），`npm run check` 在此报错。
type Assert<T extends true> = T;
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _CameraModeDoubleWriteConsistent = Assert<SameUnion<CameraMode, CoreCameraMode>>;

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

    it('非字符串运行时输入不抛错且拒绝（桥接入口容错）', () => {
        expect(isCameraMode(undefined as unknown as string)).toBe(false);
        expect(isCameraMode(null as unknown as string)).toBe(false);
        expect(isCameraMode(42 as unknown as string)).toBe(false);
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
