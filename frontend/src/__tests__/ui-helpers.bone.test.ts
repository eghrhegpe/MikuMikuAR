// ui-helpers 拆分 — isIkBone / buildBoneGroups / addBoneSelectRow（骨骼选择）
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock createIconifyIcon so tests control whether it returns an element or null
vi.mock('../core/icons', () => ({
    createIconifyIcon: vi.fn(),
}));

import { createIconifyIcon } from '../core/icons';
import { isIkBone, buildBoneGroups, addBoneSelectRow } from '../core/ui-helpers';

const mockIconify = vi.mocked(createIconifyIcon);

beforeEach(() => {
    mockIconify.mockReset();
    // By default, createIconifyIcon returns a valid element
    mockIconify.mockReturnValue(document.createElement('span'));
});

describe('isIkBone', () => {
    it('returns true for known IK bone names', () => {
        expect(isIkBone('左足IK')).toBe(true);
        expect(isIkBone('右足首')).toBe(true);
        expect(isIkBone('左ひざ')).toBe(true);
    });
    it('returns true for names ending with IK suffix', () => {
        expect(isIkBone('カスタムIK')).toBe(true);
    });
    it('returns false for non-IK bones', () => {
        expect(isIkBone('上半身')).toBe(false);
        expect(isIkBone('左腕')).toBe(false);
    });
});

describe('buildBoneGroups', () => {
    it('groups known bones, collects unknown into その他, drops empty groups', () => {
        const groups = buildBoneGroups(['上半身', '左足IK', '首', '未知骨']);
        const groupMap = new Map(groups);
        expect(groupMap.get('上半身')).toEqual(['上半身', '首']);
        expect(groupMap.get('下半身')).toEqual(['左足IK']);
        expect(groupMap.get('その他')).toEqual(['未知骨']);
        // 空组被剔除
        expect(groupMap.has('左腕')).toBe(false);
    });
});

describe('addBoneSelectRow', () => {
    it('renders grouped select with IK tag on IK bones; change fires onChange', () => {
        const container = document.createElement('div');
        const onChange = vi.fn();
        const select = addBoneSelectRow(
            container,
            '骨骼',
            ['上半身', '左足IK', '左腕'],
            '上半身',
            onChange
        );
        expect(select.tagName).toBe('SELECT');
        // 分组存在
        const optgroups = select.querySelectorAll('optgroup');
        expect(optgroups.length).toBeGreaterThanOrEqual(2);
        // IK 骨骼选项文本带 (IK) 标记
        const ikOpt = select.querySelector('option[value="左足IK"]')!;
        expect(ikOpt.textContent).toBe('左足IK (IK)');
        // 非 IK 骨骼无标记
        const normalOpt = select.querySelector('option[value="上半身"]')!;
        expect(normalOpt.textContent).toBe('上半身');
        // 初始值
        expect(select.value).toBe('上半身');
        // change 事件
        select.value = '左足IK';
        select.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenCalledWith('左足IK');
    });

    it('hides label when label is empty string', () => {
        const container = document.createElement('div');
        addBoneSelectRow(container, '', ['上半身'], '上半身', () => {});
        expect(container.querySelectorAll('.cs-label').length).toBe(0);
    });

    it('search input filters options by text content', () => {
        const container = document.createElement('div');
        const select = addBoneSelectRow(
            container,
            '',
            ['上半身', '左腕', '右腕'],
            '上半身',
            () => {}
        );
        const search = container.querySelector('input')!;
        // 输入"左"→ 左腕显示、右腕隐藏
        search.value = '左';
        search.dispatchEvent(new Event('input'));
        const leftOpt = select.querySelector('option[value="左腕"]') as HTMLElement;
        const rightOpt = select.querySelector('option[value="右腕"]') as HTMLElement;
        expect(leftOpt.style.display).toBe('');
        expect(rightOpt.style.display).toBe('none');
    });
});
