// menu/scene-physics-levels.test.ts — [audit:fix 2026-10] P2⑧ _patchToggle 作用域回归测试
// _patchToggle(target, newValue, scope) 现在限定到调用方传入的卡片面板 DOM（card 的 inner），
// 不再 document 级 querySelector——跨弹层同名 data-row-key 会碰撞。
// 回归判别：另一个弹层（document.body）存在同 key 的 decoy 行；当前卡片未挂入 document。
// 修复前（全文档查询）会先命中 decoy → decoy 被翻转、本卡片 switch 不动（本测试失败）；
// 修复后只翻转 scope 内的 switch，decoy 不受影响。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setGroundCollisionEnabled } from '../../scene/env/env-collision';

const hooks = vi.hoisted(() => ({
    rows: [] as { key: string; sw: HTMLElement; onChange: (v: boolean) => void }[],
}));
const keyByLabel = vi.hoisted(() => ({
    'scene.groundCollision': 'wasm:ground',
    'scene.matWireframe': 'debug:wireframe',
    'scene.boneLines': 'debug:bonelines',
    'scene.boneJoints': 'debug:bonejoints',
}) as Record<string, string>);

vi.mock('../../scene/scene', () => ({
    modelManager: { get: vi.fn(() => null) },
    setModelWireframe: vi.fn(),
    setModelBoneLinesVis: vi.fn(),
    setModelBoneJointsVis: vi.fn(),
}));
vi.mock('../../scene/env/env-gravity', () => ({
    getGravityStrength: () => 1,
    setGravityStrength: vi.fn(),
}));
vi.mock('../../scene/env/env-collision', () => ({
    getGroundCollisionEnabled: vi.fn(() => false),
    setGroundCollisionEnabled: vi.fn(),
}));
vi.mock('../../core/config', () => ({
    focusedModelId: null,
    cardContainer: (container: HTMLElement, fn: (c: HTMLElement) => (() => void) | void): (() => void) | void => {
        const card = document.createElement('div');
        card.className = 'lcard';
        container.appendChild(card);
        return fn(card);
    },
}));
vi.mock('../../menus/render-menu', () => ({
    renderMenu: (schema: { id: string; kind: string; renderCustom?: (c: unknown) => unknown }[], container: unknown) => {
        for (const n of schema) {
            if (n.kind === 'custom') {
                n.renderCustom?.(container as never);
            }
        }
        return () => {};
    },
}));
vi.mock('../../menus/scene-menu-state', () => ({ refreshSceneRoot: vi.fn() }));
vi.mock('../../core/i18n/t', () => ({ t: (k: string) => k }));
// 假 addToggleRow：构造真实行 DOM（toggle-row + data-row-key + .switch），供 _patchToggle 查询
vi.mock('../../core/ui-helpers', () => ({
    addSliderRow: vi.fn(),
    addToggleRow: (
        inner: HTMLElement,
        label: string,
        value: boolean,
        onChange: (v: boolean) => void,
        _icon?: string,
        _opts?: Record<string, unknown>
    ) => {
        const key = keyByLabel[label] ?? '';
        const row = document.createElement('div');
        row.className = 'toggle-row';
        row.dataset.rowKey = key;
        const sw = document.createElement('span');
        sw.className = 'switch ' + (value ? 'on' : 'off');
        row.appendChild(sw);
        inner.appendChild(row);
        hooks.rows.push({ key, sw, onChange });
    },
}));

describe('scene-physics-levels — _patchToggle scoped（[audit:fix 2026-10]）', () => {
    let decoy: HTMLElement;
    let decoySw: HTMLElement;

    beforeEach(() => {
        hooks.rows.length = 0;
        vi.mocked(setGroundCollisionEnabled).mockClear();
        // decoy：另一个弹层里的同名 data-row-key 行（挂在 document.body 上）
        decoy = document.createElement('div');
        decoy.dataset.rowKey = 'wasm:ground';
        decoySw = document.createElement('span');
        decoySw.className = 'switch off';
        decoy.appendChild(decoySw);
        document.body.appendChild(decoy);
    });

    afterEach(() => {
        decoy.remove();
    });

    it('onChange 只翻转当前卡片内的 switch，不碰跨弹层同 key 行', async () => {
        const { buildWasmPhysicsLevel } = await import('../../menus/scene-physics-levels');
        const level = buildWasmPhysicsLevel();
        const container = document.createElement('div'); // 当前弹层卡片容器（无需挂入 document）
        level.renderCustom?.(container);

        const ground = hooks.rows.find((r) => r.key === 'wasm:ground');
        expect(ground).toBeTruthy();
        expect(ground!.sw.classList.contains('off')).toBe(true);

        ground!.onChange(true);

        expect(setGroundCollisionEnabled).toHaveBeenCalledWith(true);
        expect(ground!.sw.classList.contains('on')).toBe(true);
        expect(ground!.sw.classList.contains('off')).toBe(false);
        // 修复前的 document 级查询会先命中 decoy 并翻转它：
        expect(decoySw.classList.contains('on')).toBe(false);
        expect(decoySw.classList.contains('off')).toBe(true);
    });
});
