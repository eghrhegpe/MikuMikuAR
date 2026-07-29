import { registerAction } from '../action-registry';
import { toDiagnosticContext } from '../ai/error-buffer';
import { captureSceneSnapshot } from '../ai/scene-snapshot';

export function registerDiagnosticActions(): void {
    registerAction({
        id: 'diagnostic:getFrontendErrors',
        label: 'ai.actions.diagnostic.getErrors',
        domain: 'settings' as const,
        params: [],
        readonly: true,
        execute: async () => {
            const ctx = toDiagnosticContext({ maxBytes: 4096 });
            return { data: ctx };
        },
    });

    registerAction({
        id: 'diagnostic:getSceneSnapshot',
        label: 'ai.actions.diagnostic.getSceneSnapshot',
        domain: 'settings' as const,
        params: [],
        readonly: true,
        execute: async () => {
            const snapshot = captureSceneSnapshot();
            return { data: snapshot };
        },
    });
}
