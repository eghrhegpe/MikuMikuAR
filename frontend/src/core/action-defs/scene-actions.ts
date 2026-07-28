import { registerAction } from '../action-registry';
import { screenshotCurrent, screenshotBatch, saveScene } from '../../menus/scene-menu';
import { popUndoSnapshot, restoreUndoSnapshot } from '../../scene/scene';
import { feedbackStatus, feedbackInfo } from '../feedback';

export function registerSceneActions(): void {
    registerAction({
        id: 'screenshot:current',
        label: '截图当前模型',
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
        label: '批量截图',
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
        label: '保存场景预设',
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
        label: '撤销操作',
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
}
