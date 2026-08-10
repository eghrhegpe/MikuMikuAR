// @vitest-environment node
// library-state.test.ts — [fix:round14 P3] 三个清空函数单测。
// library-state.ts 仅含类型导入，无运行时依赖，可直接 import 无需 vi.mock。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    thumbnailCache,
    setThumbnailUpdateCallback,
    clearThumbnailCache,
    addRecentMotion,
    getRecentMotions,
    clearRecentMotions,
    expandedFolders,
    toggleExpandedFolder,
    clearExpandedFolders,
} from '@/core/library-state';

describe('library-state 清空函数（round14 P3 修复）', () => {
    beforeEach(() => {
        thumbnailCache.clear();
        expandedFolders.clear();
        setThumbnailUpdateCallback(null as unknown as () => void);
    });

    it('clearThumbnailCache 清空 Map 并触发更新回调', () => {
        thumbnailCache.set('a', 'thumb-a');
        thumbnailCache.set('b', 'thumb-b');
        const cb = vi.fn();
        setThumbnailUpdateCallback(cb);

        clearThumbnailCache();

        expect(thumbnailCache.size).toBe(0);
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('clearThumbnailCache 无回调时不抛错', () => {
        thumbnailCache.set('x', 'y');
        expect(() => clearThumbnailCache()).not.toThrow();
        expect(thumbnailCache.size).toBe(0);
    });

    it('clearRecentMotions 清空最近动作列表', () => {
        addRecentMotion('/m/a.vmd', 'A');
        addRecentMotion('/m/b.vmd', 'B');
        expect(getRecentMotions().length).toBe(2);

        clearRecentMotions();

        expect(getRecentMotions()).toEqual([]);
    });

    it('clearExpandedFolders 清空已展开文件夹集合', () => {
        toggleExpandedFolder('/root/models');
        toggleExpandedFolder('/root/stages');
        expect(expandedFolders.size).toBe(2);

        clearExpandedFolders();

        expect(expandedFolders.size).toBe(0);
    });

    it('clearExpandedFolders 空集合安全', () => {
        expect(() => clearExpandedFolders()).not.toThrow();
        expect(expandedFolders.size).toBe(0);
    });
});
