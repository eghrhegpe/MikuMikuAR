// menu-schema.modelid.test.ts — modelId override（ADR-166 §6.13，拆自 menu-schema.test.ts）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { getStateValue, setStateValue } from '../menus/menu-schema';
import { getPerceptionStateFor, setPerceptionStateFor } from '../scene/motion/perception';

describe('ADR-093 Menu Schema — modelId override', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('perception. uses getPerceptionStateFor with node modelId', () => {
        (getPerceptionStateFor as ReturnType<typeof vi.fn>).mockReturnValue({
            eyeTrackingEnabled: true,
        });
        const val = getStateValue('perception.eyeTrackingEnabled', 'other-model');
        expect(getPerceptionStateFor).toHaveBeenCalledWith('other-model');
        expect(val).toBe(true);
    });

    it('perception. set uses setPerceptionStateFor with node modelId', () => {
        setStateValue('perception.eyeTrackingEnabled', false, 'other-model');
        expect(setPerceptionStateFor).toHaveBeenCalledWith('other-model', {
            eyeTrackingEnabled: false,
        });
    });
});
