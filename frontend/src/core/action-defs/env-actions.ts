// env-actions.ts — [doc:adr-238] 环境动作定义（定义留 core，execute 经 scene-action-bridge 调场景实现）。
import { registerAction } from '../action-registry';
import { getSceneAction } from '../scene-action-bridge';

function _setEnv(partial: Record<string, unknown>): void {
    getSceneAction('setEnvState')?.(partial);
}

/**
 * [doc:adr-238] 同构样板：注册一个「绑定纹理文件」的 uiOnly 动作。
 * 三个 bind-texture 分支共享此 helper，仅绑定键不同。
 */
function registerBindAction(id: string, label: string, key: string): void {
    registerAction({
        id,
        label,
        domain: 'env',
        params: [{ name: 'filePath', type: 'string' }],
        destructive: false,
        uiOnly: true,
        execute: (p) => {
            _setEnv({ [key]: p.filePath as string });
        },
    });
}

export function registerEnvActions(): void {
    registerBindAction(
        'env:bind-particle-texture',
        'ai.actions.env.bindParticleTexture',
        'particleCustomTexture'
    );
    registerBindAction('env:bind-sky-texture', 'ai.actions.env.bindSkyTexture', 'skyTexture');
    registerBindAction('env:bind-stars-texture', 'ai.actions.env.bindStarsTexture', 'starsTexture');
}
