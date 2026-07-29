import { registerAction } from '../action-registry';
import { getErrors } from '../ai/error-buffer';
import { captureSceneSnapshotData } from '../ai/scene-snapshot';
import { envState } from '../state';
import { modelRegistry } from '../scene-state';
import { makeLazyLoader } from '../async';

const _getBindings = makeLazyLoader(async () => import('@bindings/mikumikuar/internal/app/app'));

export function registerDiagnosticActions(): void {
    registerAction({
        id: 'diagnostic:getFrontendErrors',
        label: 'ai.actions.diagnostic.getErrors',
        domain: 'diagnostic',
        params: [],
        readonly: true,
        execute: async () => {
            const errors = getErrors();
            return { data: errors.length > 0 ? errors : [] };
        },
    });

    registerAction({
        id: 'diagnostic:getSceneSnapshot',
        label: 'ai.actions.diagnostic.getSceneSnapshot',
        domain: 'diagnostic',
        params: [],
        readonly: true,
        execute: async () => {
            const data = captureSceneSnapshotData();
            return { data: data ?? { error: '场景未初始化' } };
        },
    });

    registerAction({
        id: 'diagnostic:getFrontendState',
        label: 'ai.actions.diagnostic.getFrontendState',
        domain: 'diagnostic',
        params: [],
        readonly: true,
        execute: async () => {
            return {
                data: {
                    envPreset: envState.lightingPresetName,
                    groundVisible: envState.groundVisible,
                    skyMode: envState.skyMode,
                    modelCount: modelRegistry.size,
                    models: Array.from(modelRegistry.keys()),
                },
            };
        },
    });

    registerAction({
        id: 'diagnostic:getBackendLogs',
        label: 'ai.actions.diagnostic.getBackendLogs',
        domain: 'diagnostic',
        params: [
            {
                name: 'level',
                type: 'enum',
                enum: ['info', 'warn', 'error'],
                synonyms: { warning: 'warn' },
            },
            { name: 'limit', type: 'range', min: 1, max: 200, step: 1 },
        ],
        readonly: true,
        execute: async (p) => {
            const b = await _getBindings();
            const level = (p.level as string) ?? '';
            const limit = (p.limit as number) ?? 50;
            const logs = await b.AiGetBackendLogs(level, limit);
            return { data: logs ?? [] };
        },
    });

    registerAction({
        id: 'diagnostic:getBackendState',
        label: 'ai.actions.diagnostic.getBackendState',
        domain: 'diagnostic',
        params: [],
        readonly: true,
        execute: async () => {
            const b = await _getBindings();
            const state = await b.AiGetBackendState();
            return { data: state ?? {} };
        },
    });
}
