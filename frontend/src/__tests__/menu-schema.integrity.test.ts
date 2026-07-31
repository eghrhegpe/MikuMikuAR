// menu-schema.integrity.test.ts — ADR-093 元测试：Schema 驱动的完整性校验
// 不依赖浏览器/DOM，直接对 MenuNode[] schema 做静态分析。
// 捕获缺陷类型：bind 路径无效、i18n key 缺失、id 重复、folder 空子节点。
// 新增面板时：在 menu-schema-register.ts 注册 getXxxSchema() 即自动覆盖。

import { describe, it, expect, beforeAll, vi } from 'vitest';

// mock 副作用模块，避免 Babylon Scene 初始化
vi.mock('@/scene/scene', () => ({
    setEnvState: vi.fn(),
}));
vi.mock('@/scene/env/env-lighting', () => ({
    TIME_OF_DAY_PRESETS: {},
}));
vi.mock('@/scene/env/env-time-of-day', () => ({
    applyEnvPreset: vi.fn(),
}));
vi.mock('@/core/ui-helpers', () => ({
    slideRow: vi.fn(),
    addSliderRow: vi.fn(),
    buildPresetChipGroup: vi.fn(),
    addClearRow: vi.fn(),
}));
vi.mock('@/menus/env-level-helpers', () => ({
    buildLevel: vi.fn((label: string, render: (c: HTMLElement) => void) => ({
        label,
        dir: '',
        items: [],
        renderCustom: render,
    })),
    openTexturePicker: vi.fn(),
}));

// 触发集中注册（import 副作用）
import '../menus/menu-schema-register';
import { collectAllSchemas, flattenNodes } from '../menus/menu-registry';

// state 字段名集合（从各 state 模块获取）
import { ENV_STATE_SCHEMA } from '../core/env-state-schema';
import { defaultRenderState } from '../scene/render/renderer';
import { DEFAULT_PERCEPTION_STATE } from '../scene/motion/perception-shared';
import { uiState } from '../core/state';

// i18n 基准语言包
import { zhCN } from '../core/i18n/locales/zh-CN';
import { bundles } from '../core/i18n/t';

// 初始化 bundles，避免 t() 运行时警告（fog schema 的 options label 用了 t() 调用）
bundles['zh-CN'] = zhCN;

const ENV_KEYS = new Set(Object.keys(ENV_STATE_SCHEMA));
const RENDER_KEYS = new Set(Object.keys(defaultRenderState()));
const PERCEPTION_KEYS = new Set(Object.keys(DEFAULT_PERCEPTION_STATE));
const UI_KEYS = new Set(Object.keys(uiState));
const I18N_KEYS = new Set(Object.keys(zhCN));

// LightState 字段（从 lighting.ts 类型定义硬编码，字段变化时测试失败暴露漂移）
const LIGHT_KEYS = new Set([
    'hemiIntensity',
    'dirIntensity',
    'dirX',
    'dirY',
    'dirZ',
    'dirColor',
    'hemiColor',
    'groundColor',
    'shadowEnabled',
    'shadowType',
    'shadowCascades',
    'shadowResolution',
    'shadowBias',
]);

/** StatePath 前缀 → 有效字段集合 */
const STATE_PREFIX_MAP: Record<string, Set<string>> = {
    env: ENV_KEYS,
    render: RENDER_KEYS,
    light: LIGHT_KEYS,
    perception: PERCEPTION_KEYS,
    ui: UI_KEYS,
};

/** 检查 StatePath（如 'env.skyMode'）是否指向有效字段 */
function isValidStatePath(path: string): boolean {
    const dot = path.indexOf('.');
    if (dot < 0) {
        return false;
    }
    const prefix = path.slice(0, dot);
    const field = path.slice(dot + 1);
    const keySet = STATE_PREFIX_MAP[prefix];
    return keySet ? keySet.has(field) : false;
}

describe('ADR-093 Schema 完整性元测试', () => {
    const schemas = collectAllSchemas();

    beforeAll(() => {
        // 确保至少收集到已注册的 schema
        expect(schemas.length).toBeGreaterThanOrEqual(3);
    });

    // ═══════════════════════════════════════════════════════
    // §1 control.bind 路径有效性
    // ═══════════════════════════════════════════════════════
    describe('control.bind 路径有效性', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const nodesWithBind = allNodes.filter((n) => n.control?.bind);

        it.each(
            nodesWithBind.map((n) => ({
                id: n.id,
                bind: n.control!.bind!,
            }))
        )('$id → bind "$bind" 指向有效 state 字段', ({ bind }) => {
            expect(isValidStatePath(bind)).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §2 id 全局唯一
    // ═══════════════════════════════════════════════════════
    describe('id 全局唯一', () => {
        it('所有已注册 schema 的节点 id 无重复', () => {
            const allIds = schemas.flatMap((s) => flattenNodes(s.nodes).map((n) => n.id));
            const seen = new Set<string>();
            const dupes: string[] = [];
            for (const id of allIds) {
                if (seen.has(id)) {
                    dupes.push(id);
                }
                seen.add(id);
            }
            expect(dupes).toEqual([]);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §3 i18n key 存在性
    // ═══════════════════════════════════════════════════════
    describe('i18n key 存在性', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const nodesWithLabel = allNodes.filter((n) => n.label);

        it.each(
            nodesWithLabel.map((n) => ({
                id: n.id,
                label: n.label!,
            }))
        )('$id label "$label" 在 zh-CN 语言包中存在', ({ label }) => {
            // 跳过非 i18n key 的 label（如直接文本，不含点号）
            if (!label.includes('.')) {
                return;
            }
            expect(I18N_KEYS.has(label)).toBe(true);
        });

        // modeSlider options 的 label 也需校验
        const modeSliders = allNodes.filter((n) => n.kind === 'modeSlider' && n.control?.options);
        it.each(
            modeSliders.flatMap((n) =>
                n.control!.options!.map((opt) => ({
                    id: n.id,
                    optLabel: opt.label,
                }))
            )
        )('$id option "$optLabel" 在 zh-CN 语言包中存在', ({ optLabel }) => {
            if (!optLabel || !optLabel.includes('.')) {
                return;
            }
            expect(I18N_KEYS.has(optLabel)).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §4 folder children 非空
    // ═══════════════════════════════════════════════════════
    describe('folder children 非空', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const folders = allNodes.filter((n) => n.kind === 'folder');

        it.each(folders.map((n) => ({ id: n.id })))('$id folder 有子节点', ({ id }) => {
            const folder = allNodes.find((n) => n.id === id)!;
            expect(folder.children?.length).toBeGreaterThan(0);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §5 modeSlider options 与 state 枚举一致性（信息性检查）
    // ═══════════════════════════════════════════════════════
    describe('modeSlider options 非空', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const modeSliders = allNodes.filter((n) => n.kind === 'modeSlider');

        it.each(modeSliders.map((n) => ({ id: n.id })))('$id modeSlider 有 options', ({ id }) => {
            const slider = allNodes.find((n) => n.id === id)!;
            expect(slider.control?.options?.length).toBeGreaterThan(0);
        });
    });
});
