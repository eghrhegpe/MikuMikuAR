// env-actions.ts — [doc:adr-238] 环境动作定义（定义留 core，execute 经 scene-action-bridge 调场景实现）。
import { registerAction } from '../action-registry';
import { getSceneAction } from '../scene-action-bridge';

function _setEnv(partial: Record<string, unknown>): void {
    getSceneAction('setEnvState')?.(partial);
}

export function registerEnvActions(): void {
    registerAction({
        id: 'env:bind-particle-texture',
        label: 'ai.actions.env.bindParticleTexture',
        domain: 'env',
        params: [{ name: 'filePath', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: (p) => {
            _setEnv({ particleCustomTexture: p.filePath as string });
        },
    });
    registerAction({
        id: 'env:bind-sky-texture',
        label: 'ai.actions.env.bindSkyTexture',
        domain: 'env',
        params: [{ name: 'filePath', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: (p) => {
            _setEnv({ skyTexture: p.filePath as string });
        },
    });
    registerAction({
        id: 'env:bind-stars-texture',
        label: 'ai.actions.env.bindStarsTexture',
        domain: 'env',
        params: [{ name: 'filePath', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: (p) => {
            _setEnv({ starsTexture: p.filePath as string });
        },
    });
}
