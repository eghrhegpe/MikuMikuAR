// ar-camera.test.ts — AR 相机模块单测
// 覆盖：isARActive/getARFacing 状态、startARCamera 全分支（串行化/已激活/环境不支持/
// Android 授权/代数竞态/异常）、stopARCamera 资源释放、switchARCameraFacing 切换、
// setARMirror/isARMirrored 镜像、captureARScreenshot 合成截图。
// 依赖 mock：config(dom.canvas)、feedback、backend(getCachedCapabilities)、logger、
// image(canvasToBase64)、scene-action-bridge。Babylon 不涉及（纯 DOM/MediaStream 逻辑）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const shared = vi.hoisted(() => {
    const ctx = { drawImage: vi.fn() };
    const video = {
        id: '',
        autoplay: false,
        playsInline: false,
        muted: false,
        style: { transform: '', display: '' },
        srcObject: null,
        videoWidth: 1280,
        videoHeight: 720,
        setAttribute: vi.fn(),
        play: vi.fn(() => Promise.resolve()),
    };
    const canvas = {
        parentElement: { insertBefore: vi.fn() },
        width: 1920,
        height: 1080,
        getContext: vi.fn(() => ctx),
    };
    const feedbackInfo = vi.fn();
    const feedbackStatus = vi.fn();
    const getCachedCapabilities = vi.fn(() => ({ arScope: 'none' }));
    const logWarn = vi.fn();
    const canvasToBase64 = vi.fn(() => Promise.resolve('mock-base64'));
    const registerSceneAction = vi.fn();
    return {
        ctx,
        video,
        canvas,
        feedbackInfo,
        feedbackStatus,
        getCachedCapabilities,
        logWarn,
        canvasToBase64,
        registerSceneAction,
    };
});

vi.mock('@/core/config', () => ({
    dom: { canvas: shared.canvas },
}));
vi.mock('@/core/feedback', () => ({
    feedbackInfo: shared.feedbackInfo,
    feedbackStatus: shared.feedbackStatus,
}));
vi.mock('@/core/backend', () => ({
    getCachedCapabilities: shared.getCachedCapabilities,
}));
vi.mock('@/core/logger', () => ({
    logWarn: shared.logWarn,
}));
vi.mock('@/core/image', () => ({
    canvasToBase64: shared.canvasToBase64,
}));
vi.mock('@/core/scene-action-bridge', () => ({
    registerSceneAction: shared.registerSceneAction,
}));

import {
    isARActive,
    getARFacing,
    startARCamera,
    stopARCamera,
    switchARCameraFacing,
    setARMirror,
    isARMirrored,
    captureARScreenshot,
} from '../scene/ar/ar-camera';

const origCreateElement = document.createElement.bind(document);

function stubNavigator(getUserMedia: unknown): void {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
}

function makeStream(): MediaStream {
    return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

beforeEach(() => {
    vi.clearAllMocks();
    stopARCamera();
    shared.video.style.transform = '';
    shared.video.style.display = '';
    shared.video.srcObject = null;
    shared.video.videoWidth = 1280;
    shared.video.videoHeight = 720;
    shared.getCachedCapabilities.mockReturnValue({ arScope: 'none' });
    shared.canvasToBase64.mockResolvedValue('mock-base64');
    shared.ctx.drawImage.mockClear();
    // 拦截 createElement：video 返回共享假元素，canvas 返回带 2d context 的假画布
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'video') return shared.video as unknown as HTMLElement;
        if (tag === 'canvas') {
            return {
                width: 0,
                height: 0,
                getContext: vi.fn(() => shared.ctx),
            } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tag);
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('isARActive / getARFacing（初始状态）', () => {
    it('正常：初始未激活且 facing 为 user', () => {
        expect(isARActive()).toBe(false);
        expect(getARFacing()).toBe('user');
    });
});

describe('startARCamera（启动全分支）', () => {
    it('正常：成功启动前置摄像头并应用镜像', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        const ok = await startARCamera('user');
        expect(ok).toBe(true);
        expect(isARActive()).toBe(true);
        expect(getARFacing()).toBe('user');
        expect(shared.video.srcObject).toBeTruthy();
        expect(shared.video.play).toHaveBeenCalled();
        // 前置默认镜像
        expect(shared.video.style.transform).toBe('scaleX(-1)');
        expect(shared.feedbackInfo).toHaveBeenCalledWith('scene.ar.enabled', undefined);
    });

    it('正常：后置摄像头不镜像', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        const ok = await startARCamera('environment');
        expect(ok).toBe(true);
        expect(getARFacing()).toBe('environment');
        expect(shared.video.style.transform).toBe('none');
    });

    it('正常：已激活且同 facing 时直接返回 true', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        await startARCamera('user');
        const ok2 = await startARCamera('user');
        expect(ok2).toBe(true);
        expect(shared.video.play).toHaveBeenCalledTimes(1);
    });

    it('守卫：已有启动在途时直接返回当前状态（防并发双流）', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        const p1 = startARCamera('user');
        const p2 = startARCamera('user');
        expect(await p2).toBe(false); // _starting=true → 返回 _active(false)
        await p1;
        expect(isARActive()).toBe(true);
    });

    it('守卫：mediaDevices 不可用时返回 false 并提示', async () => {
        vi.stubGlobal('navigator', {});
        const ok = await startARCamera();
        expect(ok).toBe(false);
        expect(isARActive()).toBe(false);
        expect(shared.feedbackStatus).toHaveBeenCalledWith(
            'scene.ar.cameraUnavailable',
            undefined,
            false
        );
    });

    it('守卫：Android 未授权时返回 false 并提示', async () => {
        shared.getCachedCapabilities.mockReturnValue({ arScope: 'android-app' });
        stubNavigator(() => Promise.resolve(makeStream()));
        vi.stubGlobal('wails', {
            hasCameraPermission: () => false,
            requestCameraPermission: vi.fn(),
        });
        const p = startARCamera('user');
        window.__onArcCameraPermission?.(false);
        const ok = await p;
        expect(ok).toBe(false);
        expect(shared.feedbackStatus).toHaveBeenCalledWith('scene.ar.cameraDenied', undefined, false);
    });

    it('守卫：getUserMedia 抛错时返回 false 并复位状态', async () => {
        stubNavigator(() => Promise.reject(new Error('NotAllowedError')));
        const ok = await startARCamera();
        expect(ok).toBe(false);
        expect(isARActive()).toBe(false);
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('守卫：await 期间被 stopARCamera 作废（代数竞态）→ 丢弃流返回 false', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        const p = startARCamera('user');
        stopARCamera(); // bump 代数
        const ok = await p;
        expect(ok).toBe(false);
        expect(isARActive()).toBe(false);
    });
});

describe('stopARCamera（资源释放）', () => {
    it('正常：停止流、清空 srcObject、置为未激活', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        await startARCamera('user');
        stopARCamera();
        expect(isARActive()).toBe(false);
        expect(shared.video.srcObject).toBeNull();
        expect(shared.video.style.display).toBe('none');
    });

    it('边界：未启动时 stop 幂等不崩', () => {
        expect(() => stopARCamera()).not.toThrow();
    });
});

describe('switchARCameraFacing（前后切换）', () => {
    it('正常：user → environment 并提示', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        await startARCamera('user');
        const ok = await switchARCameraFacing();
        expect(ok).toBe(true);
        expect(getARFacing()).toBe('environment');
        expect(shared.feedbackInfo).toHaveBeenCalledWith('scene.ar.switchedEnv', undefined);
    });

    it('正常：environment → user 并提示', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        await startARCamera('environment');
        const ok = await switchARCameraFacing();
        expect(ok).toBe(true);
        expect(getARFacing()).toBe('user');
        expect(shared.feedbackInfo).toHaveBeenCalledWith('scene.ar.switchedUser', undefined);
    });
});

describe('setARMirror / isARMirrored（镜像控制）', () => {
    it('正常：手动设置镜像后 isARMirrored 反映状态', () => {
        setARMirror(true);
        expect(isARMirrored()).toBe(true);
        expect(shared.video.style.transform).toBe('scaleX(-1)');
        setARMirror(false);
        expect(isARMirrored()).toBe(false);
        expect(shared.video.style.transform).toBe('scaleX(1)');
    });
});

describe('captureARScreenshot（合成截图）', () => {
    it('边界：未激活时返回 fallback base64', async () => {
        const r = await captureARScreenshot();
        expect(r).toBe('mock-base64');
        expect(shared.ctx.drawImage).not.toHaveBeenCalled();
    });

    it('正常：激活后按宽视频裁剪并合成', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        await startARCamera('user');
        shared.video.videoWidth = 2000; // vRatio 2.78 > cRatio 1.78 → 宽裁剪
        shared.video.videoHeight = 720;
        const r = await captureARScreenshot('image/png', 0.9);
        expect(r).toBe('mock-base64');
        expect(shared.ctx.drawImage).toHaveBeenCalled();
    });

    it('正常：激活后按高视频裁剪并合成', async () => {
        stubNavigator(() => Promise.resolve(makeStream()));
        await startARCamera('user');
        shared.video.videoWidth = 1000; // vRatio 1.39 < cRatio 1.78 → 高裁剪
        shared.video.videoHeight = 720;
        const r = await captureARScreenshot();
        expect(r).toBe('mock-base64');
        expect(shared.ctx.drawImage).toHaveBeenCalled();
    });
});