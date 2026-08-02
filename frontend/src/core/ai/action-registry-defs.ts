import { registerAction } from '../action-registry';
import { setLightState } from '../../scene/render/lighting';
import { setCameraMode } from '../../scene/camera/camera-state';
import { applyEnvPreset } from '../../scene/env/env-time-of-day';
import { setEnvState } from '../../scene/env/_bridge/env-bridge';
import { setPerformanceMode } from '../../scene/render/performance';
import {
    replaceModel,
    replaceMotion,
    findLibraryModelByName,
    findLibraryMotionByName,
} from '../../menus/library-actions';
import type { LibraryModel } from '../../core/types';
import { envState } from '../state';
import { registerSettingsActions } from '../action-defs/settings-actions';
import { registerSceneActions } from '../action-defs/scene-actions';
import { registerMotionActions } from '../action-defs/motion-actions';
import { registerEnvActions } from '../action-defs/env-actions';
import { registerLibraryActions } from '../action-defs/library-actions-def';
import { registerDiagnosticActions } from '../action-defs/diagnostic-actions';

/** 注册全部 AI 动作定义（控制/诊断/设置/库/动作/环境/场景各域）。 */
export function registerAllActions(): void {
    registerControlActions();
    registerDiagnosticActions();
    registerSettingsActions();
    registerSceneActions();
    registerMotionActions();
    registerEnvActions();
    registerLibraryActions();
}

export function registerControlActions(): void {
    // light:dirIntensity
    registerAction({
        id: 'ai:control:setLightIntensity',
        label: 'ai.actions.control.setLightIntensity',
        domain: 'scene',
        params: [{ name: 'dirIntensity', type: 'range', min: 0, max: 1, step: 0.05 }],
        execute: (p) => {
            setLightState({ dirIntensity: p.dirIntensity as number });
        },
    });

    // light:color
    registerAction({
        id: 'ai:control:setLightColor',
        label: 'ai.actions.control.setLightColor',
        domain: 'scene',
        params: [{ name: 'dirColor', type: 'color' }],
        execute: (p) => {
            setLightState({ dirColor: p.dirColor as [number, number, number] });
        },
    });

    // camera:mode
    registerAction({
        id: 'ai:control:setCameraMode',
        label: 'ai.actions.control.setCameraMode',
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
        label: 'ai.actions.control.setEnvPreset',
        domain: 'env',
        params: [
            {
                name: 'preset',
                type: 'enum',
                enum: ['dawn', 'noon', 'sunset', 'night', 'overcast', 'neon'],
            },
        ],
        execute: (p) => {
            const ok = applyEnvPreset(p.preset as string);
            if (!ok) {
                throw new Error(`环境预设 "${p.preset}" 应用失败`);
            }
        },
    });

    // env:toggleGround
    registerAction({
        id: 'ai:control:toggleGround',
        label: 'ai.actions.control.toggleGround',
        domain: 'env',
        params: [],
        execute: () => setEnvState({ groundVisibleEnabled: !envState.groundVisibleEnabled }),
    });

    // model:load
    registerAction({
        id: 'ai:control:loadModel',
        label: 'ai.actions.control.loadModel',
        domain: 'library',
        params: [
            {
                name: 'name',
                type: 'entity',
                resolve: async (name: string) => findLibraryModelByName(name),
            },
        ],
        destructive: true,
        execute: async (p) => {
            replaceModel(p.name as LibraryModel);
        },
    });

    // motion:load
    registerAction({
        id: 'ai:control:loadMotion',
        label: 'ai.actions.control.loadMotion',
        domain: 'motion',
        params: [
            {
                name: 'name',
                type: 'entity',
                resolve: async (name: string) => findLibraryMotionByName(name),
            },
        ],
        destructive: true,
        execute: async (p) => {
            replaceMotion(p.name as LibraryModel);
        },
    });

    // render:performance
    registerAction({
        id: 'ai:control:setPerformance',
        label: 'ai.actions.control.setPerformance',
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
