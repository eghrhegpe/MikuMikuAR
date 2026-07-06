// [doc:architecture] InvertableArcRotateCameraPointersInput — 反 Y 轴指针输入
// 规范文档: docs/architecture.md §渲染环节 / ADR-035 P1「反 Y 轴」
// 职责: 继承 babylon-mmd 使用的 ArcRotateCameraPointersInput，统一反转垂直拖拽方向。
// Babylon 的 ArcRotateCamera 原生无 invertY flag，故在此覆写两个 Y 偏移入口：
//   - onTouch: 单指拖拽的旋转 + 平移
//   - _computeMultiTouchPanning: 双指平移（捏合缩放用平方距离，不受影响）
// 通过 invertY 标志切换，不破坏默认行为（默认 false）。

import { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput';
import type { PointerTouch } from '@babylonjs/core/Events/pointerEvents';

/** 可反转 Y 轴的 ArcRotate 相机指针输入。 */
export class InvertableArcRotateCameraPointersInput extends ArcRotateCameraPointersInput {
    /** 是否反转 Y 轴（垂直拖拽方向）。默认 false = 原生行为。 */
    public invertY = false;

    public override onTouch(point: PointerTouch | null, offsetX: number, offsetY: number): void {
        super.onTouch(point, offsetX, this.invertY ? -offsetY : offsetY);
    }

    protected override _computeMultiTouchPanning(
        previousMultiTouchPanPosition: PointerTouch | null,
        multiTouchPanPosition: PointerTouch | null
    ): void {
        if (this.invertY && previousMultiTouchPanPosition && multiTouchPanPosition) {
            super._computeMultiTouchPanning(
                { ...previousMultiTouchPanPosition, y: -previousMultiTouchPanPosition.y },
                { ...multiTouchPanPosition, y: -multiTouchPanPosition.y }
            );
            return;
        }
        super._computeMultiTouchPanning(previousMultiTouchPanPosition, multiTouchPanPosition);
    }
}
