// [doc:adr-238] 库操作经 scene-action-bridge 调用（定义留 core、实现归 scene/menus）
import { registerAction } from '../action-registry';
import { feedbackInfo } from '../feedback';
import { getSceneAction } from '../scene-action-bridge';
import { allModels } from '../config';

export function registerLibraryActions(): void {
    registerAction({
        id: 'library:rescan',
        label: 'ai.actions.library.rescan',
        domain: 'library',
        params: [],
        destructive: false,
        execute: async () => {
            await getSceneAction('refreshLibrary')?.();
        },
    });
    registerAction({
        id: 'library:import-file',
        label: 'ai.actions.library.importFile',
        domain: 'library',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            getSceneAction('importFile')?.();
        },
    });
    registerAction({
        id: 'library:set-formation',
        label: 'ai.actions.library.setFormation',
        domain: 'library',
        params: [
            {
                name: 'type',
                type: 'enum',
                enum: ['line', 'v-shape', 'circle', 'grid', 'diagonal', 'arc'],
                synonyms: { row: 'line', column: 'line' },
            },
        ],
        destructive: false,
        execute: async (p) => {
            getSceneAction('setModelFormation')?.(p.type as string);
            feedbackInfo('scene.formationStatus.' + p.type, undefined);
        },
    });
    registerAction({
        id: 'library:list',
        label: 'ai.actions.library.list',
        domain: 'library',
        params: [],
        readonly: true,
        execute: async () => {
            const models = allModels
                .filter((m) => m.format !== 'vmd')
                .map((m) => ({
                    path: m.file_path,
                    dir: m.dir,
                    format: m.format,
                    comment: m.comment,
                    container: m.container,
                    zipInner: m.zip_inner,
                    category: m.category,
                    source: m.source,
                }));
            return { data: { models, count: models.length } };
        },
    });
}
