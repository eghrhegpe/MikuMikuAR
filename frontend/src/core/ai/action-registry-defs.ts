import { registerAction } from '../action-registry';
import { setLightState } from '../../scene/render/lighting';
import { setCameraMode } from '../../scene/camera/camera-state';
import { applyEnvPreset } from '../../scene/env/env-time-of-day';
import { setEnvState } from '../../scene/env/env-bridge';
import { setPerformanceMode } from '../../scene/render/performance';
import { loadLibraryModel, loadLibraryMotion } from '../../menus/library-actions';
import { envState } from '../state';

export function registerControlActions(): void {
    // light:dirIntensity
    registerAction({
        id: 'ai:control:setLightIntensity',
        label: '设置灯光强度',
        domain: 'scene',
        params: [{ name: 'dirIntensity', type: 'range', min: 0, max: 1, step: 0.05 }],
        execute: (p) => setLightState({ dirIntensity: p.dirIntensity as number }),
    });

    // light:color
    registerAction({
        id: 'ai:control:setLightColor',
        label: '设置灯光颜色',
        domain: 'scene',
        params: [{ name: 'dirColor', type: 'color' }],
        execute: (p) => setLightState({ dirColor: p.dirColor as [number, number, number] }),
    });

    // camera:mode
    registerAction({
        id: 'ai:control:setCameraMode',
        label: '切换相机模式',
        domain: 'scene',
        params: [
            {
                name: 'mode',
                type: 'enum',
                enum: ['orbit', 'freefly', 'surround'],
                synonyms: { follow: 'freefly' },
            },
        ],
        execute: (p) => setCameraMode(p.mode as 'orbit' | 'freefly' | 'surround'),
    });

    // env:preset
    registerAction({
        id: 'ai:control:setEnvPreset',
        label: '切换环境预设',
        domain: 'env',
        params: [
            {
                name: 'preset',
                type: 'enum',
                enum: ['dawn', 'noon', 'sunset', 'night', 'overcast', 'neon'],
            },
        ],
        execute: (p) => {
            applyEnvPreset(p.preset as string);
        },
    });

    // env:toggleGround
    registerAction({
        id: 'ai:control:toggleGround',
        label: '切换地面可见性',
        domain: 'env',
        params: [],
        execute: () => setEnvState({ groundVisible: !envState.groundVisible }),
    });

    // model:load
    registerAction({
        id: 'ai:control:loadModel',
        label: '加载模型',
        domain: 'library',
        params: [
            {
                name: 'name',
                type: 'entity',
                resolve: async (name: string) => (loadLibraryModel(name) ? name : null),
            },
        ],
        destructive: true,
        execute: async (p) => {
            loadLibraryModel(p.name as string);
        },
    });

    // motion:load
    registerAction({
        id: 'ai:control:loadMotion',
        label: '替换动作',
        domain: 'motion',
        params: [
            {
                name: 'name',
                type: 'entity',
                resolve: async (name: string) => (loadLibraryMotion(name) ? name : null),
            },
        ],
        destructive: true,
        execute: async (p) => {
            loadLibraryMotion(p.name as string);
        },
    });

    // render:performance
    registerAction({
        id: 'ai:control:setPerformance',
        label: '切换性能模式',
        domain: 'scene',
        params: [
            {
                name: 'mode',
                type: 'enum',
                enum: ['quality', 'balanced', 'performance'],
                synonyms: { high: 'quality', low: 'performance' },
            },
        ],
        execute: (p) => setPerformanceMode(p.mode as 'quality' | 'balanced' | 'performance'),
    });
}
