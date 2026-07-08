// [doc:architecture] Composition Guide Overlay — 构图辅助线系统
// 职责: 在 canvas 上叠加三分法/黄金分割/对角线网格
// 依赖: dom.canvas（获取画布尺寸），纯 CSS/SVG 实现

import { dom } from '../../core/config';

// ── 状态 ──
let _overlayEl: HTMLDivElement | null = null;
let _currentMode: 'off' | 'ruleOfThirds' | 'goldenRatio' | 'diagonal' = 'off';

/** 获取当前的辅助线模式。 */
export function getGuideMode(): string {
    return _currentMode;
}

/**
 * 设置构图辅助线模式。
 * @param mode 'off' | 'ruleOfThirds' | 'goldenRatio' | 'diagonal'
 */
export function setGuideMode(mode: 'off' | 'ruleOfThirds' | 'goldenRatio' | 'diagonal'): void {
    _currentMode = mode;
    _refresh();
}

/** 切换当前辅助线模式（off → ruleOfThirds → goldenRatio → diagonal → off） */
export function cycleGuideMode(): string {
    const modes: Array<'off' | 'ruleOfThirds' | 'goldenRatio' | 'diagonal'> = [
        'off', 'ruleOfThirds', 'goldenRatio', 'diagonal',
    ];
    const idx = modes.indexOf(_currentMode);
    const next = modes[(idx + 1) % modes.length];
    setGuideMode(next);
    return next;
}

/** 创建或重建辅助线叠加层。 */
function _refresh(): void {
    _dispose();

    if (_currentMode === 'off') return;

    _overlayEl = document.createElement('div');
    _overlayEl.id = 'composition-guide-overlay';
    _overlayEl.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'pointer-events:none;z-index:9998;' +
        'display:flex;align-items:center;justify-content:center;';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';

    const strokeColor = 'rgba(255,255,255,0.4)';
    const strokeWidth = '0.3';

    switch (_currentMode) {
        case 'ruleOfThirds':
            // 两条水平线（33%, 66%）
            _drawLine(svg, 0, 33.33, 100, 33.33, strokeColor, strokeWidth);
            _drawLine(svg, 0, 66.67, 100, 66.67, strokeColor, strokeWidth);
            // 两条垂直线（33%, 66%）
            _drawLine(svg, 33.33, 0, 33.33, 100, strokeColor, strokeWidth);
            _drawLine(svg, 66.67, 0, 66.67, 100, strokeColor, strokeWidth);
            break;

        case 'goldenRatio':
            // 黄金分割线（约 38.2% 和 61.8%）
            _drawLine(svg, 0, 38.2, 100, 38.2, strokeColor, strokeWidth);
            _drawLine(svg, 0, 61.8, 100, 61.8, strokeColor, strokeWidth);
            _drawLine(svg, 38.2, 0, 38.2, 100, strokeColor, strokeWidth);
            _drawLine(svg, 61.8, 0, 61.8, 100, strokeColor, strokeWidth);
            break;

        case 'diagonal': {
            // 两条对角线
            _drawLine(svg, 0, 0, 100, 100, strokeColor, strokeWidth);
            _drawLine(svg, 100, 0, 0, 100, strokeColor, strokeWidth);
            // 中心十字（辅助）
            const c = 'rgba(255,255,255,0.15)';
            _drawLine(svg, 50, 0, 50, 100, c, '0.15');
            _drawLine(svg, 0, 50, 100, 50, c, '0.15');
            break;
        }
    }

    _overlayEl.appendChild(svg);
    document.body.appendChild(_overlayEl);
}

/** 在 SVG 内画一条线。 */
function _drawLine(
    svg: SVGSVGElement,
    x1: number, y1: number, x2: number, y2: number,
    color: string, width: string
): void {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', width);
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);
}

/** 清理叠加层。 */
function _dispose(): void {
    if (_overlayEl && _overlayEl.parentNode) {
        _overlayEl.parentNode.removeChild(_overlayEl);
    }
    _overlayEl = null;
}

/** 全局销毁（页面卸载时调用）。 */
export function disposeGuides(): void {
    _currentMode = 'off';
    _dispose();
}
