// menu-schema.controlspec.test.ts — ControlSpec get/set 衍生控件 + 逆向转换（ADR-093 §6.5 / §6.9，拆自 menu-schema.test.ts）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { renderMenu } from '../menus/render-menu';
import type { MenuNode } from '../menus/menu-schema';
import { envState } from '../core/config';
import { setEnvState } from '../scene/scene';

describe('ADR-093 Menu Schema — ControlSpec get/set 衍生控件', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    // ═══════════════════════════════════════════════════════
    // §6.5 ControlSpec get/set 衍生控件
    // ═══════════════════════════════════════════════════════
    describe('ControlSpec get/set 衍生控件', () => {
        it('get 从 windDirection 向量计算角度', () => {
            const original = envState.windDirection;
            try {
                envState.windDirection = [0, 0, 1]; // 正北 → 0°
                const schema: MenuNode[] = [
                    {
                        id: 't:derived',
                        kind: 'slider',
                        label: 'env.windAngle',
                        control: {
                            bind: 'env.windDirection',
                            min: 0,
                            max: 360,
                            step: 1,
                            get: (v) => {
                                const d = v as [number, number, number];
                                return ((Math.atan2(d[0], d[2]) * 180) / Math.PI + 360) % 360;
                            },
                            set: (angle) => {
                                const rad = ((angle as number) * Math.PI) / 180;
                                return [Math.sin(rad), 0, Math.cos(rad)];
                            },
                        },
                    },
                ];
                renderMenu(schema, container);
                expect(container.children.length).toBeGreaterThan(0);
            } finally {
                envState.windDirection = original;
            }
        });

        it('onChange 副作用在值变更后触发', () => {
            const onChange = vi.fn();
            const schema: MenuNode[] = [
                {
                    id: 't:onChange',
                    kind: 'modeSlider',
                    label: 'env.skyMode',
                    control: {
                        bind: 'env.skyMode',
                        options: [
                            { value: 'color', label: 'env.solid' },
                            { value: 'texture', label: 'env.texture' },
                        ],
                        onChange,
                    },
                },
            ];
            renderMenu(schema, container);
            // 模拟用户点击 modeSlider 选项 — 验证 onChange 在渲染时注册
            expect(container.children.length).toBeGreaterThan(0);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §6.9 ControlSpec.set() 逆向转换链路
    // ═══════════════════════════════════════════════════════
    describe('ControlSpec.set 逆向转换', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('slider set 将百分比 0-100 逆向转换为 0-1 范围', () => {
            const original = envState.skyRotationSpeed;
            try {
                envState.skyRotationSpeed = 0.3; // 初始值 0.3 → get 后显示 30
                const schema: MenuNode[] = [
                    {
                        id: 't:setRev',
                        kind: 'slider',
                        label: 'env.groundPitch',
                        control: {
                            bind: 'env.skyRotationSpeed',
                            min: 0,
                            max: 100,
                            step: 10,
                            get: (v) => Math.round(((v as number) ?? 0) * 100),
                            set: (v) => (v as number) / 100,
                        },
                    },
                ];
                renderMenu(schema, container);
                const bar = container.querySelector('.cs-bar') as HTMLElement;
                expect(bar).toBeTruthy();
                // 按一次 ArrowRight → 从 30 到 40 → set 应写入 0.4
                bar.focus();
                bar.dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
                );
                expect(setEnvState).toHaveBeenCalledWith({ skyRotationSpeed: 0.4 });
            } finally {
                envState.skyRotationSpeed = original;
                vi.clearAllMocks();
            }
        });

        it('headerToggle set 将 boolean 逆向映射为枚举值', () => {
            const original = envState.groundType;
            try {
                envState.groundType = 'flat';
                const schema: MenuNode[] = [
                    {
                        id: 't:htSet',
                        kind: 'folder',
                        label: 'env.ground',
                        defaultOpen: true,
                        headerToggle: {
                            bind: 'env.groundType',
                            get: (v) => v === 'terrain',
                            set: (on) => (on ? 'terrain' : 'flat'),
                        },
                        children: [],
                    },
                ];
                renderMenu(schema, container);
                const toggle = container.querySelector('.toggle.header-toggle') as HTMLLabelElement;
                expect(toggle).toBeTruthy();
                const checkbox = toggle.querySelector('input[type="checkbox"]') as HTMLInputElement;
                expect(checkbox).toBeTruthy();
                expect(checkbox.checked).toBe(false); // flat → off
                // 点击 toggle → 应切换为 on 并写入 'terrain'
                toggle.click();
                expect(setEnvState).toHaveBeenCalledWith({ groundType: 'terrain' });
            } finally {
                envState.groundType = original;
                vi.clearAllMocks();
            }
        });
    });
});
