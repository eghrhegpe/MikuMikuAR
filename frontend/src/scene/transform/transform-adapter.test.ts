import { describe, it, expect } from 'vitest';
import {
    registerTransformAdapter,
    getTransformAdapter,
    type TransformAdapter,
} from './transform-adapter';

function makeAdapter(kinds: string[], scale = 1, opacity = 1): TransformAdapter {
    return {
        kinds: kinds as TransformAdapter['kinds'],
        getNode: () => null,
        gizmoTypes: () => ['position'],
        onPositionDragEnd: () => {},
        capabilities: ['slider-scale', 'slider-opacity'],
        getScale: () => scale,
        setScale: () => {},
        getOpacity: () => opacity,
        setOpacity: () => {},
    };
}

describe('transform-adapter registry (ADR-126)', () => {
    it('returns null for unregistered kind', () => {
        expect(getTransformAdapter('actor')).toBeNull();
    });

    it('resolves all declared kinds to the same adapter (actor+stage shared)', () => {
        const a = makeAdapter(['actor', 'stage'], 2, 0.5);
        registerTransformAdapter(a);
        expect(getTransformAdapter('actor')).toBe(a);
        expect(getTransformAdapter('stage')).toBe(a);
    });

    it('funnels getScale/getOpacity through the registered adapter', () => {
        const a = makeAdapter(['prop'], 3, 0);
        registerTransformAdapter(a);
        const got = getTransformAdapter('prop');
        expect(got?.getScale?.('p1')).toBe(3);
        expect(got?.getOpacity?.('p1')).toBe(0);
        expect(got?.capabilities).toContain('slider-scale');
        expect(got?.capabilities).toContain('slider-opacity');
    });

    it('re-registration replaces the adapter for a kind', () => {
        const first = makeAdapter(['light'], 1, 1);
        const second = makeAdapter(['light'], 4, 1);
        registerTransformAdapter(first);
        registerTransformAdapter(second);
        expect(getTransformAdapter('light')).toBe(second);
    });
});
