// action-defs-extra.test.ts — action-defs 剩余三文件（scene / library / diagnostic）行为测试
// 目标：core/action-defs 目录剩余 0% 文件拉高。与 action-defs.test.ts 同构：
// vi.hoisted 共享 mock → 注册 → getAction 全链路触发 execute 断言行为。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const shared = vi.hoisted(() => {
    // library
    const allModels: Array<Record<string, unknown>> = [];
    // diagnostic
    const envState = { lightingPresetName: 'day', groundVisibleEnabled: true, skyMode: 'texture' };
    const modelRegistry = new Map<string, unknown>();
    return {
        allModels,
        envState,
        modelRegistry,
        getSceneAction: vi.fn(),
        getUiAction: vi.fn(),
        feedbackInfo: vi.fn(),
        feedbackStatus: vi.fn(),
        getErrors: vi.fn(),
        captureSceneSnapshotData: vi.fn(),
        AiGetBackendLogs: vi.fn(),
        AiGetBackendState: vi.fn(),
    };
});

vi.mock('@/core/scene-action-bridge', () => ({ getSceneAction: shared.getSceneAction }));
vi.mock('@/core/ui-action-bridge', () => ({ getUiAction: shared.getUiAction }));
vi.mock('@/core/feedback', () => ({
    feedbackInfo: shared.feedbackInfo,
    feedbackStatus: shared.feedbackStatus,
}));
vi.mock('@/core/config', () => ({ allModels: shared.allModels }));
vi.mock('@/core/ai/error-buffer', () => ({ getErrors: shared.getErrors }));
vi.mock('@/core/ai/scene-snapshot', () => ({
    captureSceneSnapshotData: shared.captureSceneSnapshotData,
}));
vi.mock('@/core/state', () => ({ envState: shared.envState }));
vi.mock('@/core/scene-state', () => ({ modelRegistry: shared.modelRegistry }));
vi.mock('@bindings/mikumikuar/internal/app/app', () => ({
    AiGetBackendLogs: shared.AiGetBackendLogs,
    AiGetBackendState: shared.AiGetBackendState,
}));

import { getAction, _resetActionRegistry } from '../core/action-registry';
import { registerSceneActions } from '../core/action-defs/scene-actions';
import { registerLibraryActions } from '../core/action-defs/library-actions-def';
import { registerDiagnosticActions } from '../core/action-defs/diagnostic-actions';

beforeEach(() => {
    _resetActionRegistry();
    vi.clearAllMocks();
    shared.allModels.length = 0;
    shared.modelRegistry.clear();
    Object.assign(shared.envState, {
        lightingPresetName: 'day',
        groundVisibleEnabled: true,
        skyMode: 'texture',
    });
});

// ═══════════════════════════════════════════════════════
// scene — 转发 / undo 双分支 / list-models
// ═══════════════════════════════════════════════════════
describe('action-defs/scene', () => {
    it('3 个转发 action 调用对应 ui-action-bridge key', async () => {
        registerSceneActions();
        const cases: Array<[string, string]> = [
            ['screenshot:current', 'screenshotCurrent'],
            ['screenshot:batch', 'screenshotBatch'],
            ['scene:save', 'saveScene'],
        ];
        for (const [id, key] of cases) {
            const fn = vi.fn();
            shared.getUiAction.mockImplementation((name: string) =>
                name === key ? fn : undefined
            );
            await getAction(id)!.execute({});
            expect(fn, id).toHaveBeenCalledTimes(1);
        }
    });

    it('undo 无快照时反馈 statusNoUndo 且不调 restore', async () => {
        registerSceneActions();
        shared.getSceneAction.mockImplementation((name: string) =>
            name === 'popUndoSnapshot' ? undefined : undefined
        );
        await getAction('scene:undo')!.execute({});
        expect(shared.feedbackStatus).toHaveBeenCalledWith('scene.statusNoUndo', undefined, false);
        expect(shared.getSceneAction).not.toHaveBeenCalledWith(
            'restoreUndoSnapshot',
            expect.anything()
        );
    });

    it('undo 有快照且恢复成功时反馈 undoApplied', async () => {
        registerSceneActions();
        shared.getSceneAction.mockImplementation((name: string) => {
            if (name === 'popUndoSnapshot') {
                return () => ({ snap: 1 });
            }
            if (name === 'restoreUndoSnapshot') {
                return async () => true;
            }
            return undefined;
        });
        await getAction('scene:undo')!.execute({});
        expect(shared.feedbackInfo).toHaveBeenCalledWith('scene.undoApplied', undefined);
    });

    it('list-models 返回模型列表与计数，未注册桥时兜底空列表', async () => {
        registerSceneActions();
        shared.getSceneAction.mockImplementation((name: string) =>
            name === 'listModels' ? () => ['m1', 'm2'] : undefined
        );
        const r = (await getAction('scene:list-models')!.execute({})) as {
            data: { models: string[]; count: number };
        };
        expect(r.data).toEqual({ models: ['m1', 'm2'], count: 2 });

        shared.getSceneAction.mockReturnValue(undefined);
        const empty = (await getAction('scene:list-models')!.execute({})) as {
            data: { models: string[]; count: number };
        };
        expect(empty.data).toEqual({ models: [], count: 0 });
    });
});

// ═══════════════════════════════════════════════════════
// library — 转发 / 队形 / list 投影
// ═══════════════════════════════════════════════════════
describe('action-defs/library', () => {
    it('rescan/import-file 转发对应 scene-action-bridge key', async () => {
        registerLibraryActions();
        const refreshLibrary = vi.fn();
        const importFile = vi.fn();
        shared.getSceneAction.mockImplementation((name: string) => {
            if (name === 'refreshLibrary') {
                return refreshLibrary;
            }
            if (name === 'importFile') {
                return importFile;
            }
            return undefined;
        });
        await getAction('library:rescan')!.execute({});
        await getAction('library:import-file')!.execute({});
        expect(refreshLibrary).toHaveBeenCalledTimes(1);
        expect(importFile).toHaveBeenCalledTimes(1);
        expect(getAction('library:import-file')!.uiOnly).toBe(true);
    });

    it('set-formation 6 种队形转发并反馈动态 i18n key', async () => {
        registerLibraryActions();
        const setModelFormation = vi.fn();
        shared.getSceneAction.mockImplementation((name: string) =>
            name === 'setModelFormation' ? setModelFormation : undefined
        );
        const types = ['line', 'v-shape', 'circle', 'grid', 'diagonal', 'arc'];
        for (const type of types) {
            await getAction('library:set-formation')!.execute({ type });
            expect(setModelFormation).toHaveBeenLastCalledWith(type);
            expect(shared.feedbackInfo).toHaveBeenLastCalledWith(
                'scene.formationStatus.' + type,
                undefined
            );
        }
    });

    it('list 过滤 vmd 项并投影 8 字段', async () => {
        registerLibraryActions();
        shared.allModels.push(
            {
                format: 'pmx',
                file_path: '/a.pmx',
                dir: '/',
                comment: 'c1',
                container: '',
                zip_inner: '',
                category: 'm',
                source: 'local',
            },
            {
                format: 'vmd',
                file_path: '/b.vmd',
                dir: '/',
                comment: 'c2',
                container: '',
                zip_inner: '',
                category: 'm',
                source: 'local',
            },
            {
                format: 'zip',
                file_path: '/c.zip',
                dir: '/',
                comment: 'c3',
                container: '/c.zip',
                zip_inner: '/inner.pmx',
                category: 'm',
                source: 'local',
            }
        );
        const r = (await getAction('library:list')!.execute({})) as {
            data: { models: Record<string, unknown>[]; count: number };
        };
        expect(r.data.count).toBe(2); // vmd 被过滤
        expect(r.data.models[0]).toEqual({
            path: '/a.pmx',
            dir: '/',
            format: 'pmx',
            comment: 'c1',
            container: '',
            zipInner: '',
            category: 'm',
            source: 'local',
        });
        expect(r.data.models[1].zipInner).toBe('/inner.pmx');
        expect(r.data.models.some((m) => m.format === 'vmd')).toBe(false);
    });

    it('list 空库返回空列表', async () => {
        registerLibraryActions();
        const r = (await getAction('library:list')!.execute({})) as {
            data: { models: unknown[]; count: number };
        };
        expect(r.data).toEqual({ models: [], count: 0 });
    });
});

// ═══════════════════════════════════════════════════════
// diagnostic — 只读诊断动作
// ═══════════════════════════════════════════════════════
describe('action-defs/diagnostic', () => {
    it('getFrontendErrors 空数组与非空透传', async () => {
        registerDiagnosticActions();
        shared.getErrors.mockReturnValue([]);
        expect(await getAction('diagnostic:getFrontendErrors')!.execute({})).toEqual({ data: [] });
        shared.getErrors.mockReturnValue(['err1']);
        expect(await getAction('diagnostic:getFrontendErrors')!.execute({})).toEqual({
            data: ['err1'],
        });
    });

    it('getSceneSnapshot 有数据与未初始化兜底', async () => {
        registerDiagnosticActions();
        shared.captureSceneSnapshotData.mockReturnValue({ snapshot: 1 });
        expect(await getAction('diagnostic:getSceneSnapshot')!.execute({})).toEqual({
            data: { snapshot: 1 },
        });
        shared.captureSceneSnapshotData.mockReturnValue(null);
        const r = (await getAction('diagnostic:getSceneSnapshot')!.execute({})) as {
            data: { error: string };
        };
        expect(r.data.error).toBe('场景未初始化');
    });

    it('getFrontendState 组装 envState 与 modelRegistry 快照', async () => {
        registerDiagnosticActions();
        shared.modelRegistry.set('m1', {});
        shared.modelRegistry.set('m2', {});
        const r = (await getAction('diagnostic:getFrontendState')!.execute({})) as {
            data: Record<string, unknown>;
        };
        expect(r.data).toEqual({
            envPreset: 'day',
            groundVisibleEnabled: true,
            skyMode: 'texture',
            modelCount: 2,
            models: ['m1', 'm2'],
        });
    });

    it('getBackendLogs 参数默认值归一化并透传 data', async () => {
        registerDiagnosticActions();
        shared.AiGetBackendLogs.mockResolvedValue(['log1']);
        const defaulted = (await getAction('diagnostic:getBackendLogs')!.execute({})) as {
            data: string[];
        };
        expect(shared.AiGetBackendLogs).toHaveBeenCalledWith('', 50);
        expect(defaulted.data).toEqual(['log1']);

        shared.AiGetBackendLogs.mockResolvedValue(null);
        const withParams = (await getAction('diagnostic:getBackendLogs')!.execute({
            level: 'warn',
            limit: 100,
        })) as { data: unknown };
        expect(shared.AiGetBackendLogs).toHaveBeenLastCalledWith('warn', 100);
        expect(withParams.data).toEqual([]); // null → 空数组兜底
    });

    it('getBackendState 透传数据且 null 兜底为空对象', async () => {
        registerDiagnosticActions();
        shared.AiGetBackendState.mockResolvedValue({ version: '1.0' });
        expect(await getAction('diagnostic:getBackendState')!.execute({})).toEqual({
            data: { version: '1.0' },
        });
        shared.AiGetBackendState.mockResolvedValue(null);
        expect(await getAction('diagnostic:getBackendState')!.execute({})).toEqual({ data: {} });
    });
});
