// thumbnail-capture.ts — 模型/动作缩略图离屏渲染（RenderTargetTexture），pmx 与 motion 共用
//
// 架构说明：model-loader 已静态 import vmd-loader（加载动作），若 vmd-loader 再静态
// import model-loader 会形成循环依赖。故将 RT 渲染逻辑独立成本模块：
//   - model-loader 静态 import 本模块（captureThumbnail 复用）
//   - vmd-loader 通过动态 import 调用 captureMotionThumbnail（规避静态循环）
// 本模块内部仅动态 import '../scene' 取 Scene 实例，不反向引入 model-loader / vmd-loader。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { SaveThumbnail } from '@/core/wails-bindings';
import { thumbnailCache, setThumbnailCache, type ModelInstance } from '@/core/config';
import { logWarn } from '@/core/utils';

const THUMB_MAX = 512;

/**
 * 用离屏 RenderTargetTexture 渲染指定模型实例的「当前骨骼姿态」并保存为缩略图。
 *
 * 调用方负责先把场景/动画定位到目标帧（例如动作第 0 帧）再调用——本函数只截当前姿态，
 * 不推进动画时间轴。RT 渲染复用主相机视角（仅借用，不改主相机），无活动相机时兜底 3/4 角。
 */
export async function renderInstanceThumbnail(
    scene: Scene,
    inst: ModelInstance,
    key: string
): Promise<void> {
    if (!inst || !inst.rootMesh) {
        return;
    }
    const engine = scene.getEngine();
    const activeCam = scene.activeCamera;
    // RTT 尺寸跟随主相机宽高比，使投影宽高比与缓冲一致，否则 16:9 塞进正方缓冲会横向压缩。
    // 卡片用 object-fit:cover 再裁切，比例始终正确、绝不拉伸。
    const camAspect = activeCam ? engine.getAspectRatio(activeCam) : 1;
    let rtW = THUMB_MAX;
    let rtH = THUMB_MAX;
    if (camAspect >= 1) {
        rtH = Math.max(1, Math.round(THUMB_MAX / camAspect));
    } else {
        rtW = Math.max(1, Math.round(THUMB_MAX * camAspect));
    }

    const rt = new RenderTargetTexture('thumbRT', { width: rtW, height: rtH }, scene, false);
    rt.clearColor = new Color4(0, 0, 0, 0);

    // 沿用主相机视角（RT 渲染只借用相机，不会改动主相机）；
    // 仅当无活动相机时兜底用包围盒算一个 3/4 视角。
    let thumbCam: FreeCamera | null = null;
    if (activeCam) {
        rt.activeCamera = activeCam;
    } else {
        const bb = inst.rootMesh.getHierarchyBoundingVectors(true);
        const center = bb.max.add(bb.min).scale(0.5);
        const extent = bb.max.subtract(bb.min);
        const size = Math.max(extent.x, extent.y, extent.z);
        const dist = size * 0.8 + 2;
        thumbCam = new FreeCamera('thumbCam', Vector3.Zero(), scene);
        thumbCam.minZ = 0.1;
        thumbCam.maxZ = 5000;
        thumbCam.position.set(center.x - dist, center.y + dist * 0.5, center.z);
        thumbCam.setTarget(new Vector3(center.x, center.y, center.z));
        rt.activeCamera = thumbCam;
    }

    const renderList: Mesh[] = [];
    inst.rootMesh.getChildMeshes().forEach((m) => {
        if (m.isVisible) {
            renderList.push(m as Mesh);
        }
    });
    if (inst.rootMesh.isVisible) {
        renderList.push(inst.rootMesh);
    }
    rt.renderList = renderList;

    try {
        rt.render();

        // readPixels 读取的是「当前绑定的 framebuffer」。
        // rt.render() 结束会 unBindFramebuffer 回到默认 backbuffer，
        // 必须重新绑定 RTT 自身的 framebuffer 才能读到离屏渲染结果（否则截到的是主场景）。
        engine.bindFramebuffer(rt.renderTarget!);
        try {
            const pixels = await engine.readPixels(0, 0, rtW, rtH, true);
            const canvas = document.createElement('canvas');
            canvas.width = rtW;
            canvas.height = rtH;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }

            const imageData = ctx.createImageData(rtW, rtH);
            // readPixels 返回 Uint8Array（0–255 字节），已是最终像素值，直接拷贝即可。
            const arr = pixels as Uint8Array;
            // WebGL framebuffer 原点在左下角，readPixels 行序「底→顶」；
            // canvas putImageData 原点左上，需逐行上下翻转，否则缩略图上下颠倒（倒立）。
            const rowBytes = rtW * 4;
            const flipped = new Uint8Array(arr.length);
            for (let y = 0; y < rtH; y++) {
                flipped.set(arr.subarray(y * rowBytes, y * rowBytes + rowBytes), (rtH - 1 - y) * rowBytes);
            }
            imageData.data.set(flipped);
            ctx.putImageData(imageData, 0, 0);

            const base64 = canvas.toDataURL('image/png', 0.8).replace(/^data:image\/png;base64,/, '');

            try {
                await SaveThumbnail(key, base64);
                const updated = new Map(thumbnailCache);
                updated.set(key, base64);
                setThumbnailCache(updated);
            } catch (saveErr) {
                logWarn('thumbnail-capture', 'SaveThumbnail failed:', saveErr);
            }
        } finally {
            engine.unBindFramebuffer(rt.renderTarget!);
        }
    } finally {
        rt.dispose();
        thumbCam?.dispose();
    }
}

/**
 * 为动作（VMD）生成缩略图：截指定模型在动作初始帧（第 0 帧）的姿态。
 *
 * 本函数只负责离屏渲染 + 保存；调用方须先 `mmdRuntime.seekAnimation(0, true)` 把动画
 * 定位到第 0 帧并等待主循环把骨骼 world matrix 更新到该帧，再调用本函数。
 */
export async function captureMotionThumbnail(inst: ModelInstance, vmdKey: string): Promise<void> {
    try {
        const { getScene } = await import('../scene');
        const scene = getScene();
        if (!scene) {
            return;
        }
        await renderInstanceThumbnail(scene, inst, vmdKey);
    } catch (err) {
        logWarn('thumbnail-capture', 'captureMotionThumbnail:', err);
    }
}
