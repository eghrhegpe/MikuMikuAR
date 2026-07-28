import { registerAction } from '../action-registry';
import { setEnvState } from '../../scene/scene';

export function registerEnvActions(): void {
    registerAction({
        id: 'env:bind-particle-texture',
        label: 'ai.actions.env.bindParticleTexture',
        domain: 'env',
        params: [{ name: 'filePath', type: 'string' }],
        destructive: false,
        execute: (p) => {
            setEnvState({ particleCustomTexture: p.filePath as string });
        },
    });
    registerAction({
        id: 'env:bind-sky-texture',
        label: 'ai.actions.env.bindSkyTexture',
        domain: 'env',
        params: [{ name: 'filePath', type: 'string' }],
        destructive: false,
        execute: (p) => {
            setEnvState({ skyTexture: p.filePath as string });
        },
    });
    registerAction({
        id: 'env:bind-stars-texture',
        label: 'ai.actions.env.bindStarsTexture',
        domain: 'env',
        params: [{ name: 'filePath', type: 'string' }],
        destructive: false,
        execute: (p) => {
            setEnvState({ starsTexture: p.filePath as string });
        },
    });
}
