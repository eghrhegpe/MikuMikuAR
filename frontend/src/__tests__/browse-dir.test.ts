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

    it('网页端虚拟根（web://）→ 同样拼接标准子目录（扫描已映射到虚拟子目录）', () => {
        setLibraryRoot('web://selected-dir');
        expect(getBrowseDir('pmx')).toBe('web://selected-dir/PMX');
        expect(getBrowseDir('vmd')).toBe('web://selected-dir/VMD');
        expect(getBrowseDir('audio')).toBe('web://selected-dir/audio');
        expect(getBrowseDir('stage')).toBe('web://selected-dir/stage');
    });

    it('网页端 overridePaths 仍优先生效', () => {
        setLibraryRoot('web://selected-dir');
        setOverridePaths({ pmx: 'web://custom' });
        expect(getBrowseDir('pmx')).toBe('web://custom');
    });
});
