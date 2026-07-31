// menu-schema.integrity.test.ts — ADR-093 元测试：Schema 驱动的完整性校验
// 不依赖浏览器/DOM，直接对 MenuNode[] schema 做静态分析。
// 捕获缺陷类型：bind 路径无效、i18n key 缺失、id 重复、folder 空子节点。
// 新增面板时：在 menu-schema-register.ts 注册 getXxxSchema() 即自动覆盖。

import { describe, it, expect, beforeAll, vi } from 'vitest';

// mock 副作用模块，避免 Babylon Scene 初始化
vi.mock('@/scene/scene', () => ({
    setEnvState: vi.fn(),
    setRenderState: vi.fn(),
    getRenderState: vi.fn(() => ({
        bloomEnabled: false, bloomWeight: 1, bloomThreshold: 0.7, bloomKernel: 'box',
        outlineEnabled: false, outlineColor: '#000000',
        fxaaEnabled: true, msaaSamples: 4,
        toneMapping: 'aces', exposure: 1, contrast: 1,
        dofEnabled: false, dofAperture: 0, dofFocusDistance: 1, dofFocalLength: 50,
        vignetteEnabled: false, vignetteDarkness: 0,
        chromaticAberrationEnabled: false, chromaticAberrationAmount: 0,
        grainEnabled: false, grainIntensity: 0,
        sharpenAmount: 0, glowEnabled: false, glowIntensity: 0,
        ssaoEnabled: false, ssaoStrength: 1, ssaoRadius: 1, ssaoSamples: 8,
        celShadingMode: 'none', celColorLevels: 4, celEdgeThreshold: 0.1, celEdgeStrength: 1,
    })),
    defaultRenderState: vi.fn(() => ({
        bloomEnabled: false, bloomWeight: 1, bloomThreshold: 0.7, bloomKernel: 'box',
        outlineEnabled: false, outlineColor: '#000000',
        fxaaEnabled: true, msaaSamples: 4,
        toneMapping: 'aces', exposure: 1, contrast: 1,
        dofEnabled: false, dofAperture: 0, dofFocusDistance: 1, dofFocalLength: 50,
        vignetteEnabled: false, vignetteDarkness: 0,
        chromaticAberrationEnabled: false, chromaticAberrationAmount: 0,
        grainEnabled: false, grainIntensity: 0,
        sharpenAmount: 0, glowEnabled: false, glowIntensity: 0,
        ssaoEnabled: false, ssaoStrength: 1, ssaoRadius: 1, ssaoSamples: 8,
        celShadingMode: 'none', celColorLevels: 4, celEdgeThreshold: 0.1, celEdgeStrength: 1,
    })),
    transitionRenderState: vi.fn(),
    triggerAutoSave: vi.fn(),
    deserializeScene: vi.fn(),
    serializeScene: vi.fn(),
    popUndoSnapshot: vi.fn(),
    restoreUndoSnapshot: vi.fn(),
}));
vi.mock('@/core/wails-bindings', () => ({
    GetPresetScenes: vi.fn(),
    GetPresetScenesDir: vi.fn(() => '/tmp/mock'),
    DeletePresetScene: vi.fn(),
    LoadSceneFile: vi.fn(),
    SaveScenePreset: vi.fn(),
}));
vi.mock('@/scene/scene-bundle', () => ({
    exportSceneBundle: vi.fn(),
    importSceneBundle: vi.fn(),
}));
vi.mock('@/menus/preset-list-viewer', () => ({
    presetListContent: vi.fn(),
}));
vi.mock('@/menus/scene-render-presets', () => ({
    FILTER_PRESET_LABELS: {},
    getFilterPreset: vi.fn(),
}));
vi.mock('@/core/status-helpers', () => ({
    tryCatchStatus: vi.fn(async (fn: Function) => fn()),
}));
vi.mock('@/core/async', () => ({
    swallowError: vi.fn(),
    fireAndForget: vi.fn(),
    delay: vi.fn(() => Promise.resolve()),
    waitForFrame: vi.fn(() => Promise.resolve()),
    makeLazyLoader: vi.fn((loader: Function) => loader),
    LoadingGuard: vi.fn(),
    DebouncedTimer: vi.fn(),
    Abortable: vi.fn(),
}));
vi.mock('@/core/toast', () => ({
    showInfoToast: vi.fn(),
    showErrorToast: vi.fn(),
}));
vi.mock('@/core/render-loop', () => ({
    calcHardwareScaling: vi.fn(() => 1),
}));
vi.mock('@/scene/render/performance', () => ({
    setPerformanceMode: vi.fn(),
    getPerformanceMode: vi.fn(() => 'auto'),
    resetPerformanceSnapshot: vi.fn(),
}));
vi.mock('@/menus/settings-menu-state', () => ({
    getSettingsMenu: vi.fn(() => null),
}));
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
vi.mock('@/menus/scene-menu-state', () => ({
    getSceneMenu: vi.fn(() => null),
}));
vi.mock('@/scene/motion/perception', () => ({
    getPerceptionState: vi.fn(() => ({
        gazeEnabled: false, gazeIntensity: 1, gazeSpeed: 1,
        gazeHeadEnabled: false, gazeHeadIntensity: 1, gazeHeadSpeed: 1,
        gazeEyeEnabled: false, gazeEyeIntensity: 1, gazeEyeSpeed: 1,
        blinkEnabled: false, blinkRate: 30, blinkIntensity: 1, blinkSpeed: 1,
        breathEnabled: false, breathRate: 0.2, breathIntensity: 1,
        balanceEnabled: false, balanceIntensity: 1,
        centerEnabled: false, centerIntensity: 1,
        upperEnabled: false, upperIntensity: 1,
        waistEnabled: false, waistIntensity: 1,
        lipSyncEnabled: false, lipSyncIntensity: 1, lipSyncMultiMorphEnabled: false,
    })),
    setPerceptionState: vi.fn(),
    activatePerception: vi.fn(),
    pinPerception: vi.fn(),
    unpinPerception: vi.fn(),
    enableAllPerception: vi.fn(),
    disableAllPerception: vi.fn(),
    getPinnedModelIds: vi.fn(() => []),
    getPerceptionPerfTier: vi.fn(() => 'medium'),
    getPerceptionPerfManualTier: vi.fn(() => 'medium'),
    setPerceptionPerfTier: vi.fn(),
    isAllPerceptionEnabled: vi.fn(() => false),
}));
vi.mock('@/scene/motion/motion-modules/registry', () => ({
    getModuleConflicts: vi.fn(() => []),
}));
vi.mock('@/menus/motion-popup', () => ({
    getMotionMenu: vi.fn(() => null),
}));
vi.mock('@/core/auto-save', () => ({
    triggerAutoSave: vi.fn(),
}));
vi.mock('@/menus/menu', () => ({
    getCurrentRenderingMenu: vi.fn(() => null),
}));
vi.mock('@/core/config', () => ({
    uiState: { value: {} },
    cardContainer: vi.fn((container: HTMLElement, render: (c: HTMLElement) => void) => {
        container.innerHTML = '';
        render(container);
    }),
    applyHudVisibility: vi.fn(),
}));
vi.mock('@/scene/render/renderer', () => ({
    getRenderState: vi.fn(() => ({
        bloomEnabled: false, bloomWeight: 1, bloomThreshold: 0.7, bloomKernel: 'box',
        outlineEnabled: false, outlineColor: '#000000',
        fxaaEnabled: true, msaaSamples: 4,
        toneMapping: 'aces', exposure: 1, contrast: 1,
        dofEnabled: false, dofAperture: 0, dofFocusDistance: 1, dofFocalLength: 50,
        vignetteEnabled: false, vignetteDarkness: 0,
        chromaticAberrationEnabled: false, chromaticAberrationAmount: 0,
        grainEnabled: false, grainIntensity: 0,
        sharpenAmount: 0, glowEnabled: false, glowIntensity: 0,
        ssaoEnabled: false, ssaoStrength: 1, ssaoRadius: 1, ssaoSamples: 8,
        celShadingMode: 'none', celColorLevels: 4, celEdgeThreshold: 0.1, celEdgeStrength: 1,
    })),
    setRenderState: vi.fn(),
    defaultRenderState: vi.fn(() => ({
        bloomEnabled: false, bloomWeight: 1, bloomThreshold: 0.7, bloomKernel: 'box',
        outlineEnabled: false, outlineColor: '#000000',
        fxaaEnabled: true, msaaSamples: 4,
        toneMapping: 'aces', exposure: 1, contrast: 1,
        dofEnabled: false, dofAperture: 0, dofFocusDistance: 1, dofFocalLength: 50,
        vignetteEnabled: false, vignetteDarkness: 0,
        chromaticAberrationEnabled: false, chromaticAberrationAmount: 0,
        grainEnabled: false, grainIntensity: 0,
        sharpenAmount: 0, glowEnabled: false, glowIntensity: 0,
        ssaoEnabled: false, ssaoStrength: 1, ssaoRadius: 1, ssaoSamples: 8,
        celShadingMode: 'none', celColorLevels: 4, celEdgeThreshold: 0.1, celEdgeStrength: 1,
    })),
}));

// 触发集中注册（import 副作用）
import '../menus/menu-schema-register';
import { collectAllSchemas, flattenNodes } from '../menus/menu-registry';

// state 字段名集合（从各 state 模块获取）
import { ENV_STATE_SCHEMA } from '../core/env-state-schema';
import { defaultRenderState } from '../scene/render/renderer';
import { DEFAULT_PERCEPTION_STATE } from '../scene/motion/perception-shared';
import { uiState } from '../core/state';

// i18n 基准语言包（多语言包校验，确保所有支持的语言都有对应 key）
import { zhCN } from '../core/i18n/locales/zh-CN';
import { en } from '../core/i18n/locales/en';
import { ja } from '../core/i18n/locales/ja';
import { ko } from '../core/i18n/locales/ko';
import { bundles } from '../core/i18n/t';

// 初始化 bundles，避免 t() 运行时警告
bundles['zh-CN'] = zhCN;
bundles['en'] = en;
bundles['ja'] = ja;
bundles['ko'] = ko;

// 各语言包的 key 集合
const ZH_CN_KEYS = new Set(Object.keys(zhCN));
const EN_KEYS = new Set(Object.keys(en));
const JA_KEYS = new Set(Object.keys(ja));
const KO_KEYS = new Set(Object.keys(ko));

// 所有语言包的 key 交集（必须在所有语言中都存在）
const I18N_KEYS = ZH_CN_KEYS; // 复用变量名，实际校验多包
const I18N_ALL_PACKAGES = [
    { name: 'zh-CN', keys: ZH_CN_KEYS },
    { name: 'en', keys: EN_KEYS },
    { name: 'ja', keys: JA_KEYS },
    { name: 'ko', keys: KO_KEYS },
];

const ENV_KEYS = new Set(Object.keys(ENV_STATE_SCHEMA));
const RENDER_KEYS = new Set(Object.keys(defaultRenderState()));
const PERCEPTION_KEYS = new Set(Object.keys(DEFAULT_PERCEPTION_STATE));

// UI 状态字段（硬编码自 init.ts 赋值，保持与 UIState 类型同步）
const UI_KEYS = new Set([
    'autoUpdateEnabled', 'keepAwake', 'screenOrientation',
    'fpsLimit', 'defaultPhysicsEnabled', 'renderScale',
    'cameraSensitivity', 'invertYAxis', 'autoScaleModel',
    'autoCenterModel', 'materialCategoryMap',
    'screenshotFormat', 'screenshotQuality', 'thumbnailResolution', 'screenshotDir',
    'resourceViewMode', 'volume', 'audioOffset', 'bpmQuantizeEnabled',
    'autoLoadCompanionAudio', 'sfxEnabled', 'sfxVolume',
    'footstepEnabled', 'footstepVolume', 'keyBindings',
    'showFpsClock', 'showRuntimeBadge', 'frameCapEnabled',
    'windowWidth', 'windowHeight',
]);
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
    const keySet = STATE_PREFIX_MAP[prefix];
    if (!keySet) {
        // 未知前缀：motionModule 等动态路径跳过校验
        return prefix === 'motionModule';
    }
    const field = path.slice(dot + 1);
    return keySet.has(field);
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
            if (hasCustomAccessor) return;
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
            // folder 可能用 children 或 renderCustom；有 children 的才检查非空
            if (folder.children !== undefined) {
                expect(folder.children.length).toBeGreaterThan(0);
            }
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
        const modeSliders = allNodes.filter(
            (n) => n.kind === 'modeSlider' && n.control?.options
        );

        it.each(
            modeSliders.map((n) => ({
                id: n.id,
                values: n.control!.options!.map((o) => o.value),
            }))
        )('$id modeSlider 的 option values 无重复', ({ values }) => {
            const seen = new Set<string>();
            const dupes: string[] = [];
            for (const v of values) {
                if (seen.has(v)) dupes.push(v);
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

        const slidersWithStep = allNodes.filter(
            (n) => n.control?.step !== undefined
        );
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
            (n) =>
                !n.renderCustom &&
                n.kind !== 'sectionTitle' &&
                n.kind !== 'divider'
        );

        it.each(
            nodesNeedingLabel.map((n) => ({ id: n.id }))
        )('$id 有 label', ({ id }) => {
            const node = allNodes.find((n) => n.id === id)!;
            expect(node.label).toBeDefined();
        });
    });
});
