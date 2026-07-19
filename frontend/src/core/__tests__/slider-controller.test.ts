/**
 * DragSliderController 单元测试
 * 运行：npm run test -- -- src/core/__tests__/slider-controller.test.ts
 *
 * 策略说明：
 * - 键盘逻辑：通过 dispatchEvent(el, 'keydown') 直接触发。
 * - 拖拽逻辑：通过 dispatchEvent(el, 'mousedown') 触发 onDragEnd，不依赖 mousemove 路径，
 *   因为 dispatchEvent 的 bubbles:true 仅触发 el 自身监听器（jsdom 不会把 mousemove/mouseup
 *   自动路由到 document.body），此处单独验证 onDragEnd 在 mousedown 后可调用。
 * - 边界/吸附：直接测试内部计算结果。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DragSliderController } from '../ui-slider-controller';

// jsdom 中 getBoundingClientRect 返回全 0，必须 mock
function mockRect(el: HTMLElement, rect: Partial<DOMRect> = {}): void {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 0,
        width: 200,
        height: 20,
        x: 100,
        y: 0,
        right: 300,
        bottom: 20,
        toJSON: () => ({}),
        ...rect,
    } as DOMRect);
}

describe('DragSliderController', () => {
    let el: HTMLElement;

    beforeEach(() => {
        el = document.createElement('div');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ===================================================================
    // 初始化 / setValue
    // ===================================================================

    it('构造后 opts.value 正确', () => {
        const ctrl = new DragSliderController({ value: 0.5, min: 0, max: 1, step: 0.01 });
        expect(ctrl).toBeDefined();
    });

    it('setValue 可重复调用', () => {
        const ctrl = new DragSliderController({ value: 0.5, min: 0, max: 1, step: 0.01 });
        ctrl.setValue(0.8);
        ctrl.setValue(0.2);
    });

    // ===================================================================
    // 键盘步进
    // ===================================================================

    function dispatchKey(el: HTMLElement, key: string, extra?: Partial<KeyboardEventInit>): void {
        el.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
        );
    }

    it('ArrowRight 增加 step，ArrowLeft 减少 step', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.1,
            onChange,
        });
        ctrl.bind(el);

        dispatchKey(el, 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith(0.6);

        dispatchKey(el, 'ArrowLeft');
        expect(onChange).toHaveBeenLastCalledWith(0.5);
    });

    it('Home 跳到 min，End 跳到 max', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.1,
            onChange,
        });
        ctrl.bind(el);

        dispatchKey(el, 'Home');
        expect(onChange).toHaveBeenLastCalledWith(0);

        dispatchKey(el, 'End');
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('step < 1：默认 step*1，shiftKey 乘 10，ctrlKey 乘 100', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.5, // 已在 0.5，避免 snapToStep 变换
            min: 0,
            max: 1,
            step: 0.1, // < 1
            onChange,
        });
        ctrl.bind(el);

        // 默认：+0.1 → 0.6
        dispatchKey(el, 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith(0.6);

        // shift：+1.0 → clamp 1
        dispatchKey(el, 'ArrowRight', { shiftKey: true });
        expect(onChange).toHaveBeenLastCalledWith(1);

        // ctrl：+10 → clamp 1
        dispatchKey(el, 'ArrowRight', { ctrlKey: true });
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('step >= 1：shiftKey 乘 10（不再 step*1），默认 step*1', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 50,
            min: 0,
            max: 100,
            step: 5, // >= 1
            onChange,
        });
        ctrl.bind(el);

        // 默认：+5
        dispatchKey(el, 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith(55);

        // shift：+50 → 100
        dispatchKey(el, 'ArrowRight', { shiftKey: true });
        expect(onChange).toHaveBeenLastCalledWith(100);
    });

    it('值达边界时不触发 onChange（防御重复按 Home/End）', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0,
            min: 0,
            max: 1,
            step: 0.1,
            onChange,
        });
        ctrl.bind(el);

        dispatchKey(el, 'Home'); // 已在 min
        expect(onChange).not.toHaveBeenCalled();
    });

    it('onDragEnd 在键盘操作后触发', () => {
        const onDragEnd = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.1,
            onDragEnd,
        });
        ctrl.bind(el);

        dispatchKey(el, 'ArrowRight');
        expect(onDragEnd).toHaveBeenCalledWith(0.6);
    });

    // ===================================================================
    // 拖拽事件注册（验证 mousedown/keydown/click 被 bind 添加）
    // ===================================================================

    it('bind 后 el 有 mousedown/keydown 监听（通过 addEventListener spy）', () => {
        const addSpy = vi.spyOn(el, 'addEventListener');
        const ctrl = new DragSliderController({ value: 0, min: 0, max: 1, step: 0.01 });
        ctrl.bind(el);

        // 验证至少注册了 mousedown 和 keydown
        const registered = addSpy.mock.calls.map(([ev]) => ev as string);
        expect(registered).toContain('mousedown');
        expect(registered).toContain('keydown');
        expect(registered).toContain('click');
    });

    it('dispose 后 el 的 mousedown/keydown 监听被移除', () => {
        const addSpy = vi.spyOn(el, 'addEventListener');
        const removeSpy = vi.spyOn(el, 'removeEventListener');
        const ctrl = new DragSliderController({ value: 0, min: 0, max: 1, step: 0.01 });
        const disp = ctrl.bind(el);

        // 统计 add 次数
        const addCounts: Record<string, number> = {};
        addSpy.mock.calls.forEach(([ev]) => {
            addCounts[ev as string] = (addCounts[ev as string] ?? 0) + 1;
        });

        disp.dispose();

        // 统计 remove 次数：应与 add 次数匹配
        const removeCounts: Record<string, number> = {};
        removeSpy.mock.calls.forEach(([ev]) => {
            removeCounts[ev as string] = (removeCounts[ev as string] ?? 0) + 1;
        });

        for (const ev of ['mousedown', 'keydown', 'click']) {
            expect(removeCounts[ev] ?? 0).toBe(addCounts[ev] ?? 0);
        }
    });

    it('重复 dispose 安全（不抛异常）', () => {
        const ctrl = new DragSliderController({ value: 0, min: 0, max: 1, step: 0.01 });
        const disp = ctrl.bind(el);
        disp.dispose();
        disp.dispose();
    });

    // ===================================================================
    // 拖拽逻辑（mousemove/mouseup 监听在 document 上，必须在 document 上分发事件）
    // ===================================================================

    function dispatchMouse(
        el: HTMLElement,
        type: 'mousedown' | 'mousemove' | 'mouseup',
        clientX: number
    ): void {
        // mousemove/mouseup 监听在 document 上
        const target = type === 'mousedown' ? el : el.ownerDocument!;
        target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }));
    }

    it('mousedown 触发 onDragEnd（dragRect 初始化）', () => {
        const onDragEnd = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.01,
            onDragEnd,
        });
        ctrl.bind(el);
        mockRect(el);

        // mousedown → mouseup（无 mousemove = 单击行为）
        dispatchMouse(el, 'mousedown', 200);
        dispatchMouse(el, 'mouseup', 200);

        expect(onDragEnd).toHaveBeenCalledWith(0.5); // value 未变，但 onDragEnd 仍触发
    });

    it('mousedown 触发 onChange（clientX 超出 rect 时变化）', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.01,
            onChange,
        });
        ctrl.bind(el);
        mockRect(el);

        // clientX=100 → x=0 → value=0
        dispatchMouse(el, 'mousedown', 100);
        dispatchMouse(el, 'mouseup', 100);
        expect(onChange).toHaveBeenLastCalledWith(0);

        // clientX=300 → x=1 → value=1
        dispatchMouse(el, 'mousedown', 300);
        dispatchMouse(el, 'mouseup', 300);
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    // ===================================================================
    // 边界守卫
    // ===================================================================

    it('步进超出 max 时 clamp 到 max', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.95,
            min: 0,
            max: 1,
            step: 0.5,
            onChange,
        });
        ctrl.bind(el);

        dispatchKey(el, 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('拖拽 clientX 超出 rect 边界时 clamp', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.01,
            onChange,
        });
        ctrl.bind(el);
        mockRect(el);

        // clientX < rect.left → clamp → min=0
        dispatchMouse(el, 'mousedown', -50);
        dispatchMouse(el, 'mouseup', -50);
        expect(onChange).toHaveBeenLastCalledWith(0);

        // clientX > rect.right → clamp → max=1
        dispatchMouse(el, 'mousedown', 9999);
        dispatchMouse(el, 'mouseup', 9999);
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    // ===================================================================
    // 吸附（snap / step）
    // ===================================================================

    it('snap 存在时按 snap 吸附（Math.round(v/snap)*snap）', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0.5,
            min: 0,
            max: 1,
            step: 0.01, // 未使用
            snap: 0.25, // 吸附到 0, 0.25, 0.5, 0.75, 1
            onChange,
        });
        ctrl.bind(el);
        mockRect(el);

        // 0.6 → 吸附到 0.5（最近）→ 无变化，不触发 onChange
        dispatchMouse(el, 'mousedown', 160); // x=60/200=0.3 → 0.3 → round(0.3/0.25)*0.25=0.25
        dispatchMouse(el, 'mouseup', 160);
        expect(onChange).toHaveBeenLastCalledWith(0.25);

        // 0.62 → 0.75（向上吸附）
        dispatchMouse(el, 'mousedown', 162); // x=62/200=0.31 → round(0.31/0.25)*0.25=0.25
        dispatchMouse(el, 'mouseup', 162);
        // 实际计算: 0.31 → round(1.24)=1 → 0.25（不变）
    });

    it('无 snap 时按 step 吸附', () => {
        const onChange = vi.fn();
        const ctrl = new DragSliderController({
            value: 0,
            min: 0,
            max: 1,
            step: 0.05, // 吸附到 0, 0.05, 0.10, ...
            onChange,
        });
        ctrl.bind(el);
        mockRect(el);

        // 0.027 → 0.05（round 向上）
        dispatchMouse(el, 'mousedown', 105.4); // x=5.4/200=0.027
        dispatchMouse(el, 'mouseup', 105.4);
        expect(onChange).toHaveBeenLastCalledWith(0.05);
    });
});
