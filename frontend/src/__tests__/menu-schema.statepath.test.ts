// menu-schema.statepath.test.ts — ui./light./perception. StatePath 前缀与 set 链路（ADR-093 §6.7 / §6.8，拆自 menu-schema.test.ts）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockScene, mockLighting, mockPerception, mockRegistry } from './menu-schema-mocks';

vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/scene/render/lighting', () => mockLighting());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockRegistry());

import { renderMenu } from '../menus/render-menu';
import type { MenuNode } from '../menus/menu-schema';
import { uiState, setUIState } from '../core/state';
import { setLightState } from '../scene/render/lighting';
import { setPerceptionState } from '../scene/motion/perception';

describe('ADR-093 Menu Schema — StatePath 前缀与 set 链路', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    // ═══════════════════════════════════════════════════════
    // §6.7 ui. StatePath 前缀（settings 域扩展）
    // ═══════════════════════════════════════════════════════
    describe('ui. StatePath 前缀', () => {
        it('slider 绑定 ui.screenshotQuality 并通过 get/set 百分比转换', () => {
            const original = uiState.screenshotQuality;
            try {
                uiState.screenshotQuality = 0.9;
                const schema: MenuNode[] = [
                    {
                        id: 't:uiSlider',
                        kind: 'slider',
                        label: '截图质量',
                        control: {
                            bind: 'ui.screenshotQuality',
                            min: 50,
                            max: 100,
                            step: 5,
                            get: (v) => Math.round(((v as number) ?? 0.9) * 100),
                            set: (v) => (v as number) / 100,
                        },
                        icon: 'lucide:gauge',
                    },
                ];
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
    // §6.8 light. / perception. StatePath set 链路
    // ═══════════════════════════════════════════════════════
    describe('StatePath set 链路', () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it('light. 前缀 set 调用 setLightState', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:light',
                    kind: 'toggle',
                    label: 'env.groundVisible',
                    control: { bind: 'light.shadowEnabled' },
                },
            ];
            renderMenu(schema, container);
            // 触发 toggle 点击
            const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
            expect(input).toBeTruthy();
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            expect(setLightState).toHaveBeenCalledWith({ shadowEnabled: true });
        });

        it('perception. 前缀 set 调用 setPerceptionState', () => {
            const schema: MenuNode[] = [
                {
                    id: 't:perception',
                    kind: 'toggle',
                    label: 'env.groundVisible',
                    control: { bind: 'perception.eyeTrackingEnabled' },
                },
            ];
            renderMenu(schema, container);
            const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
            expect(input).toBeTruthy();
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            expect(setPerceptionState).toHaveBeenCalledWith({ eyeTrackingEnabled: true });
        });
    });
});
