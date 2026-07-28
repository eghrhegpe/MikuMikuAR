import { registerAction } from '../action-registry';
import { setEnvState } from '../../scene/scene';

export function registerEnvActions(): void {
  registerAction({
    id: 'env:bind-particle-texture',
    label: '绑定粒子纹理',
    domain: 'env',
    params: [{ name: 'filePath', type: 'entity', resolve: async (path) => path }],
    destructive: false,
    execute: (p) => { setEnvState({ particleCustomTexture: p.filePath as string }); },
  });
  registerAction({
    id: 'env:bind-sky-texture',
    label: '绑定天空纹理',
    domain: 'env',
    params: [{ name: 'filePath', type: 'entity', resolve: async (path) => path }],
    destructive: false,
    execute: (p) => { setEnvState({ skyTexture: p.filePath as string }); },
  });
  registerAction({
    id: 'env:bind-stars-texture',
    label: '绑定星空纹理',
    domain: 'env',
    params: [{ name: 'filePath', type: 'entity', resolve: async (path) => path }],
    destructive: false,
    execute: (p) => { setEnvState({ starsTexture: p.filePath as string }); },
  });
}
