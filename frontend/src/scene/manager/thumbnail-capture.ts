// thumbnail-capture.ts — 模型/动作缩略图离屏渲染（RenderTargetTexture），pmx 与 motion 共用
//
// 架构说明：model-loader 已静态 import vmd-loader（加载动作），若 vmd-loader 再静态
// import model-loader 会形成循环依赖。故将 RT 渲染逻辑独立成本模块：
//   - model-loader 通过 captureThumbnail 复用 renderInstanceThumbnail（封装 pmx 特有 key 计算）
//   - vmd-loader 通过动态 import 调用 renderInstanceThumbnail（规避静态循环）
// 本模块内部仅动态 import '../scene' 取 Scene 实例，不反向引入 model-loader / vmd-loader。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { SaveThumbnail } from '@/core/wails-bindings';
import { thumbnailCache, setThumbnailCache, type ModelInstance } from '@/core/config';
import { uiState } from '@/core/state';
import { logWarn } from '@/core/utils';

/**
 * 计算舞台模型的地面级包围盒，排除天空盒/穹顶等远高于舞台的网格。
 *
 * 策略：收集所有可见子网格的包围盒，取 min.y 的中位数作为地面参考，
 * 排除 min.y 超出 地面参考 + 30 的网格（天空盒起始 y 通常 > 50）。
 * 退化：若无满足条件的网格，兜底到最低的网格或全层级包围盒。
 */
function computeStageGroundBoundingBox(root: Mesh): { min: Vector3; max: Vector3 } {
    const meshes = root.getChildMeshes(true) as Mesh[];
    const entries: { minY: number; bb: { min: Vector3; max: Vector3 } }[] = [];
    for (const m of meshes) {
        if (!m.isVisible) continue;
        const bb = m.getHierarchyBoundingVectors(true);
        if (!bb) continue;
        entries.push({ minY: bb.min.y, bb });
    }
    // 退化：无可见子网格 → 返回全层级包围盒
    if (entries.length === 0) {
        return root.getHierarchyBoundingVectors(true);
    }
    // 按 min.y 排序，取中位数作为地面参考
    entries.sort((a, b) => a.minY - b.minY);
    const groundRef = entries[Math.floor(entries.length * 0.5)].minY;
    // 排除 min.y 远高于地面参考的网格（天空盒等）
    const groundEntries = entries.filter(e => e.minY <= groundRef + 30);
    // 退化：全被排除 → 至少保留最低的网格
    if (groundEntries.length === 0) {
        return entries[0].bb;
    }
    // 合并保留网格的包围盒
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const { bb } of groundEntries) {
        if (bb.min.x < minX) minX = bb.min.x;
        if (bb.max.x > maxX) maxX = bb.max.x;
        if (bb.min.y < minY) minY = bb.min.y;
        if (bb.max.y > maxY) maxY = bb.max.y;
        if (bb.min.z < minZ) minZ = bb.min.z;
        if (bb.max.z > maxZ) maxZ = bb.max.z;
    }
    return { min: new Vector3(minX, minY, minZ), max: new Vector3(maxX, maxY, maxZ) };
}

/** base64 缩略图数据的 MIME 嗅探：PNG/JPEG/WebP 头部字节不同 */
export function thumbDataUrl(base64: string): string {
    if (base64.startsWith('iVBOR')) return `data:image/png;base64,${base64}`;
    if (base64.startsWith('/9j/')) return `data:image/jpeg;base64,${base64}`;
    if (base64.startsWith('UklGR')) return `data:image/webp;base64,${base64}`;
    // 兜底：默认 PNG
    return `data:image/png;base64,${base64}`;
}

/**
 * 用离屏 RenderTargetTexture 渲染指定模型实例的「当前骨骼姿态」并保存为缩略图。
 *
 * 调用方负责先把场景/动画定位到目标帧（例如动作第 0 帧）再调用——本函数只截当前姿态，
 * 不推进动画时间轴。始终创建独立缩略图相机，基于包围盒聚焦上半身（凸显服饰特征）。
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
    // 缩略图分辨率复用用户设置（默认 512，可选 1024/2048/4096）
    const thumbMax = uiState.thumbnailResolution ?? 512;
    // 固定竖屏宽高比 2:3（宽:高），不跟随主相机宽高比，保证竖屏/横屏截图画面一致。
    // 角色上半身（头+胸）天然高>宽，竖屏比例让角色更饱满，两侧不再空荡荡。
    const THUMB_ASPECT = 2 / 3;
    const rtW = Math.max(1, Math.round(thumbMax * THUMB_ASPECT));
    const rtH = thumbMax;

    const rt = new RenderTargetTexture('thumbRT', { width: rtW, height: rtH }, scene, false);
    rt.clearColor = new Color4(0, 0, 0, 0);

    // 始终创建独立缩略图相机，不复用主相机（主相机为全身远景，缩略图需拉近聚焦上半身）。
    // 方向：有主相机则复用其朝向（保证正面不背身），无主相机默认从 -Z 看（MMD 正面朝 -Z）。
    // 舞台模型排除天空盒等高远网格，避免包围盒中心偏移到空中。
    const bb = inst.kind === 'stage'
        ? computeStageGroundBoundingBox(inst.rootMesh as Mesh)
        : inst.rootMesh.getHierarchyBoundingVectors(true);
    const fullHeight = bb.max.y - bb.min.y;
    const centerX = (bb.max.x + bb.min.x) * 0.5;
    const centerZ = (bb.max.z + bb.min.z) * 0.5;
    const extent = bb.max.subtract(bb.min);

    // 根据模型类型选择聚焦策略
    let focusCenterY: number;
    let focusHeight: number;
    let focusWidth: number;
    if (inst.kind === 'stage') {
        // 舞台：以身入局视角——相机靠近舞台中央，固定距离拍摄。
        // 大舞台若按包围盒推算距离会导致相机过远（缩略图变成小点）。
        focusCenterY = bb.min.y + 2;  // 略高于地面，模拟站姿视点
        // focusHeight/focusWidth 仅用于非舞台的 targetSize 推算，舞台用固定距离，赋 0 防误用
        focusHeight = 0;
        focusWidth = 0;
    } else {
        // 角色：聚焦上半身（面部+服饰），凸显特征
        focusCenterY = bb.min.y + fullHeight * 0.6;
        focusHeight = fullHeight * 0.46;
        focusWidth = extent.x * 0.55;
    }

    const fov = scene.activeCamera ? scene.activeCamera.fov : 0.6;
    // 舞台使用固定距离近景（以身入局），非舞台沿用包围盒推算的全身/半身距离
    const dist = inst.kind === 'stage'
        ? 20
        : Math.max(focusHeight, focusWidth / THUMB_ASPECT) * 0.88 / (2 * Math.tan(fov / 2));

    // 相机朝向：复用主相机方向，或默认 -Z（MMD 正面）
    let dirX = 0, dirY = 0, dirZ = -1;
    if (scene.activeCamera) {
        const fwd = scene.activeCamera.getDirection(Vector3.Forward());
        dirX = fwd.x; dirY = fwd.y; dirZ = fwd.z;
    }

    const thumbCam = new FreeCamera('thumbCam', Vector3.Zero(), scene);
    thumbCam.minZ = 0.1;
    thumbCam.maxZ = 5000;
    thumbCam.fov = fov;
    // 沿朝向反方向放置相机（dir 是相机看向目标的方向，相机在 target - dir*dist）
    thumbCam.position.set(
        centerX - dirX * dist,
        focusCenterY - dirY * dist,
        centerZ - dirZ * dist
    );
    thumbCam.setTarget(new Vector3(centerX, focusCenterY, centerZ));
    rt.activeCamera = thumbCam;

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

            // 复用截图格式/质量设置（PNG 无损，JPEG/WebP 受 quality 控制）
            const fmt = uiState.screenshotFormat ?? 'image/png';
            const q = uiState.screenshotQuality ?? 0.9;
            const base64 = canvas.toDataURL(fmt, q).replace(/^data:image\/\w+;base64,/, '');

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
        thumbCam.dispose();
    }
}

// 注意：动作（VMD）缩略图不再有专属封装函数——vmd-loader 在加载动作流程中
// 摆姿（currentAnimation.animate(0)）后直接调用 renderInstanceThumbnail(scene, inst, vmdKey)。
