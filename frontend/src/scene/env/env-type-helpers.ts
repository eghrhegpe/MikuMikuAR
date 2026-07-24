// env-type-helpers.ts — 封装 Babylon.js 类型逃逸，集中管理私有 API 访问
// 每个 helper 对应一处 `as unknown as` 断言，消除散落在业务代码中的类型逃生。

import type { DynamicTexture } from '@babylonjs/core';

// ======== DynamicTexture.getContext() 返回 RenderingContext | null ========
// 实际使用时一定是 CanvasRenderingContext2D，封装一次断言。
export function getCanvasCtx(dt: DynamicTexture): CanvasRenderingContext2D | null {
    return dt.getContext() as unknown as CanvasRenderingContext2D | null;
}

// ======== RenderTargetTexture.REFRESHRATE_RENDER_ONCE (静态常量未导出) ========
// Babylon 内部定义该值为 Number.MAX_VALUE，但类型声明未包含。
export const REFRESHRATE_RENDER_ONCE = Number.MAX_VALUE;

// ======== FreeCamera 私有字段 _worldMatrix / _isWorldMatrixFrozen ========
// planar-reflection.ts 需要手动设置镜像相机矩阵。
export interface FrozenCamera {
    _worldMatrix: import('@babylonjs/core').Matrix;
    _isWorldMatrixFrozen: boolean;
}
