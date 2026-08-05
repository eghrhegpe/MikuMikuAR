// @ts-nocheck — vi.mock 运行时替换（见 ./library-core-mocks）
import { describe, it, expect, vi } from 'vitest';
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
} from './library-core-mocks';

const mockState = vi.hoisted(() => ({
    allModels: [] as any[],
    libraryRoot: '/test/root',
    displayNamePriority: 'filename' as string,
    librarySortMode: 'default' as string,
    modelMetaCache: new Map<string, any>(),
    recentModels: [] as string[],
    focusedModelId: null as string | null,
}));

vi.mock('../scene/scene', () => sceneFactory());
vi.mock('../core/wails-bindings', () => wailsBindingsFactory());
vi.mock('../core/load-manager', () => loadManagerFactory());
vi.mock('./model-detail', () => modelDetailFactory());
vi.mock('../menus/scene-menu', () => sceneMenuFactory());
vi.mock('./menu', () => menuFactory());
vi.mock('../core/icons', () => iconsFactory());
vi.mock('../core/status-bar', () => statusBarFactory());
vi.mock('../core/config', () => configModuleFactory(mockState));
vi.mock('@/core/library-path', () => libraryPathFactory(mockState));
vi.mock('../core/ui-helpers', () => ({ slideRow: vi.fn() }));

import { getRelativePathUnderDir, splitSubdirSegments } from '../menus/library-core';
import { isUnderRoot } from '../core/path';
import { normPath } from '../core/fileservice';

describe('path-boundary hardening', () => {
    describe('isUnderRoot 拒绝 .. 逃逸段 (P2 场景1)', () => {
        it('含 /../ 的中间段返回 false', () => {
            expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMX/../VMD')).toBe(false);
        });
        it('以 /.. 结尾返回 false', () => {
            expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMX/..')).toBe(false);
        });
        it('正常子路径仍返回 true（回归保护）', () => {
            expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMX/Sub')).toBe(true);
        });
    });

    describe('getRelativePathUnderDir 拒绝 .. 逃逸段 (P2 场景1)', () => {
        it('含 .. 的路径返回 null，不把 .. 当子目录段', () => {
            expect(
                getRelativePathUnderDir('C:/text-model/PMX/../VMD/foo.pmx', 'C:/text-model/PMX')
            ).toBeNull();
        });
        it('正常子目录返回相对路径（回归保护）', () => {
            expect(
                getRelativePathUnderDir('C:/text-model/PMX/Sub/foo.pmx', 'C:/text-model/PMX')
            ).toBe('Sub/foo.pmx');
        });
        it('mdir 与 base 完全相等（同目录）返回空字符串（既有语义保持）', () => {
            expect(getRelativePathUnderDir('C:/text-model/PMX', 'C:/text-model/PMX')).toBe('');
        });
    });

    describe('normPath 折叠 . 段 + content:// 去尾部斜杠 (P3/P4)', () => {
        it('折叠中间 . 段', () => {
            expect(normPath('C:/text-model/./PMX')).toBe('C:/text-model/PMX');
        });
        it('折叠开头 . 段', () => {
            expect(normPath('./foo/bar')).toBe('foo/bar');
        });
        it('折叠结尾 . 段', () => {
            expect(normPath('foo/bar/.')).toBe('foo/bar');
        });
        it('content:// 去除尾部斜杠（与文件 URI 行为统一）', () => {
            expect(normPath('content://com.example/foo/')).toBe('content://com.example/foo');
        });
        it('正常路径不变（回归保护）', () => {
            expect(normPath('C:/text-model/PMX/Sub')).toBe('C:/text-model/PMX/Sub');
        });
    });

    describe('splitSubdirSegments 加固 (P2 场景1 + P2 场景2)', () => {
        it('含 .. 的 root 或 dir 直接返回 null', () => {
            expect(
                splitSubdirSegments('C:/text-model/PMX', 'C:/text-model/PMX/../VMD/Sub')
            ).toBeNull();
            expect(splitSubdirSegments('C:/text-model/PMX/..', 'C:/text-model/Sub')).toBeNull();
        });
        it('同盘异父串台拒绝展开（C:/other/PMX/Sub 不应展开到 C:/text-model/PMX/Sub）', () => {
            expect(splitSubdirSegments('C:/text-model/PMX', 'C:/other/PMX/Sub')).toBeNull();
        });
        it('同根异形态仍展开（大小写/反斜杠，回归保护）', () => {
            expect(splitSubdirSegments('C:/Models/pmx', 'C:/Models/PMX/Sub')).toEqual(['Sub']);
            expect(splitSubdirSegments('C:\\Models\\PMX', 'C:/Models/PMX/Sub')).toEqual(['Sub']);
        });
    });
});
