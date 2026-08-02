/**
 * Schema Snapshot Generator
 *
 * 运行方式: npx vitest run src/__tests__/schema-snapshot.test.ts
 * 产出: frontend/e2e/schema-snapshot.json
 *
 * 用途: 将 menu-registry 中所有已注册的 schema 序列化为纯数据 JSON，
 *       供 schema 驱动的 E2E 测试（e2e/schema-driven.spec.ts）消费。
 *
 * 优势:
 * - 新面板只需在 menu-schema-register.ts 加一行 registerSchema，E2E 自动覆盖
 * - 消除手工维护纯数据副本的漂移风险
 * - 秒级运行（vitest，不开浏览器）
 *
 * 注意: 本文件 mock 需求较重（需完整状态数据），故保持内联定义。
 *       通用 mock 工厂见 menu-schema-mocks.ts。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// —— 通用默认值 ——
const DEFAULT_RENDER_STATE = {
    bloomEnabled: false,
    bloomWeight: 1,
    bloomThreshold: 0.7,
    bloomKernel: 'box',
    outlineEnabled: false,
    outlineColor: '#000000',
    fxaaEnabled: true,
    msaaSamples: 4,
    toneMapping: 'aces',
    exposure: 1,
    contrast: 1,
    dofEnabled: false,
    dofAperture: 0,
    dofFocusDistance: 1,
    dofFocalLength: 50,
    vignetteEnabled: false,
    vignetteDarkness: 0,
    chromaticAberrationEnabled: false,
    chromaticAberrationAmount: 0,
    grainEnabled: false,
    grainIntensity: 0,
    sharpenAmount: 0,
    glowEnabled: false,
    glowIntensity: 0,
    ssaoEnabled: false,
    ssaoStrength: 1,
    ssaoRadius: 1,
    ssaoSamples: 8,
    celShadingMode: 'none',
    celColorLevels: 4,
    celEdgeThreshold: 0.1,
    celEdgeStrength: 1,
};

const DEFAULT_PERCEPTION_STATE = {
    gazeEnabled: false,
    gazeIntensity: 1,
    gazeSpeed: 1,
    gazeHeadEnabled: false,
    gazeHeadIntensity: 1,
    gazeHeadSpeed: 1,
    gazeEyeEnabled: false,
    gazeEyeIntensity: 1,
    gazeEyeSpeed: 1,
    blinkEnabled: false,
    blinkRate: 30,
    blinkIntensity: 1,
    blinkSpeed: 1,
    breathEnabled: false,
    breathRate: 0.2,
    breathIntensity: 1,
    balanceEnabled: false,
    balanceIntensity: 1,
    centerEnabled: false,
    centerIntensity: 1,
    upperEnabled: false,
    upperIntensity: 1,
    waistEnabled: false,
    waistIntensity: 1,
    lipSyncEnabled: false,
    lipSyncMultiMorphEnabled: false,
};

// —— Mock 定义 ——
vi.mock('@/core/config', () => ({
    envState: { value: {} },
    uiState: { value: {} },
    cardContainer: vi.fn((container: HTMLElement, render: (c: HTMLElement) => void) => {
        container.innerHTML = '';
        render(container);
    }),
    applyHudVisibility: vi.fn(),
}));
vi.mock('@/scene/scene', () => ({
    setEnvState: vi.fn(),
    setRenderState: vi.fn(),
    getRenderState: vi.fn(() => DEFAULT_RENDER_STATE),
    defaultRenderState: vi.fn(() => DEFAULT_RENDER_STATE),
    transitionRenderState: vi.fn(),
    triggerAutoSave: vi.fn(),
    deserializeScene: vi.fn(),
    serializeScene: vi.fn(),
    popUndoSnapshot: vi.fn(),
    restoreUndoSnapshot: vi.fn(),
}));
vi.mock('@/core/async', () => ({
    swallowError: vi.fn(),
    fireAndForget: vi.fn(),
    delay: vi.fn(() => Promise.resolve()),
    waitForFrame: vi.fn(() => Promise.resolve()),
    makeLazyLoader: vi.fn(<T>(loader: T) => loader),
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
vi.mock('@/core/auto-save', () => ({
    triggerAutoSave: vi.fn(),
}));
vi.mock('@/scene/render/performance', () => ({
    setPerformanceMode: vi.fn(),
    getPerformanceMode: vi.fn(() => 'auto'),
    resetPerformanceSnapshot: vi.fn(),
}));
vi.mock('@/scene/render/renderer', () => ({
    getRenderState: vi.fn(() => DEFAULT_RENDER_STATE),
    setRenderState: vi.fn(),
    defaultRenderState: vi.fn(() => DEFAULT_RENDER_STATE),
    registerCelGroundCoupling: vi.fn(),
    initRenderer: vi.fn(),
    isRendererReady: vi.fn(() => true),
    disposeRenderer: vi.fn(),
    reattachPipeline: vi.fn(),
    isSSRActive: vi.fn(() => false),
    setSSRFromReflection: vi.fn(),
    rebuildOutlineState: vi.fn(),
    ToneMappingMode: {},
    pipeline: undefined,
}));
vi.mock('@/menus/scene-menu-state', () => ({
    getSceneMenu: vi.fn(() => null),
}));
vi.mock('@/menus/motion-popup', () => ({
    getMotionMenu: vi.fn(() => null),
}));
vi.mock('@/menus/settings-menu-state', () => ({
    getSettingsMenu: vi.fn(() => null),
}));
vi.mock('@/menus/menu', () => ({
    getCurrentRenderingMenu: vi.fn(() => null),
}));
vi.mock('@/scene/motion/perception', () => ({
    getPerceptionState: vi.fn(() => DEFAULT_PERCEPTION_STATE),
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
vi.mock('@/menus/preset-list-viewer', () => ({
    presetListContent: vi.fn(),
}));
vi.mock('@/menus/scene-render-presets', () => ({
    FILTER_PRESET_LABELS: {},
    getFilterPreset: vi.fn(),
}));
vi.mock('@/core/status-helpers', () => ({
    tryCatchStatus: vi.fn(async (fn: () => unknown) => fn()),
}));
vi.mock('@/scene/scene-bundle', () => ({
    exportSceneBundle: vi.fn(),
    importSceneBundle: vi.fn(),
}));
vi.mock('@/core/wails-bindings', () => ({
    GetPresetScenes: vi.fn(),
    GetPresetScenesDir: vi.fn(() => '/tmp/mock'),
    DeletePresetScene: vi.fn(),
    LoadSceneFile: vi.fn(),
    SaveScenePreset: vi.fn(),
}));

// 导入注册器
import '../menus/menu-schema-register';
import {
    collectAllSchemasWithFailures,
    flattenNodes,
    type PanelNav,
    type SchemaCollectFailure,
    type RegisteredSchema,
} from '../menus/menu-registry';
// [ADR-229 §9] DOM 契约单源：快照携带 kind → 选择器映射 + 结构选择器 meta，
// e2e 从快照读，不手写
import { KIND_CONTROL_SELECTOR, COLLAPSIBLE, TOGGLE_INPUT_SELECTOR } from '../core/dom-contract';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = resolve(__dirname, '../../e2e/schema-snapshot.json');

// ======== 导航元数据推导（ADR-229 §2.1）========
// 常规面板：domain = panelId 前缀，subLevelTestId = folder:<domain>:<slug>（零声明）；
// 特例面板：注册处显式 nav 覆写优先（跨域挂载 / settings 二级 folder）。

/** 入口按钮 testid：由 domain 映射表推导，不手写 */
const ENTRY_TESTID: Record<string, string> = {
    env: 'btnEnv',
    motion: 'btnMotionPopup',
    settings: 'btnSettings',
    scene: 'btnScene',
};

/** 从 panelId + 可选 nav 覆写推导完整导航元数据 */
function deriveNav(panelId: string, nav?: PanelNav): PanelNav {
    const [domainRaw, ...rest] = panelId.split(':');
    const domain: 'env' | 'motion' | 'settings' | 'scene' = nav?.domain ?? domainRaw as 'env' | 'motion' | 'settings' | 'scene';
    const slug = rest.join(':');
    // settings 域无一级子面板（走二级 folder），不推导 subLevelTestId
    const subLevelTestId =
        nav?.subLevelTestId ??
        (domain === 'settings' ? undefined : `folder:${domain}:${slug}`);
    const result: PanelNav = {
        domain,
        entryTestId: ENTRY_TESTID[domain],
        ...(subLevelTestId ? { subLevelTestId } : {}),
        ...(nav?.subLevel2TestId ? { subLevel2TestId: nav.subLevel2TestId } : {}),
        ...(nav?.subLevelLabel ? { subLevelLabel: nav.subLevelLabel } : {}),
    };
    return result;
}

/**
 * [ADR-229 §9] 结构性 DOM 契约（非 kind 级）：折叠头 class / 开关原生输入选择器。
 * 每个面板携带一份，e2e 的展开逻辑与 toggle 交互从快照读，不再手写字符串。
 */
const PANEL_DOM_META = {
    collapsibleHeader: COLLAPSIBLE.headerClass,
    collapsibleOpen: COLLAPSIBLE.openClass,
    toggleInput: TOGGLE_INPUT_SELECTOR,
} as const;

/** 清理节点为纯数据（去除函数/副作用），用于 JSON 序列化 */
function cleanNode(node: any): any {
    const action = deriveAction(node);
    const result: any = {
        id: node.id,
        kind: node.kind,
        // [ADR-229 §2.2] visibleWhen 条件节点：条件不满足时不渲染（renderNode 直接 return
        // undefined），E2E 断言须降级（存在则断言、缺失则跳过），故快照标记 conditional
        conditional: !!node.visibleWhen,
        // [ADR-229 §9] DOM 契约单源：写入 kind → 控件选择器，e2e 从快照读（不手写
        // KIND_SELECTOR_MAP）；契约变更时快照 diff 触发 CI 门禁
        ...(KIND_CONTROL_SELECTOR[node.kind]
            ? { dom: KIND_CONTROL_SELECTOR[node.kind] }
            : {}),
        // [ADR-229 §2.2] action 交互策略描述（非静态目标值——运行时初始值不可预知，
        // 目标由 spec 运行时计算；colorSlider 值域是 [r,g,b] 三元组，首轮跳过）
        ...(action ? { action } : {}),
    };
    if (node.label) {
        result.label = node.label;
    }
    if (node.icon) {
        result.icon = node.icon;
    }
    if (node.control) {
        result.control = {
            bind: node.control.bind,
            min: node.control.min,
            max: node.control.max,
            step: node.control.step,
            options: node.control.options?.map((o: any) => ({ value: o.value, label: o.label })),
            // [ADR-229 §2.2] get/set 值域变换标记：有变换时 state 存的是变换后值
            // （如 iblIntensity set: v*3 → state=1.5 而非显示 0.5；windDirection 角度↔向量），
            // e2e 无法从显示值精确断言 → 退化为「值发生变化」断言
            transformed: !!(node.control.get || node.control.set),
        };
    }
    if (node.headerToggle) {
        result.headerToggle = {
            bind: node.headerToggle.bind,
        };
    }
    if (node.children) {
        result.children = node.children.map(cleanNode);
    }
    return result;
}

/**
 * [ADR-229 §2.2] 生成交互 action 策略描述（运行时计算目标值）。
 * - slider → drag：spec 运行时取 (min+max)/2 对齐 step，与当前值相等则改用端点
 * - toggle → toggle：读初始 state → 点击 → 断言翻转
 * - modeSlider → selectChip：选第一个 ≠ 当前值的 option
 * - colorSlider 无 action（值域 [r,g,b] 三元组，DOM 为颜色条，拖拽模拟不稳定）
 */
function deriveAction(node: any): { type: string; target?: string } | undefined {
    switch (node.kind) {
        case 'slider':
            return { type: 'drag', target: 'midpoint' };
        case 'toggle':
            return { type: 'toggle' };
        case 'modeSlider':
            return { type: 'selectChip', target: 'non-current' };
        default:
            return undefined;
    }
}

describe('Schema Snapshot Generator', () => {
    let schemas: RegisteredSchema[];
    let failed: SchemaCollectFailure[];

    beforeAll(() => {
        ({ schemas, failed } = collectAllSchemasWithFailures());
    });

    // [ADR-229 审核修正] builder 抛错原本仅 DEV warn 后跳过：面板从快照消失，
    // 而 E2E 只遍历快照 → 覆盖静默缩水仍全绿。此处让失败直接红，不进 E2E。
    it('所有面板 builder 执行成功（无静默跳过）', () => {
        expect(failed).toEqual([]);
    });

    it(`生成 schema-snapshot.json (${SNAPSHOT_PATH})`, () => {
        const snapshot = schemas.map((s) => ({
            panelId: s.panelId,
            nav: deriveNav(s.panelId, s.nav),
            meta: PANEL_DOM_META,
            nodes: s.nodes.map(cleanNode),
        }));

        // [ADR-229 §2.1] nav 完整性断言：16 面板全部有可导航元数据，
        // 缺失（如新增面板忘了特例覆写）→ 立即失败，不静默进 E2E。
        for (const s of snapshot) {
            expect(s.nav.domain, `${s.panelId} nav.domain 缺失`).toBeDefined();
            expect(s.nav.entryTestId, `${s.panelId} nav.entryTestId 缺失`).toBeTruthy();
            if (s.nav.domain === 'settings') {
                expect(s.nav.subLevel2TestId, `${s.panelId} settings 域缺 subLevel2TestId`).toBeTruthy();
            } else {
                expect(s.nav.subLevelTestId, `${s.panelId} 缺 subLevelTestId`).toBeTruthy();
            }
            // [ADR-229 §9] 结构契约完整性：e2e 的展开/toggle 交互直接读 meta，缺失即失败
            expect(s.meta.collapsibleHeader, `${s.panelId} meta.collapsibleHeader 缺失`).toBeTruthy();
            expect(s.meta.toggleInput, `${s.panelId} meta.toggleInput 缺失`).toBeTruthy();
        }

        // [ADR-229 §9] DOM 契约完整性断言：所有 kind 在 KIND_CONTROL_SELECTOR 中的节点
        // 必须携带 dom 字段（缺失 → 渲染层改 role/class 后契约漂移未同步 → 立即失败）。
        const domKinds = Object.keys(KIND_CONTROL_SELECTOR);
        for (const s of snapshot) {
            const flat = flattenNodes(s.nodes);
            for (const n of flat) {
                if (domKinds.includes(n.kind)) {
                    expect(
                        n.dom,
                        `${s.panelId}/${n.id} kind=${n.kind} 缺 dom 字段（KIND_CONTROL_SELECTOR 未同步）`
                    ).toBe(KIND_CONTROL_SELECTOR[n.kind]);
                }
            }
        }

        // [ADR-229 §2.2] action 完整性断言：slider/toggle/modeSlider 必须有 action 策略
        // （缺失 → deriveAction 漏分支 → e2e 交互断言无法执行，立即失败）。
        const actionKinds = ['slider', 'toggle', 'modeSlider'];
        for (const s of snapshot) {
            const flat = flattenNodes(s.nodes);
            for (const n of flat) {
                if (actionKinds.includes(n.kind)) {
                    expect(
                        n.action,
                        `${s.panelId}/${n.id} kind=${n.kind} 缺 action 字段（deriveAction 未覆盖）`
                    ).toBeTruthy();
                }
            }
        }

        mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
        writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

        const read = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
        expect(Array.isArray(read)).toBe(true);
        expect(read.length).toBeGreaterThan(0);

        const totalNodes = read.reduce((acc: number, s: any) => acc + countNodes(s.nodes), 0);
        const totalBindPaths = read.reduce(
            (acc: number, s: any) => acc + countBindPaths(s.nodes),
            0
        );
        const totalLabels = read.reduce((acc: number, s: any) => acc + countLabels(s.nodes), 0);

        console.info('\n📊 Schema 快照统计:');
        console.info(`   面板: ${read.length}`);
        console.info(`   节点: ${totalNodes}`);
        console.info(`   bind 路径: ${totalBindPaths}`);
        console.info(`   i18n label: ${totalLabels}`);
        console.info(`   输出: ${SNAPSHOT_PATH}`);
    });
});

function countNodes(nodes: any[]): number {
    return nodes.reduce((acc: number, n: any) => {
        return acc + 1 + (n.children ? countNodes(n.children) : 0);
    }, 0);
}

function countBindPaths(nodes: any[]): number {
    return nodes.reduce((acc: number, n: any) => {
        let count = 0;
        if (n.control?.bind) {
            count++;
        }
        if (n.headerToggle?.bind) {
            count++;
        }
        if (n.children) {
            count += countBindPaths(n.children);
        }
        return acc + count;
    }, 0);
}

function countLabels(nodes: any[]): number {
    return nodes.reduce((acc: number, n: any) => {
        let count = 0;
        if (n.label && n.label.includes('.')) {
            count++;
        }
        if (n.control?.options) {
            count += n.control.options.filter((o: any) => o.label?.includes('.')).length;
        }
        if (n.children) {
            count += countLabels(n.children);
        }
        return acc + count;
    }, 0);
}
