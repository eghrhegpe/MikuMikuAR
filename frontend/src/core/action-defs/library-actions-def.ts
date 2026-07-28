import { registerAction } from '../action-registry';
import { setModelFormation } from '../../scene/scene';
import { refreshLibrary } from '../../menus/library-setup';
import { importFile } from '../../menus/library-actions';
import { feedbackInfo } from '../feedback';

export function registerLibraryActions(): void {
    registerAction({
        id: 'library:rescan',
        label: '重新扫描模型库',
        domain: 'library',
        params: [],
        destructive: false,
        execute: async () => {
            refreshLibrary();
        },
    });
    registerAction({
        id: 'library:import-file',
        label: '导入模型文件',
        domain: 'library',
        params: [],
        destructive: false,
        execute: async () => {
            importFile();
        },
    });
    registerAction({
        id: 'library:set-formation',
        label: '设置队形',
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
}
