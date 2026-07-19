// thumbnail-capture.ts — 模型/动作缩略图离屏渲染（RenderTargetTexture），pmx 与 motion 共用
//
// 架构说明：model-loader 已静态 import vmd-loader（加载动作），若 vmd-loader 再静态
// import model-loader 会形成循环依赖。故将 RT 渲染逻辑独立成本模块：
//   - model-loader 通过 captureThumbnail 复用 renderInstanceThumbnail（封装 pmx 特有 key 计算）
//   - vmd-loader 通过动态 import 调用 renderInstanceThumbnail（规避静态循环）
// 本模块内部仅动态 import '../scene' 取 Scene 实例，不反向引入 model-loader / vmd-loader。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { SaveThumbnail } from '@/core/wails-bindings';
import { thumbnailCache, setThumbnailCache, type ModelInstance } from '@/core/config';
import { uiState } from '@/core/state';
import { isStageLike } from '@/core/utils';
import { logWarn } from '@/core/logger';
import { type PropInstance, type RuntimeModel } from '@/core/types';
import { buildThumbnailKey } from './thumbnail-key';

// 缩略图渲染所需的最小实例形状：ModelInstance 与 PropInstance 均可适配。
// 仅消费三个字段：rootMesh（渲染根节点）、kind（宽高比判定）、mmdModel?（物理冻结，可选）。
// 用 TransformNode 而非 Mesh：道具的渲染根是其父级容器（TransformNode），
// 以便多网格道具的全部子网格入镜；模型 rootMesh 为 Mesh（TransformNode 子类）同样兼容。
export interface ThumbnailSource {
    rootMesh: TransformNode;
    kind: string;
    mmdModel?: RuntimeModel;
}

// ======== 并发互斥：promise 链确保同一时刻只有一个缩略图渲染 ========
// renderInstanceThumbnail 共享 RT + framebuffer + 物理冻结状态，
// 并发调用会导致 WebGL 状态冲突或截图内容错乱。
let _thumbMutex: Promise<unknown> = Promise.resolve();

/** base64 缩略图数据的 MIME 嗅探：PNG/JPEG/WebP 头部字节不同 */
export function thumbDataUrl(base64: string): string {
    if (base64.startsWith('iVBOR')) {
        return `data:image/png;base64,${base64}`;
    }
    if (base64.startsWith('/9j/')) {
        return `data:image/jpeg;base64,${base64}`;
    }
    if (base64.startsWith('UklGR')) {
        return `data:image/webp;base64,${base64}`;
    }
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
    // 串行化：排队等待上一个缩略图渲染完成，避免并发操作 RT/framebuffer/物理状态
    const prev = _thumbMutex;
    let release!: () => void;
    _thumbMutex = new Promise<void>((r) => {
        release = r;
    });
    await prev;
    try {
        await _renderThumbnailImpl(scene, inst, key);
    } finally {
        release();
    }
}

/**
 * 道具缩略图捕获（补闭环）：复用同一离屏 RT 渲染逻辑。
 * 道具 kind 视为 'prop' → isStageLike 命中 16:9，与 library-core 读侧 key 对齐。
 * 渲染根节点优先用 container（多网格父级容器），确保全部子网格入镜；单网格道具退化为 rootMesh。
 * 道具无 MMD 物理刚体，mmdModel 缺省 → 物理冻结分支自动跳过。
 */
export async function renderPropThumbnail(
    scene: Scene,
    prop: PropInstance,
    key: string
): Promise<void> {
    const prev = _thumbMutex;
    let release!: () => void;
    _thumbMutex = new Promise<void>((r) => {
        release = r;
    });
    await prev;
    try {
        const src: ThumbnailSource = {
            rootMesh: prop.container ?? prop.rootMesh,
            kind: 'prop',
        };
        await _renderThumbnailImpl(scene, src, key);
    } finally {
        release();
    }
}

async function _renderThumbnailImpl(
    scene: Scene,
    inst: ThumbnailSource,
    key: string
): Promise<void> {
    if (!inst || !inst.rootMesh) {
        return;
    }
    const engine = scene.getEngine();
    // 缩略图分辨率复用用户设置（默认 512，可选 1024/2048/4096）
    const thumbMax = uiState.thumbnailResolution ?? 512;
    // 角色竖屏 2:3，舞台横屏 16:9，thumbMax 为长边像素数
    const isStage = isStageLike(inst.kind);
    const THUMB_ASPECT = isStage ? 16 / 9 : 2 / 3;
    // 缓存 key 追加分辨率和比例，确保不同分辨率的缩略图被视为独立条目。
    // 格式：原 key::resolution::aspect（如 filePath::512::2/3）
    const cacheKey = buildThumbnailKey({ baseKey: key, isStage, resolution: thumbMax });

    const rtW = isStage ? thumbMax : Math.max(1, Math.round(thumbMax * THUMB_ASPECT));
    const rtH = isStage ? Math.max(1, Math.round(thumbMax / THUMB_ASPECT)) : thumbMax;

    const rt = new RenderTargetTexture('thumbRT', { width: rtW, height: rtH }, scene, false);
    rt.clearColor = new Color4(0, 0, 0, 0);

    // 缩略图相机 FOV 独立常量（0.8 = 中等广角，与主相机默认值一致但解耦）。
    // 不读 activeCamera.fov：避免「调 0.8 无效 → AI 跨界改主相机」死循环，
    // 也避免用户调主相机 FOV 时缩略图意外畸变。缩略图应稳定可预测。
    const THUMB_FOV = 0.8;

    const thumbCam = new FreeCamera('thumbCam', Vector3.Zero(), scene);
    thumbCam.minZ = 0.1;
    thumbCam.maxZ = 5000;
    thumbCam.fov = THUMB_FOV;

    // [fix:thumbnail-aspect] 手动构建投影矩阵并冻结，绕过引擎 aspect 计算。
    // 问题：RTT 渲染时，相机投影矩阵可能在 framebuffer 绑定前计算，导致 aspect 用主画布尺寸
    // 而非 RT 尺寸（主画布 16:9，RT 2:3）→ 水平视野过宽 → 角色被水平压扁。
    // 修复：用 RT 的 aspect (rtW/rtH) 手动构建 PerspectiveFovLH 投影矩阵并冻结，
    //       确保渲染时使用正确的宽高比。
    const projMatrix = new Matrix();
    Matrix.PerspectiveFovLHToRef(
        THUMB_FOV,
        rtW / rtH,
        thumbCam.minZ,
        thumbCam.maxZ,
        projMatrix,
        true // isVerticalFovFixed = true（fov 是垂直视野）
    );
    thumbCam.freezeProjectionMatrix(projMatrix);

    if (inst.kind === 'stage' && scene.activeCamera) {
        // 舞台：直接沿用主相机的 position + target。
        // 舞台场景常含天空盒/远景背景板（千米级 bb），按包围盒推算距离必然失效。
        // 场景在 (0,0,0) 加载，主相机聚焦设计已针对核心区域，缩略图直接复用即可。
        thumbCam.position.copyFrom(scene.activeCamera.position);
        // activeCamera 类型是 Camera 基类，getTarget 只在 TargetCamera 上。
        // 用 position + forward 方向 × 10 推算 target，兼容所有相机类型。
        const fwd = scene.activeCamera.getDirection(Vector3.Forward());
        thumbCam.setTarget(thumbCam.position.add(fwd.scale(10)));
    } else {
        // 角色（或无主相机的退化场景）：基于包围盒聚焦上半身，凸显服饰特征。
        const bb = inst.rootMesh.getHierarchyBoundingVectors(true);
        const fullHeight = bb.max.y - bb.min.y;
        const centerX = (bb.max.x + bb.min.x) * 0.5;
        const centerZ = (bb.max.z + bb.min.z) * 0.5;
        const extent = bb.max.subtract(bb.min);

        // 焦点：全身 60% 高度（胸部），能看到面部+上半身服饰
        const focusCenterY = bb.min.y + fullHeight * 0.55;
        const focusHeight = fullHeight * 0.65;
        const focusWidth = extent.x * 0.55;

        // 距离系数 0.75 与主相机 autoFrame（extent * 0.75 + 2）同源，行为可预测。
        const dist =
            (Math.max(focusHeight, focusWidth / THUMB_ASPECT) * 0.75) /
            (2 * Math.tan(THUMB_FOV / 2));

        // 相机朝向：复用主相机方向，或默认 -Z（MMD 正面）
        let dirX = 0,
            dirY = 0,
            dirZ = -1;
        if (scene.activeCamera) {
            const fwd = scene.activeCamera.getDirection(Vector3.Forward());
            dirX = fwd.x;
            dirY = fwd.y;
            dirZ = fwd.z;
        }
        // 沿朝向反方向放置相机（dir 是相机看向目标的方向，相机在 target - dir*dist）
        thumbCam.position.set(
            centerX - dirX * dist,
            focusCenterY - dirY * dist,
            centerZ - dirZ * dist
        );
        thumbCam.setTarget(new Vector3(centerX, focusCenterY, centerZ));
    }
    rt.activeCamera = thumbCam;

    const renderList: Mesh[] = [];
    inst.rootMesh.getChildMeshes().forEach((m) => {
        if (m.isVisible) {
            renderList.push(m as Mesh);
        }
    });
    if (inst.rootMesh instanceof Mesh && inst.rootMesh.isVisible) {
        renderList.push(inst.rootMesh);
    }
    rt.renderList = renderList;

    // 渲染前临时冻结物理：WASM Bullet 物理在 onBeforeRenderObservable 中推进，
    // 若在物理已更新帧截取缩略图，刚体位置变化导致骨骼跟随 → 裙子/头发等物理刚体
    // 处于「飞行中」姿态（ADR-XXX 缩略图物理干扰）。
    // 做法与 model-manager.ts:setPhysics 相同：保存 → 填 0（禁用）→ 渲染 → 恢复。
    const mmdModel = inst.mmdModel;
    const states = mmdModel?.rigidBodyStates;
    const savedStates = states ? new Uint8Array(states) : null;

    try {
        if (states) {
            states.fill(0);
        }

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
                flipped.set(
                    arr.subarray(y * rowBytes, y * rowBytes + rowBytes),
                    (rtH - 1 - y) * rowBytes
                );
            }
            imageData.data.set(flipped);
            ctx.putImageData(imageData, 0, 0);

            // 复用截图格式/质量设置（PNG 无损，JPEG/WebP 受 quality 控制）
            const fmt = uiState.screenshotFormat ?? 'image/png';
            const q = uiState.screenshotQuality ?? 0.9;
            const base64 = canvas.toDataURL(fmt, q).replace(/^data:image\/\w+;base64,/, '');

            try {
                await SaveThumbnail(cacheKey, base64);
                const updated = new Map(thumbnailCache);
                updated.set(cacheKey, base64);
                setThumbnailCache(updated);
            } catch (saveErr) {
                logWarn('thumbnail-capture', 'SaveThumbnail failed:', saveErr);
            }
        } finally {
            engine.unBindFramebuffer(rt.renderTarget!);
        }
    } finally {
        // 恢复物理状态
        if (states && savedStates) {
            states.set(savedStates);
        }
        rt.dispose();
        thumbCam.dispose();
    }
}

// 注意：动作（VMD）缩略图不再有专属封装函数——vmd-loader 在加载动作流程中
// 摆姿（currentAnimation.animate(0)）后直接调用 renderInstanceThumbnail(scene, inst, vmdKey)。
