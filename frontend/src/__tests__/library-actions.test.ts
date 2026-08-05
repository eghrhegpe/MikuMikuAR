// @ts-nocheck — vi.mock 运行时替换（与 library-core-mocks 同构）
// library-actions 专项测试：覆盖替换竞态、加载异常、VPD 兜底（audit-p2/p4 补测）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    sceneFactory,
    wailsBindingsFactory,
    loadManagerFactory,
    modelDetailFactory,
    sceneMenuFactory,
    menuFactory,
    iconsFactory,
    statusBarFactory,
    configModuleFactory,
    libraryPathFactory,
    uiHelpersFactory,
    makeModel,
} from './library-core-mocks';
import { t } from '../core/i18n/t';
import { librarySessionStore } from '../menus/library-session-store';

const mockState = vi.hoisted(() => ({
    allModels: [] as any[],
    libraryRoot: '/test/root',
    displayNamePriority: 'filename' as string,
    librarySortMode: 'default' as string,
    modelMetaCache: new Map<string, any>(),
    recentModels: [] as string[],
    focusedModelId: null as string | null,
}));
const capturedSlideRows = vi.hoisted(() => [] as any[]);

vi.mock('../scene/scene', () => ({
    ...sceneFactory(),
    pushUndoSnapshot: vi.fn(),
    offerSceneUndoAndRefresh: vi.fn(),
    triggerAutoSave: vi.fn(),
}));
vi.mock('../core/wails-bindings', () => wailsBindingsFactory());
vi.mock('../core/load-manager', () => loadManagerFactory());
vi.mock('./model-detail', () => modelDetailFactory());
vi.mock('../menus/scene-menu', () => sceneMenuFactory());
vi.mock('./menu', () => menuFactory());
vi.mock('../core/icons', () => iconsFactory());
vi.mock('../core/status-bar', () => statusBarFactory());
vi.mock('../core/ui-helpers', () => uiHelpersFactory(capturedSlideRows));
vi.mock('../core/config', () => configModuleFactory(mockState));
vi.mock('@/core/library-path', () => libraryPathFactory(mockState));
vi.mock('../scene/manager/model-ops', () => ({
    captureInheritedState: vi.fn(() => null),
    applyInheritedState: vi.fn(),
}));
vi.mock('../core/toast', () => ({ showErrorToast: vi.fn(), showInfoToast: vi.fn() }));
vi.mock('@/core/scene-action-bridge', () => ({ registerSceneAction: vi.fn() }));

import { loadManager } from '../core/load-manager';
import {
    loadVPDPose,
    removeModel,
    pushUndoSnapshot,
    offerSceneUndoAndRefresh,
    triggerAutoSave,
} from '../scene/scene';
import { AddRecentModel, ExtractZip, GetModelsByTag, SetLastBrowseDir } from '../core/wails-bindings';
import { setStatus } from '../core/status-bar';
import { showErrorToast } from '../core/toast';
import { modelRegistry } from '../core/config';
import {
    onModelRowClick,
    replaceModel,
    replaceMotion,
    buildTagDetailLevel,
    findLibraryModelByName,
    findLibraryMotionByName,
    importFileByPath,
} from '../menus/library-actions';

describe('library-actions — 行点击 / 替换 / 动作 / 标签 / 导入', () => {
    beforeEach(() => {
        // resetAllMocks（非 clearAllMocks）：清掉 once 实现与残留 mockResolvedValue，
        // 防止失败用例的 mockImplementationOnce(hang) 泄漏到后续测试导致误挂起。
        vi.resetAllMocks();
        mockState.allModels = [];
        mockState.focusedModelId = null;
        mockState.recentModels = [];
        modelRegistry.clear();
        librarySessionStore.setReplaceLoading(false);
        librarySessionStore.clearExtracting();
        capturedSlideRows.length = 0;
        // 真实 wails/scene 绑定均为 async（返回 Promise）；safeCallAsync/withLoadingStatus
        // 依赖 .then 消费，mock 默认须返回 resolved promise，否则 undefined.then 抛 TypeError。
        AddRecentModel.mockResolvedValue(undefined);
        SetLastBrowseDir.mockResolvedValue(undefined);
        loadVPDPose.mockResolvedValue(undefined);
    });

    describe('VPD 加载（audit-p2 兜底）', () => {
        it('vpd 格式点击走 loadVPDPose，不经过 loadManager', () => {
            const m = makeModel({
                format: 'vpd',
                container: 'file',
                file_path: '/test/root/models/pose.vpd',
            });
            onModelRowClick(m);
            expect(loadVPDPose).toHaveBeenCalledWith('/test/root/models/pose.vpd');
            expect(loadManager.load).not.toHaveBeenCalled();
        });

        it('loadVPDPose 失败被 safeCallAsync 吞掉，不产生未处理 rejection', async () => {
            loadVPDPose.mockRejectedValueOnce(new Error('vpd boom'));
            const m = makeModel({
                format: 'vpd',
                container: 'file',
                file_path: '/test/root/models/pose.vpd',
            });
            expect(() => onModelRowClick(m)).not.toThrow();
            // 等 safeCallAsync 内部 await 消化 rejection
            await vi.waitFor(() => expect(loadVPDPose).toHaveBeenCalled());
        });
    });

    describe('加载守卫（audit 替换竞态）', () => {
        it('replaceLoading 期间点击被拦截，不触发 loadManager', () => {
            librarySessionStore.setReplaceLoading(true);
            const m = makeModel({ file_path: '/test/root/models/a.pmx' });
            onModelRowClick(m);
            expect(loadManager.load).not.toHaveBeenCalled();
            expect(setStatus).toHaveBeenCalled();
        });

        it('正在解压的模型点击被拦截（per-model 守卫）', () => {
            const p = '/test/root/models/a.pmx';
            librarySessionStore.setExtracting(p);
            onModelRowClick(makeModel({ file_path: p }));
            expect(loadManager.load).not.toHaveBeenCalled();
            expect(setStatus).toHaveBeenCalled();
        });

        it('[fix P1] replaceMotion 快速连点两次：第二次被 replaceLoading 拦截，撤销快照只记一次', async () => {
            mockState.focusedModelId = 'm1';
            let releaseFirst!: () => void;
            loadManager.load.mockImplementationOnce(
                () => new Promise((res) => (releaseFirst = () => res({ id: 'vmd1' })))
            );
            const vmd = makeModel({ file_path: '/test/root/models/a.vmd', format: 'vmd' });

            // 第一次点击：doLoad 进入挂起态，已 push 快照
            replaceMotion(vmd);
            await vi.waitFor(() => expect(loadManager.load).toHaveBeenCalledTimes(1));
            expect(pushUndoSnapshot).toHaveBeenCalledTimes(1);

            // 第二次点击：doLoad 未结束（replaceLoading=true），被拦截
            replaceMotion(vmd);
            expect(loadManager.load).toHaveBeenCalledTimes(1);
            expect(pushUndoSnapshot).toHaveBeenCalledTimes(1);
            expect(setStatus).toHaveBeenCalled();

            // 释放第一次 → finally 复位 replaceLoading
            releaseFirst();
            await vi.waitFor(() => expect(librarySessionStore.isReplaceLoading()).toBe(false));
            // 释放后同一参数重推不受守卫阻挡
            replaceMotion(vmd);
            await vi.waitFor(() => expect(loadManager.load).toHaveBeenCalledTimes(2));
        });
    });

    describe('正常加载', () => {
        it('pmx 正常加载走 loadManager(actor)', () => {
            loadManager.load.mockResolvedValue({ id: 'm1' });
            const m = makeModel({ file_path: '/test/root/models/a.pmx' });
            onModelRowClick(m);
            expect(loadManager.load).toHaveBeenCalledWith(
                { kind: 'actor', path: '/test/root/models/a.pmx' },
                expect.any(AbortSignal)
            );
        });

        it('加载失败 → feedbackError → showErrorToast', async () => {
            loadManager.load.mockRejectedValueOnce(new Error('load boom'));
            const m = makeModel({ file_path: '/test/root/models/b.pmx' });
            onModelRowClick(m);
            await vi.waitFor(() => expect(showErrorToast).toHaveBeenCalled());
        });

        it('快速连点两次：第二次 abort 第一次，两次请求都收敛不悬空', async () => {
            let rejectFirst!: (e: unknown) => void;
            loadManager.load.mockImplementationOnce(
                () => new Promise((_res, rej) => (rejectFirst = rej))
            );
            loadManager.load.mockResolvedValue({ id: 'new' });
            onModelRowClick(makeModel({ file_path: '/test/root/models/a.pmx' }));
            onModelRowClick(makeModel({ file_path: '/test/root/models/b.pmx' }));
            rejectFirst(new Error('Aborted'));
            await vi.waitFor(() => expect(showErrorToast).toHaveBeenCalled());
            await vi.waitFor(() => expect(loadManager.load).toHaveBeenCalledTimes(2));
        });
    });

    describe('替换模式（startReplaceModel）', () => {
        it('zip 替换：ExtractZip → loadManager(actor) → 移除旧模型', async () => {
            mockState.focusedModelId = 'old1';
            modelRegistry.set('old1', { id: 'old1', name: 'old' });
            loadManager.load.mockResolvedValue({ id: 'new1' });
            ExtractZip.mockResolvedValue({ file_path: '/cache/a.pmx' });
            const m = makeModel({
                file_path: '/test/root/models/a.pmx',
                container: 'zip',
                zip_inner: 'model.pmx',
            });
            replaceModel(m);
            expect(ExtractZip).toHaveBeenCalledWith('/test/root/models/a.pmx', 'model.pmx');
            await vi.waitFor(() =>
                expect(loadManager.load).toHaveBeenCalledWith(
                    {
                        kind: 'actor',
                        path: '/cache/a.pmx',
                        libraryPath: '/test/root/models/a.pmx',
                        innerPath: 'model.pmx',
                    },
                    expect.any(AbortSignal)
                )
            );
            await vi.waitFor(() => expect(removeModel).toHaveBeenCalledWith('old1'));
        });

        it('替换完成后提供场景级撤销', async () => {
            mockState.focusedModelId = 'old1';
            modelRegistry.set('old1', { id: 'old1', name: 'old' });
            loadManager.load.mockResolvedValue({ id: 'new1' });
            const m = makeModel({ file_path: '/test/root/models/a.pmx' });
            replaceModel(m);
            await vi.waitFor(() =>
                expect(offerSceneUndoAndRefresh).toHaveBeenCalledWith(
                    expect.any(String),
                    undefined,
                    expect.any(Function)
                )
            );
        });
    });

    describe('动作替换（replaceMotion）', () => {
        it('非 zip vmd：doLoad 安全包装后加载到聚焦模型', async () => {
            mockState.focusedModelId = 'm1';
            loadManager.load.mockResolvedValue({ id: 'm1' });
            const m = makeModel({
                format: 'vmd',
                container: 'file',
                file_path: '/test/root/models/dance.vmd',
            });
            replaceMotion(m);
            await vi.waitFor(() =>
                expect(loadManager.load).toHaveBeenCalledWith({
                    kind: 'vmd',
                    path: '/test/root/models/dance.vmd',
                    modelId: 'm1',
                })
            );
            expect(pushUndoSnapshot).toHaveBeenCalled();
            await vi.waitFor(() => expect(triggerAutoSave).toHaveBeenCalled());
            await vi.waitFor(() => expect(offerSceneUndoAndRefresh).toHaveBeenCalled());
        });
    });

    describe('标签层（audit-p4 XSS 防护）', () => {
        it('空标签渲染安全空态（textContent，非 innerHTML）', async () => {
            GetModelsByTag.mockResolvedValue([]);
            const level = buildTagDetailLevel('收藏');
            const container = document.createElement('div');
            await level.renderCustom(container);
            const empty = container.querySelector('.slide-empty');
            expect(empty).toBeTruthy();
            expect(empty.textContent).toBe(t('library.tagNoModels'));
        });

        it('匹配到模型时渲染行', async () => {
            GetModelsByTag.mockResolvedValue(['/test/root/models/a.pmx']);
            mockState.allModels = [makeModel({ file_path: '/test/root/models/a.pmx' })];
            const level = buildTagDetailLevel('收藏');
            const container = document.createElement('div');
            await level.renderCustom(container);
            expect(capturedSlideRows).toHaveLength(1);
            expect(capturedSlideRows[0].label).toBe('a.pmx');
        });

        it('拉取失败降级为文本提示', async () => {
            GetModelsByTag.mockRejectedValue(new Error('boom'));
            const level = buildTagDetailLevel('收藏');
            const container = document.createElement('div');
            await level.renderCustom(container);
            expect(container.textContent).toBe(t('library.loadFailed'));
        });
    });

    describe('纯查询', () => {
        it('findLibraryModelByName 大小写不敏感模糊匹配', () => {
            mockState.allModels = [
                makeModel({ file_path: '/test/a.pmx' }),
                makeModel({ format: 'vmd', file_path: '/test/dance.vmd' }),
            ];
            expect(findLibraryModelByName('A')).toBe(mockState.allModels[0]);
            expect(findLibraryModelByName('danc')).toBe(mockState.allModels[1]);
        });

        it('findLibraryMotionByName 仅匹配 vmd', () => {
            mockState.allModels = [
                makeModel({ file_path: '/test/a.pmx' }),
                makeModel({ format: 'vmd', file_path: '/test/dance.vmd' }),
            ];
            expect(findLibraryMotionByName('dan')).toBe(mockState.allModels[1]);
            expect(findLibraryMotionByName('zzz')).toBeNull();
        });
    });

    describe('导入文件（importFileByPath）', () => {
        it('.pmx 路径走 loadManager(actor)', async () => {
            loadManager.load.mockResolvedValue({ id: 'x' });
            await importFileByPath('/tmp/model.pmx');
            expect(loadManager.load).toHaveBeenCalledWith({ kind: 'actor', path: '/tmp/model.pmx' });
        });

        it('.vmd 路径走 loadManager(vmd)', async () => {
            loadManager.load.mockResolvedValue({ id: 'x' });
            await importFileByPath('/tmp/dance.vmd');
            expect(loadManager.load).toHaveBeenCalledWith({ kind: 'vmd', path: '/tmp/dance.vmd' });
        });

        it('不支持格式给状态栏反馈', async () => {
            await importFileByPath('/tmp/readme.txt');
            expect(loadManager.load).not.toHaveBeenCalled();
            expect(setStatus).toHaveBeenCalled();
        });
    });
});
