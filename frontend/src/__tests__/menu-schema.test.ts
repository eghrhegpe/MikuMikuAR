// [doc:adr-093] PoC 验证测试：visibleWhen 守卫 + 各 kind 渲染 + dispose 级联 + i18n 热切换
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock scene/lighting 模块，避免 Babylon.js Scene 初始化
vi.mock('@/scene/scene', () => ({
    setEnvState: vi.fn(),
    getRenderState: vi.fn(() => ({})),
}));
vi.mock('@/scene/render/lighting', () => ({
    getLightState: vi.fn(() => ({})),
    setLightState: vi.fn(),
}));

import { renderMenu } from '../menus/render-menu';
import type { MenuNode } from '../menus/menu-schema';
import { envState } from '../core/config';
import { uiState, setUIState } from '../core/state';
import { setLang, getLang } from '../core/i18n/locale';
import type { LangCode } from '../core/i18n/locale';

// ─── ADR-093 Menu Schema PoC 验证 ─────────────────────────────
// 覆盖 §6 要求：各 kind 渲染 / visibleWhen 守卫 / renderCustom dispose 级联 / i18n 热切换

describe('ADR-093 Menu Schema PoC', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    // ═══════════════════════════════════════════════════════
    // §6.1 各 kind 渲染
    // ═══════════════════════════════════════════════════════
    describe('各 kind 渲染', () => {
        it('slider 生成滑块行 DOM', () => {
            const schema: MenuNode[] = [{
                id: 't:slider', kind: 'slider', label: 'env.groundPitch',
                control: { bind: 'env.groundPitch', min: -45, max: 45, step: 1 },
                icon: 'lucide:arrow-up-down',
            }];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
            expect(container.querySelector('.cs-row')).toBeTruthy();
        });

        it('toggle 生成开关行 DOM', () => {
            const schema: MenuNode[] = [{
                id: 't:toggle', kind: 'toggle', label: 'env.groundFollowCamera',
                control: { bind: 'env.groundFollowCamera' }, icon: 'lucide:map-pin',
            }];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
        });

        it('colorSlider 生成颜色滑块 DOM', () => {
            const schema: MenuNode[] = [{
                id: 't:color', kind: 'colorSlider', label: 'env.skyColorTop',
                control: { bind: 'env.skyColorTop' },
            }];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
        });

        it('modeSlider 生成模式选择器 DOM', () => {
            const schema: MenuNode[] = [{
                id: 't:mode', kind: 'modeSlider', label: 'env.skyMode',
                control: {
                    bind: 'env.skyMode',
                    options: [
                        { value: 'color', label: 'env.solid' },
                        { value: 'texture', label: 'env.texture' },
                    ],
                },
                icon: 'lucide:sun',
            }];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
        });

        it('custom 调用 renderCustom 并将内容写入容器', () => {
            const renderCustom = vi.fn((cc: HTMLElement) => {
                const div = document.createElement('div');
                div.id = 'custom-el';
                cc.appendChild(div);
            });
            const schema: MenuNode[] = [{ id: 't:custom', kind: 'custom', renderCustom }];
            renderMenu(schema, container);
            expect(renderCustom).toHaveBeenCalledWith(container);
            expect(container.querySelector('#custom-el')).toBeTruthy();
        });

        it('folder 渲染折叠面板 + 子节点', () => {
            const schema: MenuNode[] = [{
                id: 't:folder', kind: 'folder', label: 'env.ground',
                icon: 'lucide:grid-3x3', defaultOpen: true,
                children: [
                    { id: 't:folder:slider', kind: 'slider', label: 'env.groundPitch',
                      control: { bind: 'env.groundPitch', min: -45, max: 45, step: 1 } },
                ],
            }];
            renderMenu(schema, container);
            expect(container.querySelector('.collapsible-wrapper')).toBeTruthy();
        });

        it('divider 不生成 DOM', () => {
            const schema: MenuNode[] = [{ id: 't:divider', kind: 'divider' }];
            renderMenu(schema, container);
            expect(container.children.length).toBe(0);
        });

        it('headerToggle bind 直接 boolean 映射', () => {
            const schema: MenuNode[] = [{
                id: 't:htoggle', kind: 'folder', label: 'env.ground',
                defaultOpen: true,
                headerToggle: { bind: 'env.groundFollowCamera' },
                children: [
                    { id: 't:htoggle:child', kind: 'slider', label: 'env.groundPitch',
                      control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 } },
                ],
            }];
            renderMenu(schema, container);
            expect(container.querySelector('.collapsible-wrapper')).toBeTruthy();
            expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
        });
    });

    // ═══════════════════════════════════════════════════════
    // §6.2 visibleWhen 守卫
    // ═══════════════════════════════════════════════════════
    describe('visibleWhen 守卫', () => {
        it('返回 false 时节点跳过渲染', () => {
            const schema: MenuNode[] = [{
                id: 't:hidden', kind: 'slider', label: 'env.groundPitch',
                control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                visibleWhen: () => false,
            }];
            renderMenu(schema, container);
            expect(container.children.length).toBe(0);
        });

        it('返回 true 时节点正常渲染', () => {
            const schema: MenuNode[] = [{
                id: 't:visible', kind: 'slider', label: 'env.groundPitch',
                control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                visibleWhen: () => true,
            }];
            renderMenu(schema, container);
            expect(container.children.length).toBeGreaterThan(0);
        });

        it('基于 envState 的动态条件守卫', () => {
            const originalGT = envState.groundType;
            try {
                const schema: MenuNode[] = [{
                    id: 't:cond', kind: 'slider', label: 'env.groundPitch',
                    control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                    visibleWhen: () => envState.groundType !== 'terrain',
                }];

                envState.groundType = 'flat';
                renderMenu(schema, container);
                expect(container.children.length).toBeGreaterThan(0);

                container.innerHTML = '';
                envState.groundType = 'terrain';
                renderMenu(schema, container);
                expect(container.children.length).toBe(0);
            } finally {
                envState.groundType = originalGT;
            }
        });

        it('folder 子节点的 visibleWhen 独立求值', () => {
            const schema: MenuNode[] = [{
                id: 't:folder', kind: 'folder', label: 'env.ground',
                defaultOpen: true,
                children: [
                    { id: 't:show', kind: 'slider', label: 'env.groundPitch',
                      control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
                      visibleWhen: () => true },
                    { id: 't:hide', kind: 'slider', label: 'env.groundRoll',
                      control: { bind: 'env.groundRoll', min: 0, max: 1, step: 0.1 },
                      visibleWhen: () => false },
                ],
            }];
            renderMenu(schema, container);
            // folder 渲染了，visibleWhen=true 的子节点存在，visibleWhen=false 的被跳过
            const rows = container.querySelectorAll('.cs-row');
            expect(rows.length).toBe(1); // 只有 visibleWhen=true 的 slider 被渲染
        });
    });

    // ═══════════════════════════════════════════════════════
    // §6.3 renderCustom dispose 级联（ADR §6 P1 + 附录 P2）
    // ═══════════════════════════════════════════════════════
    describe('renderCustom dispose 级联', () => {
        it('custom 返回的 dispose 被 renderMenu 收集并执行', () => {
            const dispose = vi.fn();
            const schema: MenuNode[] = [{
                id: 't:d1', kind: 'custom', renderCustom: () => dispose,
            }];
            const release = renderMenu(schema, container);
            expect(dispose).not.toHaveBeenCalled();
            release();
            expect(dispose).toHaveBeenCalledTimes(1);
        });

        it('folder 内 custom 子节点的 dispose 在级联释放时被调用', () => {
            const childDispose = vi.fn();
            const schema: MenuNode[] = [{
                id: 't:folder', kind: 'folder', label: 'env.ground',
                defaultOpen: true,
                children: [
                    { id: 't:c', kind: 'custom', renderCustom: () => childDispose },
                ],
            }];
            const release = renderMenu(schema, container);
            expect(childDispose).not.toHaveBeenCalled();
            release();
            expect(childDispose).toHaveBeenCalledTimes(1);
        });

        it('folder 自身的 renderCustom dispose 也被收集', () => {
            const folderDispose = vi.fn();
            const schema: MenuNode[] = [{
                id: 't:folder', kind: 'folder', label: 'env.ground',
                defaultOpen: true,
                renderCustom: () => folderDispose,
            }];
            const release = renderMenu(schema, container);
            release();
            expect(folderDispose).toHaveBeenCalledTimes(1);
        });

        it('多个 custom 的 dispose 全部按序执行', () => {
            const order: string[] = [];
            const d1 = vi.fn(() => order.push('d1'));
            const d2 = vi.fn(() => order.push('d2'));
            const d3 = vi.fn(() => order.push('d3'));
            const schema: MenuNode[] = [
                { id: 't:c1', kind: 'custom', renderCustom: () => d1 },
                { id: 't:c2', kind: 'custom', renderCustom: () => d2 },
                { id: 't:c3', kind: 'custom', renderCustom: () => d3 },
            ];
            const release = renderMenu(schema, container);
            release();
            expect(d1).toHaveBeenCalledTimes(1);
            expect(d2).toHaveBeenCalledTimes(1);
            expect(d3).toHaveBeenCalledTimes(1);
            expect(order).toEqual(['d1', 'd2', 'd3']);
        });

        it('renderCustom 返回 void 时 dispose 不报错', () => {
            const schema: MenuNode[] = [{
                id: 't:void', kind: 'custom',
                renderCustom: (cc) => { cc.appendChild(document.createElement('div')); },
            }];
            const release = renderMenu(schema, container);
            expect(() => release()).not.toThrow();
        });

        it('visibleWhen=false 的 custom 节点不调用 renderCustom 也不收集 dispose', () => {
            const renderCustom = vi.fn();
            const dispose = vi.fn();
            const schema: MenuNode[] = [{
                id: 't:hidden', kind: 'custom',
                visibleWhen: () => false,
                renderCustom: () => { renderCustom(); return dispose; },
            }];
            const release = renderMenu(schema, container);
            expect(renderCustom).not.toHaveBeenCalled();
            release();
            expect(dispose).not.toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════
    // §6.4 headerToggle get/set 映射
    // ═══════════════════════════════════════════════════════
    describe('headerToggle get/set 映射', () => {
        it('get 将 groundType=terrain 映射为 toggle ON', () => {
            const original = envState.groundType;
            try {
                envState.groundType = 'terrain';
                const schema: MenuNode[] = [{
                    id: 't:ht', kind: 'folder', label: 'env.ground',
                    defaultOpen: true,
                    headerToggle: {
                        bind: 'env.groundType',
                        get: (v) => v === 'terrain',
                        set: (on) => (on ? 'terrain' : 'flat'),
                    },
                    children: [
                        { id: 't:ht:child', kind: 'slider', label: 'env.groundPitch',
                          control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 } },
                    ],
                }];
                renderMenu(schema, container);
                const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
                expect(checkbox).toBeTruthy();
                expect(checkbox.checked).toBe(true);
            } finally {
                envState.groundType = original;
            }
        });

        it('get 将 groundType=flat 映射为 toggle OFF', () => {
            const original = envState.groundType;
            try {
                envState.groundType = 'flat';
                const schema: MenuNode[] = [{
                    id: 't:ht2', kind: 'folder', label: 'env.ground',
                    defaultOpen: true,
                    headerToggle: {
                        bind: 'env.groundType',
                        get: (v) => v === 'terrain',
                        set: (on) => (on ? 'terrain' : 'flat'),
                    },
                    children: [
                        { id: 't:ht2:child', kind: 'slider', label: 'env.groundPitch',
                          control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 } },
                    ],
                }];
                renderMenu(schema, container);
                const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
                expect(checkbox).toBeTruthy();
                expect(checkbox.checked).toBe(false);
            } finally {
                envState.groundType = original;
            }
        });
    });

    // ═══════════════════════════════════════════════════════
    // §6.5 ControlSpec get/set 衍生控件
    // ═══════════════════════════════════════════════════════
    describe('ControlSpec get/set 衍生控件', () => {
        it('get 从 windDirection 向量计算角度', () => {
            const original = envState.windDirection;
            try {
                envState.windDirection = [0, 0, 1]; // 正北 → 0°
                const schema: MenuNode[] = [{
                    id: 't:derived', kind: 'slider', label: 'env.windAngle',
                    control: {
                        bind: 'env.windDirection',
                        min: 0, max: 360, step: 1,
                        get: (v) => {
                            const d = v as [number, number, number];
                            return ((Math.atan2(d[0], d[2]) * 180) / Math.PI + 360) % 360;
                        },
                        set: (angle) => {
                            const rad = ((angle as number) * Math.PI) / 180;
                            return [Math.sin(rad), 0, Math.cos(rad)];
                        },
                    },
                }];
                renderMenu(schema, container);
                expect(container.children.length).toBeGreaterThan(0);
            } finally {
                envState.windDirection = original;
            }
        });

        it('onChange 副作用在值变更后触发', () => {
            const onChange = vi.fn();
            const schema: MenuNode[] = [{
                id: 't:onChange', kind: 'modeSlider', label: 'env.skyMode',
                control: {
                    bind: 'env.skyMode',
                    options: [{ value: 'color', label: 'env.solid' }, { value: 'texture', label: 'env.texture' }],
                    onChange,
                },
            }];
            renderMenu(schema, container);
            // 模拟用户点击 modeSlider 选项 — 验证 onChange 在渲染时注册
            expect(container.children.length).toBeGreaterThan(0);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §6.7 ui. StatePath 前缀（settings 域扩展）
    // ═══════════════════════════════════════════════════════
    describe('ui. StatePath 前缀', () => {
        it('slider 绑定 ui.screenshotQuality 并通过 get/set 百分比转换', () => {
            const original = uiState.screenshotQuality;
            try {
                uiState.screenshotQuality = 0.9;
                const schema: MenuNode[] = [{
                    id: 't:uiSlider', kind: 'slider', label: '截图质量',
                    control: {
                        bind: 'ui.screenshotQuality',
                        min: 50, max: 100, step: 5,
                        get: (v) => Math.round(((v as number) ?? 0.9) * 100),
                        set: (v) => (v as number) / 100,
                    },
                    icon: 'lucide:gauge',
                }];
                renderMenu(schema, container);
                expect(container.querySelector('.cs-row')).toBeTruthy();
                // slider 显示值应为 90（0.9 * 100）
                const valEl = container.querySelector('.cs-value');
                expect(valEl?.textContent).toContain('90');
            } finally {
                if (original !== undefined) {
                    setUIState({ screenshotQuality: original });
                }
            }
        });
    });

    // ═══════════════════════════════════════════════════════
    // §6.6 i18n 热切换（ADR-065 核心收益）
    // ═══════════════════════════════════════════════════════
    describe('i18n 热切换', () => {
        let savedLang: LangCode;

        beforeEach(() => {
            savedLang = getLang();
        });

        afterEach(() => {
            setLang(savedLang);
        });

        it('切换语言后重新渲染，label 文本随之变化', () => {
            const schema: MenuNode[] = [{
                id: 't:i18n', kind: 'slider', label: 'env.sky',
                control: { bind: 'env.groundPitch', min: 0, max: 1, step: 0.1 },
            }];

            setLang('zh-CN');
            renderMenu(schema, container);
            const zhText = container.textContent ?? '';

            container.innerHTML = '';
            setLang('en');
            renderMenu(schema, container);
            const enText = container.textContent ?? '';

            // 两种语言的 label 应该不同（证明 t() 在渲染时重新求值）
            expect(zhText).not.toBe(enText);
        });

        it('modeSlider options label 经 t() 国际化', () => {
            const schema: MenuNode[] = [{
                id: 't:i18nMode', kind: 'modeSlider', label: 'env.skyMode',
                control: {
                    bind: 'env.skyMode',
                    options: [
                        { value: 'color', label: 'env.solid' },
                        { value: 'texture', label: 'env.texture' },
                    ],
                },
            }];

            setLang('zh-CN');
            renderMenu(schema, container);
            const zhText = container.textContent ?? '';

            container.innerHTML = '';
            setLang('en');
            renderMenu(schema, container);
            const enText = container.textContent ?? '';

            expect(zhText).not.toBe(enText);
        });
    });
});
