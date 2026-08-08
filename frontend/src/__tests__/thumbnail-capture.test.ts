// thumbnail-capture.test.ts — 覆盖 fix P2 两处变更行：
//   1) _renderThumbnailImpl 渲染收集：`m instanceof AbstractMesh && m.isVisible`（缩略图不再丢弃 InstancedMesh 子节点）
//   2) readPixels buffer 被 detach 时整体放弃本帧（置 detachFailed → logWarn + return），不再写黑条纹缓存
//
// 重度 Babylon 依赖，采用 vi.mock 桩隔离：所有 @babylonjs/core 几何/相机/RTT 用最小 mock class，
// 通过 vi.hoisted 共享类引用，使被测函数里的 `instanceof AbstractMesh` 对测试构造的子节点为真。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
    class AbstractMesh {
        isVisible = true;
        constructor() {}
    }
    class Mesh {
        isVisible = true;
        constructor() {}
    }
    class TransformNode {
        constructor() {}
    }
    class RenderTargetTexture {
        clearColor: unknown = null;
        activeCamera: unknown = null;
        renderList: unknown[] = [];
        renderTarget = {}; // 非 null，供 engine.bindFramebuffer(rt.renderTarget!) 使用
        render() {}
        dispose() {}
    }
    class FreeCamera {
        position: V3;
        minZ = 0;
        maxZ = 0;
        fov = 0;
        constructor(_name: string, position: V3) {
            this.position = position;
        }
        freezeProjectionMatrix() {}
        setTarget() {}
        dispose() {}
    }
    class V3 {
        constructor(
            public x = 0,
            public y = 0,
            public z = 0
        ) {}
        static Zero() {
            return new V3(0, 0, 0);
        }
        static Forward() {
            return new V3(0, 0, 1);
        }
        copyFrom(o: { x: number; y: number; z: number }) {
            this.x = o.x;
            this.y = o.y;
            this.z = o.z;
            return this;
        }
        add(o: V3) {
            return new V3(this.x + o.x, this.y + o.y, this.z + o.z);
        }
        scale(s: number) {
            return new V3(this.x * s, this.y * s, this.z * s);
        }
        subtract(o: V3) {
            return new V3(this.x - o.x, this.y - o.y, this.z - o.z);
        }
        set(x: number, y: number, z: number) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
    }
    class Matrix {
        static PerspectiveFovLHToRef() {}
    }
    class Color4 {
        constructor() {}
    }
    return { AbstractMesh, Mesh, TransformNode, RenderTargetTexture, FreeCamera, V3, Matrix, Color4 };
});

vi.mock('@babylonjs/core/Meshes/mesh', () => ({ Mesh: m.Mesh }));
vi.mock('@babylonjs/core/Meshes/abstractMesh', () => ({ AbstractMesh: m.AbstractMesh }));
vi.mock('@babylonjs/core/Meshes/transformNode', () => ({ TransformNode: m.TransformNode }));
vi.mock('@babylonjs/core/Materials/Textures/renderTargetTexture', () => ({
    RenderTargetTexture: m.RenderTargetTexture,
}));
vi.mock('@babylonjs/core/Cameras/freeCamera', () => ({ FreeCamera: m.FreeCamera }));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({ Vector3: m.V3, Matrix: m.Matrix }));
vi.mock('@babylonjs/core/Maths/math.color', () => ({ Color4: m.Color4 }));

vi.mock('@/core/wails-bindings', () => ({
    SaveThumbnail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/core/config', () => ({
    thumbnailCache: new Map<string, string>(),
    setThumbnailCache: vi.fn(),
}));
vi.mock('@/core/state', () => ({
    uiState: { thumbnailResolution: 512, screenshotFormat: 'image/png', screenshotQuality: 0.9 },
}));
vi.mock('@/core/path', () => ({
    isStageLike: vi.fn(() => false),
}));
vi.mock('@/core/image', () => ({
    canvasToBase64: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
}));
vi.mock('@/core/logger', () => ({
    logWarn: vi.fn(),
}));
vi.mock('../scene/manager/thumbnail-key', () => ({
    buildThumbnailKey: vi.fn(({ baseKey }: { baseKey: string }) => `${baseKey}::512::0.667`),
}));

import { renderInstanceThumbnail } from '../scene/manager/thumbnail-capture';
import { SaveThumbnail } from '@/core/wails-bindings';
import { logWarn } from '@/core/logger';

// 覆盖 happy-dom 下未实现的 canvas 2D 上下文（否则 ctx 为 null，被测函数提前 return）。
beforeEach(() => {
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({
        createImageData: (w: number, h: number) => ({
            data: new Uint8Array(w * h * 4),
            width: w,
            height: h,
        }),
        putImageData: vi.fn(),
    }));
    vi.mocked(SaveThumbnail).mockReset();
    vi.mocked(logWarn).mockReset();
});

// 缩略图分辨率 512、非舞台 → rtW=341, rtH=512，像素字节数固定，供 readPixels 返回同长度 buffer。
const RTW = Math.max(1, Math.round(512 * (2 / 3)));
const RTH = 512;
const PIXEL_BYTES = RTW * RTH * 4;

function makeScene() {
    const engine = {
        bindFramebuffer: vi.fn(),
        unBindFramebuffer: vi.fn(),
        readPixels: vi.fn(),
    };
    const scene = {
        getEngine: () => engine,
        activeCamera: { getDirection: () => ({ x: 0, y: 0, z: -1 }) },
    };
    return { engine, scene } as any;
}

function makeInst() {
    const rootMesh = {
        getChildMeshes: () => [new m.AbstractMesh(), new m.AbstractMesh()],
        getHierarchyBoundingVectors: () => ({
            max: new m.V3(2, 20, 1),
            min: new m.V3(-2, 0, -1),
        }),
    };
    return { rootMesh, kind: 'model' } as any;
}

describe('thumbnail-capture — fix P2 变更行覆盖', () => {
    it('正常渲染：AbstractMesh 子节点入镜列表 + 写入缓存（覆盖 171/172/219/232 行）', async () => {
        const { engine, scene } = makeScene();
        engine.readPixels.mockResolvedValue(new Uint8Array(PIXEL_BYTES));

        await renderInstanceThumbnail(scene, makeInst(), 'k1');

        // 子节点满足 instanceof AbstractMesh && isVisible → 进入 renderList，最终成功落盘
        expect(SaveThumbnail).toHaveBeenCalledWith('k1::512::0.667', expect.any(String));
        expect(logWarn).not.toHaveBeenCalled();
    });

    it('readPixels buffer detach：置 detachFailed 并整体放弃本帧（覆盖 228/229/232/233/234 行）', async () => {
        const { engine, scene } = makeScene();
        // subarray 返回 undefined → flipped.set 抛错进入 catch，模拟 WebGL 竞态 detach
        engine.readPixels.mockResolvedValue({ length: PIXEL_BYTES, subarray: () => undefined });

        await renderInstanceThumbnail(scene, makeInst(), 'k2');

        expect(logWarn).toHaveBeenCalledWith(
            'thumbnail-capture',
            'readPixels buffer detached，放弃本帧缩略图'
        );
        // 放弃本帧：绝不调用 SaveThumbnail 污染缓存
        expect(SaveThumbnail).not.toHaveBeenCalled();
    });
});
