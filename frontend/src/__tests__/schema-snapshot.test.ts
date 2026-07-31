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
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock 所有可能的副作用依赖
// 这些 mock 与 menu-schema.integrity.test.ts 保持一致
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
vi.mock('@/core/auto-save', () => ({
    triggerAutoSave: vi.fn(),
}));
vi.mock('@/scene/render/performance', () => ({
    setPerformanceMode: vi.fn(),
    getPerformanceMode: vi.fn(() => 'auto'),
    resetPerformanceSnapshot: vi.fn(),
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
import { collectAllSchemas, flattenNodes } from '../menus/menu-registry';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = resolve(__dirname, '../../e2e/schema-snapshot.json');

/** 清理节点为纯数据（去除函数/副作用），用于 JSON 序列化 */
function cleanNode(node: any): any {
    const result: any = {
        id: node.id,
        kind: node.kind,
    };
    if (node.label) result.label = node.label;
    if (node.icon) result.icon = node.icon;
    if (node.control) {
        result.control = {
            bind: node.control.bind,
            min: node.control.min,
            max: node.control.max,
            step: node.control.step,
            options: node.control.options?.map((o: any) => ({ value: o.value, label: o.label })),
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
    // 不序列化 renderCustom / visibleWhen / action 等函数
    return result;
}

describe('Schema Snapshot Generator', () => {
    let schemas: ReturnType<typeof collectAllSchemas>;

    beforeAll(() => {
        schemas = collectAllSchemas();
    });

    it(`生成 schema-snapshot.json (${SNAPSHOT_PATH})`, () => {
        const snapshot = schemas.map(s => ({
            panelId: s.panelId,
            nodes: s.nodes.map(cleanNode),
        }));

        // 确保目录存在
        mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
        writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf-8');

        // 验证快照可被解析
        const read = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
        expect(Array.isArray(read)).toBe(true);
        expect(read.length).toBeGreaterThan(0);

        // 统计
        const totalNodes = read.reduce((acc: number, s: any) => acc + countNodes(s.nodes), 0);
        const totalBindPaths = read.reduce((acc: number, s: any) => acc + countBindPaths(s.nodes), 0);
        const totalLabels = read.reduce((acc: number, s: any) => acc + countLabels(s.nodes), 0);

        console.log(`\n📊 Schema 快照统计:`);
        console.log(`   面板: ${read.length}`);
        console.log(`   节点: ${totalNodes}`);
        console.log(`   bind 路径: ${totalBindPaths}`);
        console.log(`   i18n label: ${totalLabels}`);
        console.log(`   输出: ${SNAPSHOT_PATH}`);
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
        if (n.control?.bind) count++;
        if (n.headerToggle?.bind) count++;
        if (n.children) count += countBindPaths(n.children);
        return acc + count;
    }, 0);
}

function countLabels(nodes: any[]): number {
    return nodes.reduce((acc: number, n: any) => {
        let count = 0;
        if (n.label && n.label.includes('.')) count++;
        if (n.control?.options) count += n.control.options.filter((o: any) => o.label?.includes('.')).length;
        if (n.children) count += countLabels(n.children);
        return acc + count;
    }, 0);
}
