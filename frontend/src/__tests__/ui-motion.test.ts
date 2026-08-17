// 动效总开关（core/ui-motion）单测：变量 + 根节点属性双写契约。
// app.css 的全局降级规则（:root[data-ui-animations='0']）只认属性，变量供 calc() 规则消费，
// 两者缺一都会让设置里的「滑动动画」开关部分失效（历史 bug：菜单滑动硬编码时长绕过开关）。
import { describe, it, expect, beforeEach } from 'vitest';
import { applyUiMotionDom } from '../core/ui-motion';

describe('applyUiMotionDom — 动效总开关', () => {
    beforeEach(() => {
        document.documentElement.style.removeProperty('--ui-animations');
        delete document.documentElement.dataset.uiAnimations;
    });

    it('开启时同时写变量 1 与属性 1', () => {
        applyUiMotionDom(true);
        expect(document.documentElement.style.getPropertyValue('--ui-animations')).toBe('1');
        expect(document.documentElement.dataset.uiAnimations).toBe('1');
    });

    it('关闭时同时写变量 0 与属性 0', () => {
        applyUiMotionDom(false);
        expect(document.documentElement.style.getPropertyValue('--ui-animations')).toBe('0');
        expect(document.documentElement.dataset.uiAnimations).toBe('0');
    });

    it('幂等：重复调用只保留最后一次状态', () => {
        applyUiMotionDom(false);
        applyUiMotionDom(true);
        expect(document.documentElement.style.getPropertyValue('--ui-animations')).toBe('1');
        expect(document.documentElement.dataset.uiAnimations).toBe('1');
    });
});
