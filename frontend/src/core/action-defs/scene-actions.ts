import { registerAction } from '../action-registry';
import { screenshotCurrent, screenshotBatch, saveScene } from '../../menus/scene-menu';
import { popUndoSnapshot, restoreUndoSnapshot, modelManager } from '../../scene/scene';
import { feedbackStatus, feedbackInfo } from '../feedback';

export function registerSceneActions(): void {
    registerAction({
        id: 'screenshot:current',
        label: 'ai.actions.scene.screenshotCurrent',
        domain: 'scene',
        icon: 'lucide:camera',
        params: [],
        destructive: false,
        execute: async () => {
            await screenshotCurrent();
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
            await screenshotBatch();
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
            await saveScene();
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
            const snap = popUndoSnapshot();
            if (!snap) {
                feedbackStatus('scene.statusNoUndo', undefined, false);
                return;
            }
            const ok = await restoreUndoSnapshot(snap);
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
            const models = modelManager.getAll().map((m) => ({ id: m.id, name: m.name }));
            return { data: { models, count: models.length } };
        },
    });
}
