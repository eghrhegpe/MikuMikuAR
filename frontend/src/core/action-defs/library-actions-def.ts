import { registerAction } from '../action-registry';
import { setModelFormation } from '../../scene/scene';
import { refreshLibrary } from '../../menus/library-setup';
import { importFile } from '../../menus/library-actions';
import { feedbackInfo } from '../feedback';
import { allModels } from '../config';
import { getBaseName } from '@/core/path';

export function registerLibraryActions(): void {
    registerAction({
        id: 'library:rescan',
        label: 'ai.actions.library.rescan',
        domain: 'library',
        params: [],
        destructive: false,
        execute: async () => {
            refreshLibrary();
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
            importFile();
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
            setModelFormation(
                p.type as 'line' | 'v-shape' | 'circle' | 'grid' | 'diagonal' | 'arc'
            );
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
                .map((m) => getBaseName(m.file_path));
            return { data: { models, count: models.length } };
        },
    });
}
