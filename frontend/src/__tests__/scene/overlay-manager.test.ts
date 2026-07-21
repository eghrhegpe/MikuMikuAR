// [doc:adr-144] Overlay Manager 单元测试
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖
vi.mock('@/core/config', () => ({
    modelRegistry: new Map(),
    focusedModelId: null,
    triggerAutoSave: vi.fn(),
}));

vi.mock('@/core/utils', () => ({
    getBaseName: (path: string) => path.split('/').pop() || '',
    clamp01: (v: number) => Math.max(0, Math.min(1, v)),
}));

vi.mock('@/core/logger', () => ({
    logWarn: vi.fn(),
}));

vi.mock('@/core/wails-bindings', () => ({
    readFileBytes: vi.fn(),
}));

vi.mock('../../scene/motion/vmd-layers', () => ({
    addVmdLayer: vi.fn(),
    removeVmdLayer: vi.fn(),
    setVmdLayerWeight: vi.fn(),
    getVmdLayers: vi.fn(() => []),
}));

describe('overlay-manager (ADR-144)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ensureOverlayLayer 应该调用 addVmdLayer 并更新 motionSlots', async () => {
        const { modelRegistry } = await import('@/core/config');
        const { addVmdLayer } = await import('../../scene/motion/vmd-layers');
        const { readFileBytes } = await import('@/core/wails-bindings');

        // 设置 mock
        const mockLayer = {
            id: 'layer_12345678',
            name: 'Test Overlay',
            kind: 'vmd' as const,
            data: new ArrayBuffer(100),
            path: null,
            weight: 1,
            enabled: true,
            boneFilter: [],
        };
        vi.mocked(addVmdLayer).mockResolvedValue(mockLayer);
        vi.mocked(readFileBytes).mockResolvedValue(new Uint8Array(100));

        const mockInst = {
            id: 'model1',
            motionSlots: undefined,
            vmdLayers: [],
        };
        modelRegistry.set('model1', mockInst as any);

        const { ensureOverlayLayer } = await import('../../scene/motion/overlay-manager');
        const result = await ensureOverlayLayer('model1', '/test/overlay.vmd', 'Test Overlay', 0.8);

        expect(result).toBeTruthy();
        expect(addVmdLayer).toHaveBeenCalled();
        expect(mockInst.motionSlots?.overlay.overlayPath).toBe('/test/overlay.vmd');
        expect(mockInst.motionSlots?.overlay.overlayName).toBe('Test Overlay');
        expect(mockInst.motionSlots?.overlay.overlayWeight).toBe(0.8);
    });

    it('clearOverlayLayer 应该移除 overlay 层并重置 motionSlots', async () => {
        const { modelRegistry } = await import('@/core/config');
        const { removeVmdLayer, getVmdLayers } = await import('../../scene/motion/vmd-layers');

        const mockOverlayLayer = {
            id: 'ovl_12345678',
            name: 'Test Overlay',
            kind: 'vmd' as const,
            data: new ArrayBuffer(100),
            path: '/test/overlay.vmd',
            weight: 0.8,
            enabled: true,
            boneFilter: [],
        };
        vi.mocked(getVmdLayers).mockReturnValue([mockOverlayLayer as any]);

        const mockInst = {
            id: 'model1',
            motionSlots: {
                primary: { source: 'inherit', status: 'idle' },
                overlay: {
                    source: 'pinned',
                    status: 'idle',
                    overlayPath: '/test/overlay.vmd',
                    overlayName: 'Test Overlay',
                    overlayWeight: 0.8,
                },
            },
            vmdLayers: [mockOverlayLayer],
        };
        modelRegistry.set('model1', mockInst as any);

        const { clearOverlayLayer } = await import('../../scene/motion/overlay-manager');
        await clearOverlayLayer('model1');

        expect(removeVmdLayer).toHaveBeenCalledWith('ovl_12345678', 'model1');
        expect(mockInst.motionSlots.overlay.source).toBe('inherit');
        expect(mockInst.motionSlots.overlay.overlayPath).toBeUndefined();
    });

    it('setOverlayWeight 应该更新权重', async () => {
        const { modelRegistry } = await import('@/core/config');
        const { setVmdLayerWeight, getVmdLayers } = await import('../../scene/motion/vmd-layers');

        const mockOverlayLayer = {
            id: 'ovl_12345678',
            name: 'Test Overlay',
            kind: 'vmd' as const,
            data: new ArrayBuffer(100),
            path: '/test/overlay.vmd',
            weight: 0.8,
            enabled: true,
            boneFilter: [],
        };
        vi.mocked(getVmdLayers).mockReturnValue([mockOverlayLayer as any]);

        const mockInst = {
            id: 'model1',
            motionSlots: {
                primary: { source: 'inherit', status: 'idle' },
                overlay: {
                    source: 'pinned',
                    status: 'idle',
                    overlayPath: '/test/overlay.vmd',
                    overlayName: 'Test Overlay',
                    overlayWeight: 0.8,
                },
            },
            vmdLayers: [mockOverlayLayer],
        };
        modelRegistry.set('model1', mockInst as any);

        const { setOverlayWeight } = await import('../../scene/motion/overlay-manager');
        await setOverlayWeight('model1', 0.5);

        expect(setVmdLayerWeight).toHaveBeenCalledWith('ovl_12345678', 0.5, 'model1');
        expect(mockInst.motionSlots.overlay.overlayWeight).toBe(0.5);
    });

    it('getOverlayStatus 在无 overlay 时返回默认值', async () => {
        const { getVmdLayers } = await import('../../scene/motion/vmd-layers');
        vi.mocked(getVmdLayers).mockReturnValue([]);

        const { getOverlayStatus } = await import('../../scene/motion/overlay-manager');
        const status = getOverlayStatus('model1');

        expect(status.hasOverlay).toBe(false);
        expect(status.name).toBe('');
        expect(status.weight).toBe(1);
    });
});
