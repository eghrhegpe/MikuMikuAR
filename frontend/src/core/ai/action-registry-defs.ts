// action-registry-defs.ts — [doc:adr-238] AI 动作注册聚合（定义留 core，execute 经 scene-action-bridge）。
import { registerAction } from '../action-registry';
import { showToast } from '../toast';
import { t } from '../i18n/t';
import { getSceneAction } from '../scene-action-bridge';
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

/** [fix:P3] 守卫返回 false 时给出用户可见反馈：此前花括号吞掉返回值，
 *  灯光未就绪（启动早期 / AR 会话切换）AI 动作仍报"执行成功"，用户只见画面无变化。 */
function _reportLightWrite(ok: boolean): void {
    if (!ok) {
        showToast(t('toast.lightNotReady'));
    }
}

export function registerControlActions(): void {
    // light:dirIntensity
    registerAction({
        id: 'ai:control:setLightIntensity',
        label: 'ai.actions.control.setLightIntensity',
        domain: 'scene',
        params: [{ name: 'dirIntensity', type: 'range', min: 0, max: 1, step: 0.05 }],
        execute: (p) => {
            _reportLightWrite(getSceneAction('setLightState')?.({ dirIntensity: p.dirIntensity as number }) ?? false);
        },
    });

    // light:color
    registerAction({
        id: 'ai:control:setLightColor',
        label: 'ai.actions.control.setLightColor',
        domain: 'scene',
        params: [{ name: 'dirColor', type: 'color' }],
        execute: (p) => {
            _reportLightWrite(getSceneAction('setLightState')?.({ dirColor: p.dirColor as [number, number, number] }) ?? false);
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
        execute: (p) => getSceneAction('setCameraMode')?.(p.mode as string),
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
            const ok = getSceneAction('applyEnvPreset')?.(p.preset as string) ?? false;
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
        execute: () => getSceneAction('setEnvState')?.({ groundVisibleEnabled: !getSceneAction('getEnvGroundVisible')?.() }),
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
                resolve: async (name: string) => getSceneAction('findLibraryModelByName')?.(name),
            },
        ],
        destructive: true,
        execute: async (p) => {
            await getSceneAction('replaceModel')?.(p.name);
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
                resolve: async (name: string) => getSceneAction('findLibraryMotionByName')?.(name),
            },
        ],
        destructive: true,
        execute: async (p) => {
            await getSceneAction('replaceMotion')?.(p.name);
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
        execute: (p) => getSceneAction('setPerformanceMode')?.(p.mode as string),
    });
}
