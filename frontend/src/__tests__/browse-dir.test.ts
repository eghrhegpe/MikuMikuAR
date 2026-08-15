// @vitest-environment node
// [bugfix:web-library-empty] getBrowseDir 路径解析回归测试
// [audit:round22 P3] 注释修正：web:// 虚拟根同样统一拼接标准子目录（web://root/PMX）。
// web-library-empty 的根因修复在扫描侧（browser-adapter 扁平→虚拟子目录映射），
// 本测试锁定 getBrowseDir 契约侧：无 web:// 特判、统一拼接 + 整体 normPath。
import { describe, it, expect, beforeEach } from 'vitest';
import { getBrowseDir } from '@/core/library-path';
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

    it('未知类别 → 回落类别名本身作为子目录（与 Go 端 GetPath 未知类别返回 root 不同，此处锁定 TS 语义）', () => {
        setLibraryRoot('D:/MikuMikuAR');
        expect(getBrowseDir('vpd')).toBe('D:/MikuMikuAR/vpd');
        expect(getBrowseDir('motion')).toBe('D:/MikuMikuAR/motion');
    });

    it('prop/md_dress/environment/setting 类别 → 各自标准子目录（对齐 Go 端 GetPath defs 与 OverridePaths 键集）', () => {
        setLibraryRoot('D:/MikuMikuAR');
        expect(getBrowseDir('prop')).toBe('D:/MikuMikuAR/prop');
        expect(getBrowseDir('md_dress')).toBe('D:/MikuMikuAR/MD-dress');
        expect(getBrowseDir('environment')).toBe('D:/MikuMikuAR/environment');
        expect(getBrowseDir('setting')).toBe('D:/MikuMikuAR/setting');
    });

    it('libraryRoot 尾部斜杠 → 归一化去掉尾斜杠，不产生双斜杠', () => {
        setLibraryRoot('D:/MikuMikuAR/');
        expect(getBrowseDir('pmx')).toBe('D:/MikuMikuAR/PMX');
        expect(getBrowseDir('vmd')).toBe('D:/MikuMikuAR/VMD');
    });

    it('libraryRoot 反斜杠（Windows filepath.Join 风格）→ 统一为正斜杠', () => {
        setLibraryRoot('D:\\MikuMikuAR');
        expect(getBrowseDir('pmx')).toBe('D:/MikuMikuAR/PMX');
        expect(getBrowseDir('audio')).toBe('D:/MikuMikuAR/audio');
    });

    it('override 值带尾部斜杠/反斜杠 → 归一化后返回', () => {
        setLibraryRoot('D:/MikuMikuAR');
        setOverridePaths({ pmx: 'E:/custom/models/' });
        expect(getBrowseDir('pmx')).toBe('E:/custom/models');
        setOverridePaths({ vmd: 'E:\\custom\\motions\\' });
        expect(getBrowseDir('vmd')).toBe('E:/custom/motions');
    });

    it('override 值为空字符串 → 视为未设置，回落 libraryRoot 子目录', () => {
        setLibraryRoot('D:/MikuMikuAR');
        setOverridePaths({ pmx: '' });
        expect(getBrowseDir('pmx')).toBe('D:/MikuMikuAR/PMX');
    });

    // —— 缺陷回归：libraryRoot 分支拼接后未整体 normPath，未知类别（fallback 用
    // category 本身）传入反斜杠/尾斜杠/`.`段时残留未归一化，违反函数契约
    // 「返回值统一经 normPath 归一化」。getBrowseDir 注册为 UI action，kind 来自外部输入。
    it('未知 category 带反斜杠 → 整体归一化为正斜杠（契约：返回值统一 normPath）', () => {
        setLibraryRoot('D:/MikuMikuAR');
        expect(getBrowseDir('MD\\dress_extra')).toBe('D:/MikuMikuAR/MD/dress_extra');
    });

    it('未知 category 带尾部斜杠 → 去尾部斜杠（契约：返回值统一去尾斜杠）', () => {
        setLibraryRoot('D:/MikuMikuAR');
        expect(getBrowseDir('extra/')).toBe('D:/MikuMikuAR/extra');
    });

    it('未知 category 含 . 段 → 折叠为 .（契约：返回值统一 normPath）', () => {
        setLibraryRoot('D:/MikuMikuAR');
        expect(getBrowseDir('a/./b')).toBe('D:/MikuMikuAR/a/b');
    });
});
