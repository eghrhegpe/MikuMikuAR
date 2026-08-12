// pose.test.ts — pose 三件套（camera-angle / composition-guide / watermark）纯逻辑与行为测试
// 目标：低洼区 scene/pose（覆盖率 4.4%）——纯函数直接断言，DOM/Babylon 副作用最小 mock。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── camera-angle 依赖隔离（vi.hoisted 共享状态，工厂只引用 hoisted 绑定）──
const shared = vi.hoisted(() => {
    class ArcRotateCamera {
        alpha = 0;
        beta = 0;
        radius = 0;
    }
    return {
        ArcRotateCamera,
        modelRegistry: { get: vi.fn() },
        focusedModelId: null,
        sceneObj: { activeCamera: null },
        setOrbitParams: vi.fn(),
    };
});

vi.mock('@/core/config', () => ({
    modelRegistry: shared.modelRegistry,
    get focusedModelId() {
        return shared.focusedModelId;
    },
}));
vi.mock('@/scene/scene', () => ({ scene: shared.sceneObj }));
vi.mock('@/scene/camera/camera', () => ({ setOrbitParams: shared.setOrbitParams }));
vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({
    ArcRotateCamera: shared.ArcRotateCamera,
}));
vi.mock('@/core/logger', () => ({ logWarn: vi.fn() }));

import {
    CAMERA_PRESETS,
    presetCameraAlpha,
    applyCameraPreset,
    getAllPresets,
} from '../scene/pose/camera-angle';
import { getGuideMode, setGuideMode, getGuideLines } from '../scene/pose/composition-guide';
import {
    getWatermarkConfig,
    setWatermarkConfig,
    applyWatermark,
    computeWatermarkPosition,
    DEFAULT_WATERMARK,
} from '../scene/pose/watermark';
import { logWarn } from '@/core/logger';

// ═══════════════════════════════════════════════════════
// camera-angle — 预设相机角（纯函数 + applyCameraPreset）
// ═══════════════════════════════════════════════════════
describe('pose/camera-angle', () => {
    beforeEach(() => {
        shared.focusedModelId = null;
        shared.sceneObj.activeCamera = null;
        shared.setOrbitParams.mockClear();
        shared.modelRegistry.get.mockReset();
    });

    it('预设表含 6 个角度，正面 azimuth=0', () => {
        expect(CAMERA_PRESETS).toHaveLength(6);
        const front = CAMERA_PRESETS.find((p) => p.name === '正面');
        expect(front?.azimuth).toBe(0);
    });

    it('presetCameraAlpha 基准：正面 + 无偏航 = -π/2', () => {
        expect(presetCameraAlpha(CAMERA_PRESETS[0], 0)).toBeCloseTo(-Math.PI / 2, 6);
    });

    it('presetCameraAlpha 随预设方位角旋转（左45° azimuth=-45 → alpha 减小 π/4）', () => {
        const left = CAMERA_PRESETS.find((p) => p.name === '左45°')!;
        expect(left.azimuth).toBe(-45);
        expect(presetCameraAlpha(left, 0)).toBeCloseTo(-Math.PI / 2 - Math.PI / 4, 6);
    });

    it('presetCameraAlpha 随模型偏航反向补偿（yaw 增大 → alpha 减小）', () => {
        expect(presetCameraAlpha(CAMERA_PRESETS[0], 0.5)).toBeCloseTo(
            presetCameraAlpha(CAMERA_PRESETS[0], 0) - 0.5,
            6
        );
    });

    it('presetCameraAlpha 随预设方位角旋转（右45° azimuth=45 → alpha 增大 π/4）', () => {
        const right = CAMERA_PRESETS.find((p) => p.name === '右45°')!;
        expect(right.azimuth).toBe(45);
        expect(presetCameraAlpha(right, 0)).toBeCloseTo(-Math.PI / 2 + Math.PI / 4, 6);
    });

    it('getAllPresets 返回副本，修改返回值不影响内部表', () => {
        const list = getAllPresets();
        list.length = 0;
        expect(getAllPresets()).toHaveLength(CAMERA_PRESETS.length);
    });

    it('applyCameraPreset 无聚焦模型时按 yaw=0 计算并设置 orbit', () => {
        const cam = new shared.ArcRotateCamera();
        shared.sceneObj.activeCamera = cam;
        applyCameraPreset(CAMERA_PRESETS[0]);
        expect(shared.setOrbitParams).toHaveBeenCalledWith({
            beta: Math.PI / 2 - (10 * Math.PI) / 180,
            distance: 22,
        });
        expect(cam.alpha).toBeCloseTo(-Math.PI / 2, 6);
    });

    it('applyCameraPreset 随聚焦模型偏航修正 alpha', () => {
        shared.focusedModelId = 'model-1';
        shared.modelRegistry.get.mockReturnValue({ rotationY: 0.2 });
        const cam = new shared.ArcRotateCamera();
        shared.sceneObj.activeCamera = cam;
        applyCameraPreset(CAMERA_PRESETS[0]);
        expect(cam.alpha).toBeCloseTo(-Math.PI / 2 - 0.2, 6);
    });

    it('applyCameraPreset 对非 ArcRotateCamera 相机静默跳过 alpha 赋值', () => {
        shared.sceneObj.activeCamera = { alpha: 1.0 };
        expect(() => applyCameraPreset(CAMERA_PRESETS[0])).not.toThrow();
        expect((shared.sceneObj.activeCamera as { alpha: number }).alpha).toBe(1.0);
    });

    it('applyCameraPreset 无 activeCamera 时不抛错，setOrbitParams 仍被调用', () => {
        shared.sceneObj.activeCamera = null;
        expect(() => applyCameraPreset(CAMERA_PRESETS[0])).not.toThrow();
        expect(shared.setOrbitParams).toHaveBeenCalledTimes(1);
    });

    it('applyCameraPreset 按 elevation 换算 beta（俯视 45° → π/4）', () => {
        const top = CAMERA_PRESETS.find((p) => p.name === '俯视')!;
        const cam = new shared.ArcRotateCamera();
        shared.sceneObj.activeCamera = cam;
        applyCameraPreset(top);
        expect(shared.setOrbitParams).toHaveBeenCalledWith({
            beta: Math.PI / 4,
            distance: 28,
        });
    });

    it('applyCameraPreset 使用预设 distance（特写 = 12）', () => {
        const closeUp = CAMERA_PRESETS.find((p) => p.name === '特写')!;
        shared.sceneObj.activeCamera = new shared.ArcRotateCamera();
        applyCameraPreset(closeUp);
        expect(shared.setOrbitParams).toHaveBeenCalledWith({
            beta: Math.PI / 2 - (5 * Math.PI) / 180,
            distance: 12,
        });
    });

    it('applyCameraPreset 聚焦模型不在 registry 时按 yaw=0 处理', () => {
        shared.focusedModelId = 'ghost';
        shared.modelRegistry.get.mockReturnValue(undefined);
        const cam = new shared.ArcRotateCamera();
        shared.sceneObj.activeCamera = cam;
        applyCameraPreset(CAMERA_PRESETS[0]);
        expect(cam.alpha).toBeCloseTo(-Math.PI / 2, 6);
    });

    it('getAllPresets 深拷贝，修改返回元素的属性不影响内部表', () => {
        const list = getAllPresets();
        list[0].azimuth = 999;
        list[0].distance = 1;
        const front = CAMERA_PRESETS.find((p) => p.name === '正面')!;
        expect(front.azimuth).toBe(0);
        expect(front.distance).toBe(22);
    });
});

// ═══════════════════════════════════════════════════════
// composition-guide — 构图辅助线（getGuideLines 纯逻辑 + overlay DOM）
// ═══════════════════════════════════════════════════════
describe('pose/composition-guide', () => {
    beforeEach(() => {
        setGuideMode('off');
        document.body.innerHTML = '';
    });

    it('初始模式为 off', () => {
        expect(getGuideMode()).toBe('off');
    });

    it('getGuideLines(off) 返回空数组', () => {
        expect(getGuideLines('off')).toEqual([]);
    });

    it('getGuideLines(ruleOfThirds) 返回 4 条 33.33/66.67 线', () => {
        const lines = getGuideLines('ruleOfThirds');
        expect(lines).toHaveLength(4);
        const ys = lines.filter((l) => l.y1 === l.y2).map((l) => l.y1);
        const xs = lines.filter((l) => l.x1 === l.x2).map((l) => l.x1);
        expect(ys.sort()).toEqual([33.33, 66.67]);
        expect(xs.sort()).toEqual([33.33, 66.67]);
    });

    it('getGuideLines(goldenRatio) 使用 38.2/61.8', () => {
        const lines = getGuideLines('goldenRatio');
        expect(lines).toHaveLength(4);
        const coords = lines.flatMap((l) => [l.x1, l.y1, l.x2, l.y2]);
        expect(coords).toContain(38.2);
        expect(coords).toContain(61.8);
    });

    it('getGuideLines(diagonal) 返回 4 条线，辅助线透明度更低', () => {
        const lines = getGuideLines('diagonal');
        expect(lines).toHaveLength(4);
        const main = lines.filter((l) => l.stroke === 'rgba(255,255,255,0.4)');
        const helper = lines.filter((l) => l.stroke === 'rgba(255,255,255,0.15)');
        expect(main).toHaveLength(2);
        expect(helper).toHaveLength(2);
    });

    it('setGuideMode(ruleOfThirds) 在 body 挂载 overlay 并画出 4 条线', () => {
        setGuideMode('ruleOfThirds');
        const overlay = document.getElementById('composition-guide-overlay');
        expect(overlay).toBeTruthy();
        expect(overlay?.querySelectorAll('line')).toHaveLength(4);
    });

    it('切换模式时旧 overlay 被移除、新 overlay 重建', () => {
        setGuideMode('ruleOfThirds');
        const first = document.getElementById('composition-guide-overlay');
        setGuideMode('diagonal');
        expect(document.getElementById('composition-guide-overlay')).not.toBe(first);
        expect(
            document.getElementById('composition-guide-overlay')?.querySelectorAll('line')
        ).toHaveLength(4);
    });

    it('setGuideMode(off) 移除 overlay', () => {
        setGuideMode('diagonal');
        expect(document.getElementById('composition-guide-overlay')).toBeTruthy();
        setGuideMode('off');
        expect(document.getElementById('composition-guide-overlay')).toBeNull();
    });

    it('setGuideMode(goldenRatio) 挂载 overlay 并画出 4 条线', () => {
        setGuideMode('goldenRatio');
        const overlay = document.getElementById('composition-guide-overlay');
        expect(overlay).toBeTruthy();
        expect(overlay?.querySelectorAll('line')).toHaveLength(4);
    });

    it('diagonal 辅助线 strokeWidth 为 0.15（主对角线为 0.3）', () => {
        const lines = getGuideLines('diagonal');
        const helperWidths = lines
            .filter((l) => l.stroke === 'rgba(255,255,255,0.15)')
            .map((l) => l.strokeWidth);
        const mainWidths = lines
            .filter((l) => l.stroke === 'rgba(255,255,255,0.4)')
            .map((l) => l.strokeWidth);
        expect(helperWidths).toEqual(['0.15', '0.15']);
        expect(mainWidths).toEqual(['0.3', '0.3']);
    });
});

// ═══════════════════════════════════════════════════════
// watermark — 水印配置 / 位置计算（纯）/ applyWatermark 分支
// ═══════════════════════════════════════════════════════
describe('pose/watermark', () => {
    beforeEach(() => {
        // 模块级 _config 无 reset API，测试间用全量 set 恢复默认（ADR-219 精神：不污染后续用例）
        setWatermarkConfig({ ...DEFAULT_WATERMARK });
    });

    it('getWatermarkConfig 返回默认值副本（修改不影响内部）', () => {
        const cfg = getWatermarkConfig();
        cfg.enabled = true;
        expect(getWatermarkConfig().enabled).toBe(false);
    });

    it('setWatermarkConfig 部分更新合并', () => {
        setWatermarkConfig({ text: '测试水印', opacity: 0.3 });
        const cfg = getWatermarkConfig();
        expect(cfg.text).toBe('测试水印');
        expect(cfg.opacity).toBe(0.3);
        expect(cfg.fontSize).toBe(DEFAULT_WATERMARK.fontSize);
    });

    it('computeWatermarkPosition(bottomRight) 右下对齐', () => {
        const pos = computeWatermarkPosition('bottomRight', 40, 100, 50, 12);
        expect(pos).toEqual({ x: 100 - 40 - 12, y: 50 - 12, textBaseline: 'bottom' });
    });

    it('computeWatermarkPosition(topLeft) 左上对齐', () => {
        const pos = computeWatermarkPosition('topLeft', 40, 100, 50, 12);
        expect(pos).toEqual({ x: 12, y: 12 + 12, textBaseline: 'top' });
    });

    it('computeWatermarkPosition(center) 居中', () => {
        const pos = computeWatermarkPosition('center', 40, 100, 50, 12);
        expect(pos).toEqual({ x: (100 - 40) / 2, y: 25 + 6, textBaseline: 'middle' });
    });

    it('computeWatermarkPosition(topRight/bottomLeft) 边界', () => {
        expect(computeWatermarkPosition('topRight', 40, 100, 50, 12)).toEqual({
            x: 100 - 40 - 12,
            y: 12 + 12,
            textBaseline: 'top',
        });
        expect(computeWatermarkPosition('bottomLeft', 40, 100, 50, 12)).toEqual({
            x: 12,
            y: 50 - 12,
            textBaseline: 'bottom',
        });
    });

    it('applyWatermark 未启用时原样返回（不触达 DOM）', async () => {
        setWatermarkConfig({ enabled: false });
        await expect(applyWatermark('abc123', 'image/png', 0.9)).resolves.toBe('abc123');
    });

    it('applyWatermark 启用时绘制文字并返回去前缀 base64', async () => {
        // stub 浏览器图片/canvas：Image 设 src 后同步 onload；canvas.toBlob 走 null → toDataURL 兜底
        class FakeImage {
            width = 100;
            height = 50;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_v: string) {
                this.onload?.();
            }
        }
        const fakeCtx = {
            save: vi.fn(),
            restore: vi.fn(),
            drawImage: vi.fn(),
            fillText: vi.fn(),
            measureText: vi.fn(() => ({ width: 40 })),
            globalAlpha: 1,
            font: '',
            fillStyle: '',
            textBaseline: 'bottom',
            shadowColor: '',
            shadowBlur: 0,
            shadowOffsetX: 0,
            shadowOffsetY: 0,
        };
        const fakeCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => fakeCtx),
            toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(null)),
            toDataURL: vi.fn(() => 'data:image/png;base64,watermarked'),
        };

        const origImage = globalThis.Image;
        const origCreateElement = document.createElement.bind(document);
        (globalThis as Record<string, unknown>).Image = FakeImage;
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
            tag === 'canvas' ? (fakeCanvas as unknown as HTMLCanvasElement) : origCreateElement(tag)
        );

        try {
            setWatermarkConfig({ enabled: true, text: 'WM' });
            const result = await applyWatermark('abc123', 'image/png', 0.9);
            expect(result).toBe('watermarked');
            expect(fakeCtx.fillText).toHaveBeenCalledWith(
                'WM',
                expect.any(Number),
                expect.any(Number)
            );
            expect(fakeCtx.measureText).toHaveBeenCalledWith('WM');
        } finally {
            (globalThis as Record<string, unknown>).Image = origImage;
            vi.restoreAllMocks();
        }
    });

    it('applyWatermark canvas.getContext 返回 null 时走 logWarn 并原样返回', async () => {
        class FakeImage {
            width = 100;
            height = 50;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_v: string) {
                this.onload?.();
            }
        }
        const fakeCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => null),
            toBlob: vi.fn(),
            toDataURL: vi.fn(),
        };
        const origImage = globalThis.Image;
        const origCreateElement = document.createElement.bind(document);
        (vi.mocked(logWarn) as ReturnType<typeof vi.fn>).mockClear();
        (globalThis as Record<string, unknown>).Image = FakeImage;
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
            tag === 'canvas' ? (fakeCanvas as unknown as HTMLCanvasElement) : origCreateElement(tag)
        );

        try {
            setWatermarkConfig({ enabled: true });
            await expect(applyWatermark('abc123', 'image/png', 0.9)).resolves.toBe('abc123');
            expect(logWarn).toHaveBeenCalled();
        } finally {
            (globalThis as Record<string, unknown>).Image = origImage;
            vi.restoreAllMocks();
        }
    });

    it('computeWatermarkPosition 文字比图宽时 x 收敛到 margin（不画到画布外）', () => {
        // textWidth=200 > imgWidth=100：右对齐/居中若按原公式会得到负 x，文字被裁剪
        expect(computeWatermarkPosition('bottomRight', 200, 100, 50, 12).x).toBe(12);
        expect(computeWatermarkPosition('topRight', 200, 100, 50, 12).x).toBe(12);
        expect(computeWatermarkPosition('center', 200, 100, 50, 12).x).toBe(12);
    });

    it('applyWatermark toBlob 成功返回 blob 时走 FileReader 路径', async () => {
        class FakeImage {
            width = 100;
            height = 50;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_v: string) {
                this.onload?.();
            }
        }
        class FakeFileReader {
            result: string | null = 'data:image/png;base64,fromblob';
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            readAsDataURL() {
                this.onload?.();
            }
        }
        const fakeCtx = {
            save: vi.fn(),
            restore: vi.fn(),
            drawImage: vi.fn(),
            fillText: vi.fn(),
            measureText: vi.fn(() => ({ width: 40 })),
            globalAlpha: 1,
            font: '',
            fillStyle: '',
            textBaseline: 'bottom',
            shadowColor: '',
            shadowBlur: 0,
            shadowOffsetX: 0,
            shadowOffsetY: 0,
        };
        const fakeCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => fakeCtx),
            toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x']))),
            toDataURL: vi.fn(),
        };
        const origImage = globalThis.Image;
        const origFileReader = globalThis.FileReader;
        const origCreateElement = document.createElement.bind(document);
        (globalThis as Record<string, unknown>).Image = FakeImage;
        (globalThis as Record<string, unknown>).FileReader = FakeFileReader;
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
            tag === 'canvas' ? (fakeCanvas as unknown as HTMLCanvasElement) : origCreateElement(tag)
        );

        try {
            setWatermarkConfig({ enabled: true, text: 'WM' });
            await expect(applyWatermark('abc123', 'image/png', 0.9)).resolves.toBe('fromblob');
        } finally {
            (globalThis as Record<string, unknown>).Image = origImage;
            (globalThis as Record<string, unknown>).FileReader = origFileReader;
            vi.restoreAllMocks();
        }
    });

    it('applyWatermark 图片加载失败 → reject', async () => {
        class FailImage {
            width = 100;
            height = 50;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_v: string) {
                this.onerror?.();
            }
        }
        const origImage = globalThis.Image;
        (globalThis as Record<string, unknown>).Image = FailImage;
        try {
            setWatermarkConfig({ enabled: true });
            await expect(applyWatermark('abc123', 'image/png', 0.9)).rejects.toThrow(
                'Failed to load image for watermark'
            );
        } finally {
            (globalThis as Record<string, unknown>).Image = origImage;
            vi.restoreAllMocks();
        }
    });

    it('applyWatermark 图片加载超时 → reject 超时错误', async () => {
        vi.useFakeTimers();
        class HangingImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_v: string) {
                /* 永不触发加载回调 */
            }
        }
        const origImage = globalThis.Image;
        (globalThis as Record<string, unknown>).Image = HangingImage;
        try {
            setWatermarkConfig({ enabled: true });
            const pending = applyWatermark('abc123', 'image/png', 0.9);
            const assertion = expect(pending).rejects.toThrow('Watermark image load timeout');
            vi.advanceTimersByTime(10001);
            await assertion;
        } finally {
            (globalThis as Record<string, unknown>).Image = origImage;
            vi.useRealTimers();
        }
    });
});
