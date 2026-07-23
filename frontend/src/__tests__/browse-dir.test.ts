// [bugfix:web-library-empty] getBrowseDir 路径解析回归测试
// 网页端虚拟根（web://）为扁平目录结构，不应拼接 PMX/VMD 等子目录，
// 否则扫描到的模型（dir=web://selected-dir）不在拼接路径之下，资源库显示为空。
import { describe, it, expect, beforeEach } from 'vitest';
import { getBrowseDir } from '../core/utils';
import { setLibraryRoot, setOverridePaths } from '../core/state';

describe('getBrowseDir', () => {
    beforeEach(() => {
        setLibraryRoot('');
        setOverridePaths({});
    });

    it('libraryRoot 未设置 → 返回空字符串', () => {
        expect(getBrowseDir('pmx')).toBe('');
    });

    it('桌面端根目录 → 拼接标准子目录（PMX/VMD）', () => {
        setLibraryRoot('D:/MikuMikuAR');
        expect(getBrowseDir('pmx')).toBe('D:/MikuMikuAR/PMX');
        expect(getBrowseDir('vmd')).toBe('D:/MikuMikuAR/VMD');
    });

    it('overridePaths 优先于 libraryRoot 子目录', () => {
        setLibraryRoot('D:/MikuMikuAR');
        setOverridePaths({ pmx: 'E:/custom/models' });
        expect(getBrowseDir('pmx')).toBe('E:/custom/models');
    });

    it('网页端虚拟根（web://）→ 扁平结构，不拼接子目录', () => {
        setLibraryRoot('web://selected-dir');
        // 关键回归：所有类别都直接返回根路径，避免拼出 web://selected-dir/PMX
        expect(getBrowseDir('pmx')).toBe('web://selected-dir');
        expect(getBrowseDir('vmd')).toBe('web://selected-dir');
        expect(getBrowseDir('audio')).toBe('web://selected-dir');
        expect(getBrowseDir('stage')).toBe('web://selected-dir');
    });

    it('网页端 overridePaths 仍优先生效', () => {
        setLibraryRoot('web://selected-dir');
        setOverridePaths({ pmx: 'web://custom' });
        expect(getBrowseDir('pmx')).toBe('web://custom');
    });
});
