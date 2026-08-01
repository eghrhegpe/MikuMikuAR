// menu-schema.integrity.test.ts — ADR-093 元测试：Schema 驱动的完整性校验
// 不依赖浏览器/DOM，直接对 MenuNode[] schema 做静态分析。
// 捕获缺陷类型：bind 路径无效、i18n key 缺失、id 重复、folder 空子节点。
// 新增面板时：在 menu-schema-register.ts 注册 getXxxSchema() 即自动覆盖。

import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
    mockScene,
    mockCoreWailsBindings,
    mockSceneBundle,
    mockPresetListViewer,
    mockSceneRenderPresets,
    mockCoreStatusHelpers,
    mockCoreAsync,
    mockCoreToast,
    mockCoreRenderLoop,
    mockRenderPerformance,
    mockSettingsMenuState,
    mockSceneMenuState,
    mockPerception,
    mockMotionModuleRegistry,
    mockMotionPopup,
    mockCoreAutoSave,
    mockMenu,
    mockRenderer,
} from './menu-schema-mocks';

// mock 副作用模块，避免 Babylon Scene 初始化
vi.mock('@/scene/scene', () => mockScene());
vi.mock('@/core/wails-bindings', () => mockCoreWailsBindings());
vi.mock('@/scene/scene-bundle', () => mockSceneBundle());
vi.mock('@/menus/preset-list-viewer', () => mockPresetListViewer());
vi.mock('@/menus/scene-render-presets', () => mockSceneRenderPresets());
vi.mock('@/core/status-helpers', () => mockCoreStatusHelpers());
vi.mock('@/core/async', () => mockCoreAsync());
vi.mock('@/core/toast', () => mockCoreToast());
vi.mock('@/core/render-loop', () => mockCoreRenderLoop());
vi.mock('@/scene/render/performance', () => mockRenderPerformance());
vi.mock('@/menus/settings-menu-state', () => mockSettingsMenuState());
vi.mock('@/scene/env/env-lighting', () => ({
    TIME_OF_DAY_PRESETS: {},
}));
vi.mock('@/scene/env/env-time-of-day', () => ({
    applyEnvPreset: vi.fn(),
}));
vi.mock('@/scene/env/env-water', () => ({
    WATER_PRESETS: {},
    applyWaterPresetToCurrent: vi.fn(),
    buildWaterPresetEnvState: vi.fn(() => ({})),
    disposeWater: vi.fn(),
    createWater: vi.fn(),
    setGroundGeometryProvider: vi.fn(),
}));
vi.mock('@/scene/env/env-ground-presets', () => ({
    GROUND_PRESETS: {},
    buildGroundPresetEnvState: vi.fn(() => ({})),
}));
vi.mock('@/scene/render/lighting', () => ({
    getLightState: vi.fn(() => ({ shadowResolution: 1024 })),
    setLightState: vi.fn(),
}));
vi.mock('@/core/ui-helpers', () => ({
    slideRow: vi.fn(),
    addSliderRow: vi.fn(),
    buildPresetChipGroup: vi.fn(),
    addClearRow: vi.fn(),
}));
vi.mock('@/core/icons', () => ({
    createIconifyIcon: vi.fn(),
}));
vi.mock('@/core/feedback', () => ({
    feedbackInfo: vi.fn(),
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
vi.mock('@/menus/scene-menu-state', () => mockSceneMenuState());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-modules/registry', () => mockMotionModuleRegistry());
vi.mock('@/menus/motion-popup', () => mockMotionPopup());
vi.mock('@/core/auto-save', () => mockCoreAutoSave());
vi.mock('@/menus/menu', () => mockMenu());
vi.mock('@/core/config', () => ({
    uiState: { value: {} },
    cardContainer: vi.fn((container: HTMLElement, render: (c: HTMLElement) => void) => {
        container.innerHTML = '';
        render(container);
    }),
    applyHudVisibility: vi.fn(),
}));
vi.mock('@/scene/render/renderer', () => mockRenderer());

// 触发集中注册（import 副作用）
import '../menus/menu-schema-register';
import { collectAllSchemas, flattenNodes } from '../menus/menu-registry';

// state 字段名集合（从各 state 模块获取）
import { ENV_STATE_SCHEMA } from '../core/env-state-schema';
import { defaultRenderState } from '../scene/render/renderer';
import { DEFAULT_PERCEPTION_STATE } from '../scene/motion/perception-shared';

// i18n 基准语言包（多语言包校验，确保所有支持的语言都有对应 key）
import { zhCN } from '../core/i18n/locales/zh-CN';
import { en } from '../core/i18n/locales/en';
import { ja } from '../core/i18n/locales/ja';
import { ko } from '../core/i18n/locales/ko';
import { zhTW } from '../core/i18n/locales/zh-TW';
import { bundles } from '../core/i18n/t';

// 初始化 bundles，避免 t() 运行时警告
bundles['zh-CN'] = zhCN;
bundles['en'] = en;
bundles['ja'] = ja;
bundles['ko'] = ko;
bundles['zh-TW'] = zhTW;

// 各语言包的 key 集合
const ZH_CN_KEYS = new Set(Object.keys(zhCN));
const EN_KEYS = new Set(Object.keys(en));
const JA_KEYS = new Set(Object.keys(ja));
const KO_KEYS = new Set(Object.keys(ko));
const ZH_TW_KEYS = new Set(Object.keys(zhTW));

// 所有语言包的 key 集合
const I18N_ALL_PACKAGES = [
    { name: 'zh-CN', keys: ZH_CN_KEYS },
    { name: 'en', keys: EN_KEYS },
    { name: 'ja', keys: JA_KEYS },
    { name: 'ko', keys: KO_KEYS },
    { name: 'zh-TW', keys: ZH_TW_KEYS },
];

const ENV_KEYS = new Set(Object.keys(ENV_STATE_SCHEMA));
const RENDER_KEYS = new Set(Object.keys(defaultRenderState()));
const PERCEPTION_KEYS = new Set(Object.keys(DEFAULT_PERCEPTION_STATE));

// UI 状态字段（硬编码自 init.ts 赋值，保持与 UIState 类型同步）
const UI_KEYS = new Set([
    'autoUpdateEnabled',
    'keepAwake',
    'screenOrientation',
    'fpsLimit',
    'defaultPhysicsEnabled',
    'renderScale',
    'cameraSensitivity',
    'invertYAxis',
    'autoScaleModel',
    'autoCenterModel',
    'materialCategoryMap',
    'screenshotFormat',
    'screenshotQuality',
    'thumbnailResolution',
    'screenshotDir',
    'resourceViewMode',
    'volume',
    'audioOffset',
    'bpmQuantizeEnabled',
    'autoLoadCompanionAudio',
    'sfxEnabled',
    'sfxVolume',
    'footstepEnabled',
    'footstepVolume',
    'keyBindings',
    'showFpsClock',
    'showRuntimeBadge',
    'frameCapEnabled',
    'windowWidth',
    'windowHeight',
]);

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

// motionModule 参数映射（从各模块 DEFAULTS 提取，用于动态校验）
// 新增 motion 模块时需同步更新此表，否则 bind 路径将被判为无效
const MOTION_MODULE_PARAMS: Record<string, Set<string>> = {
    'body-posture': new Set(['tilt', 'bend', 'twist', 'bodyHeight', 'bodyDepth']),
    'left-hand': new Set([
        'pitch',
        'yaw',
        'roll',
        'handPosX',
        'handPosY',
        'handPosZ',
        'fingerPreset',
        'fingerIntensity',
    ]),
    'right-hand': new Set([
        'pitch',
        'yaw',
        'roll',
        'handPosX',
        'handPosY',
        'handPosZ',
        'fingerPreset',
        'fingerIntensity',
    ]),
    'left-foot': new Set(['pitch', 'yaw', 'roll', 'footPosX', 'footPosY', 'footPosZ']),
    'right-foot': new Set(['pitch', 'yaw', 'roll', 'footPosX', 'footPosY', 'footPosZ']),
    'riding-model': new Set(['preset', 'saddleHeight', 'pedalAngle', 'autoPedal', 'pedalSpeed']),
};

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
    const keySet = STATE_PREFIX_MAP[prefix];
    if (keySet) {
        const field = path.slice(dot + 1);
        return keySet.has(field);
    }
    // motionModule 动态路径: motionModule.<moduleId>.<paramKey>
    if (prefix === 'motionModule') {
        const rest = path.slice(dot + 1);
        const sep = rest.indexOf('.');
        if (sep < 0) {
            return false;
        } // 至少需要 moduleId.paramKey
        const moduleId = rest.slice(0, sep);
        const paramKey = rest.slice(sep + 1);
        const params = MOTION_MODULE_PARAMS[moduleId];
        if (!params) {
            return false;
        } // 未知模块 ID
        return params.has(paramKey);
    }
    return false; // 未知前缀
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
                hasCustomAccessor: !!(n.control?.get || n.control?.set),
            }))
        )('$id → bind "$bind" 指向有效 state 字段', ({ bind, hasCustomAccessor }) => {
            // 有自定义 get/set 的控件，bind 路径是逻辑标识，不要求映射到真实 state 字段
            if (hasCustomAccessor) {
                return;
            }
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
    // §3 i18n key 存在性（多语言包）
    // ═══════════════════════════════════════════════════════
    describe('i18n key 存在性（zh-CN/en/ja/ko）', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const nodesWithLabel = allNodes.filter((n) => n.label);

        // 收集所有需要校验的 label（去重）
        const allLabels = new Set<string>();
        nodesWithLabel.forEach((n) => {
            if (n.label && n.label.includes('.')) {
                allLabels.add(n.label);
            }
        });
        // modeSlider options 的 label 也需校验
        allNodes
            .filter((n) => n.kind === 'modeSlider' && n.control?.options)
            .forEach((n) => {
                n.control!.options!.forEach((opt) => {
                    if (opt.label && opt.label.includes('.')) {
                        allLabels.add(opt.label);
                    }
                });
            });

        for (const pkg of I18N_ALL_PACKAGES) {
            describe(`${pkg.name} 语言包`, () => {
                it.each(Array.from(allLabels))('key "$s" 存在于 ' + pkg.name, (key) => {
                    expect(pkg.keys.has(key)).toBe(true);
                });
            });
        }
    });

    // ═══════════════════════════════════════════════════════
    // §4 folder children 非空 (或 renderCustom)
    // ═══════════════════════════════════════════════════════
    describe('folder children 非空（或 renderCustom）', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const folders = allNodes.filter((n) => n.kind === 'folder');

        it.each(folders.map((n) => ({ id: n.id })))(
            '$id folder 有子节点或 renderCustom',
            ({ id }) => {
                const folder = allNodes.find((n) => n.id === id)!;
                // 检查是否有效：要么有非空 children，要么有 renderCustom，两者皆无为真空节点
                const hasChildren = !!(folder.children && folder.children.length > 0);
                const hasRenderCustom = !!folder.renderCustom;
                expect(hasChildren || hasRenderCustom).toBe(true);
            }
        );
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

    // ═══════════════════════════════════════════════════════
    // §6 headerToggle.bind 路径有效性
    // ═══════════════════════════════════════════════════════
    describe('headerToggle.bind 路径有效性', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const nodesWithHeaderToggle = allNodes.filter((n) => n.headerToggle?.bind);

        it.each(
            nodesWithHeaderToggle.map((n) => ({
                id: n.id,
                bind: n.headerToggle!.bind,
            }))
        )('$id → headerToggle.bind "$bind" 指向有效 state 字段', ({ bind }) => {
            expect(isValidStatePath(bind)).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §7 action 节点完整性
    // ═══════════════════════════════════════════════════════
    describe('action 节点完整性', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const actionNodes = allNodes.filter((n) => n.kind === 'action');

        if (actionNodes.length === 0) {
            it('已注册 schema 中暂无 action 节点', () => {
                expect(true).toBe(true);
            });
        } else {
            it.each(actionNodes.map((n) => ({ id: n.id })))(
                '$id action 节点有 action 回调或 confirm',
                ({ id }) => {
                    const node = allNodes.find((n) => n.id === id)!;
                    expect(node.action).toBeTruthy();
                }
            );
        }
    });

    // ═══════════════════════════════════════════════════════
    // §8 modeSlider option values 唯一
    // ═══════════════════════════════════════════════════════
    describe('modeSlider option values 唯一', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const modeSliders = allNodes.filter((n) => n.kind === 'modeSlider' && n.control?.options);

        it.each(
            modeSliders.map((n) => ({
                id: n.id,
                values: n.control!.options!.map((o) => o.value),
            }))
        )('$id modeSlider 的 option values 无重复', ({ values }) => {
            const seen = new Set<string>();
            const dupes: string[] = [];
            for (const v of values) {
                if (seen.has(v)) {
                    dupes.push(v);
                }
                seen.add(v);
            }
            expect(dupes).toEqual([]);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §9 slider 数据完整性（min <= max, step > 0）
    // ═══════════════════════════════════════════════════════
    describe('slider 数据完整性', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const sliders = allNodes.filter(
            (n) =>
                (n.kind === 'slider' || n.kind === 'modeSlider') &&
                n.control?.min !== undefined &&
                n.control?.max !== undefined
        );

        it.each(
            sliders.map((n) => ({
                id: n.id,
                min: n.control!.min!,
                max: n.control!.max!,
            }))
        )('$id slider min ($min) <= max ($max)', ({ min, max }) => {
            expect(min).toBeLessThanOrEqual(max);
        });

        const slidersWithStep = allNodes.filter((n) => n.control?.step !== undefined);
        it.each(
            slidersWithStep.map((n) => ({
                id: n.id,
                step: n.control!.step!,
            }))
        )('$id slider step ($step) > 0', ({ step }) => {
            expect(step).toBeGreaterThan(0);
        });
    });

    // ═══════════════════════════════════════════════════════
    // §10 非 custom/sectionTitle/divider 节点应有 label
    // ═══════════════════════════════════════════════════════
    describe('非 custom 节点 label 存在', () => {
        const allNodes = schemas.flatMap((s) => flattenNodes(s.nodes));
        const nodesNeedingLabel = allNodes.filter(
            (n) => !n.renderCustom && n.kind !== 'sectionTitle' && n.kind !== 'divider'
        );

        it.each(nodesNeedingLabel.map((n) => ({ id: n.id })))('$id 有 label', ({ id }) => {
            const node = allNodes.find((n) => n.id === id)!;
            expect(node.label).toBeDefined();
        });
    });
});
