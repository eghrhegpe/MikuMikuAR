// @vitest-environment node
// menu-schema.modelid.test.ts — modelId override（ADR-166 §6.13，拆自 menu-schema.test.ts）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { getStateValue, setStateValue } from '../menus/menu-schema';
import { getPerceptionState, setPerceptionState } from '../scene/motion/perception';

describe('ADR-093 Menu Schema — modelId override', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // 933fa46d：感知状态改场景级单例存储，menu-schema 不再按 modelId 分流，
    // 统一读写 getPerceptionState / setPerceptionState（modelId 仅对 motionModule 生效）。
    it('perception. reads scene-level getPerceptionState regardless of node modelId', () => {
        (getPerceptionState as ReturnType<typeof vi.fn>).mockReturnValue({
            eyeTrackingEnabled: true,
        });
        const val = getStateValue('perception.eyeTrackingEnabled', 'other-model');
        expect(getPerceptionState).toHaveBeenCalled();
        expect(val).toBe(true);
    });

    it('perception. set writes scene-level setPerceptionState regardless of node modelId', () => {
        setStateValue('perception.eyeTrackingEnabled', false, 'other-model');
        expect(setPerceptionState).toHaveBeenCalledWith({
            eyeTrackingEnabled: false,
        });
    });
});
