// scene-actions.ts — [doc:adr-238] 场景动作定义（定义留 core，execute 经桥调实现）。
import { registerAction } from '../action-registry';
import { feedbackStatus, feedbackInfo } from '../feedback';
import { getUiAction } from '../ui-action-bridge';
import { getSceneAction } from '../scene-action-bridge';

export function registerSceneActions(): void {
    registerAction({
        id: 'screenshot:current',
        label: 'ai.actions.scene.screenshotCurrent',
        domain: 'scene',
        icon: 'lucide:camera',
        params: [],
        destructive: false,
        execute: async () => {
            await getUiAction('screenshotCurrent')?.();
        },
    });

    registerAction({
        id: 'screenshot:batch',
        label: 'ai.actions.scene.screenshotBatch',
        domain: 'scene',
        icon: 'lucide:camera',
        params: [],
        destructive: false,
        execute: async () => {
            await getUiAction('screenshotBatch')?.();
        },
    });

    registerAction({
        id: 'scene:save',
        label: 'ai.actions.scene.save',
        domain: 'scene',
        icon: 'lucide:save',
        params: [],
        destructive: false,
        execute: async () => {
            await getUiAction('saveScene')?.();
        },
    });

    registerAction({
        id: 'scene:undo',
        label: 'ai.actions.scene.undo',
        domain: 'scene',
        icon: 'lucide:undo-2',
        params: [],
        destructive: false,
        execute: async () => {
            const snap = getSceneAction('popUndoSnapshot')?.();
            if (!snap) {
                feedbackStatus('scene.statusNoUndo', undefined, false);
                return;
            }
            const ok = await getSceneAction('restoreUndoSnapshot')?.(snap);
            if (ok) {
                feedbackInfo('scene.undoApplied', undefined);
            }
        },
    });
    registerAction({
        id: 'scene:list-models',
        label: 'ai.actions.scene.listModels',
        domain: 'scene',
        params: [],
        readonly: true,
        execute: async () => {
            const models = getSceneAction('listModels')?.() ?? [];
            return { data: { models, count: models.length } };
        },
    });
}
