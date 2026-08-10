import { it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { initLighting, isLightingReady } from '../scene/render/lighting';

it('NullEngine 下 initLighting 后 isLightingReady 应为 true', async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    try {
        initLighting(scene, { generator: null }, () => undefined);
        expect(isLightingReady()).toBe(true);
    } finally {
        scene.dispose();
        engine.dispose();
    }
});
