// [doc:architecture] Composition Guide Overlay — 构图辅助线系统
// 职责: 在 canvas 上叠加三分法/黄金分割/对角线网格
// 依赖: dom.canvas（获取画布尺寸），纯 CSS/SVG 实现

// ── 状态 ──
let _overlayEl: HTMLDivElement | null = null;
let _currentMode: CompositionMode = 'off';

/** 构图辅助线模式。 */
export type CompositionMode = 'off' | 'ruleOfThirds' | 'goldenRatio' | 'diagonal';

/** 单条辅助线段（SVG 坐标 + 样式）。 */
export interface GuideLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** SVG stroke 颜色 */
    stroke: string;
    /** SVG stroke-width */
    strokeWidth: string;
}

/**
 * 计算某模式的辅助线段列表（纯函数，可独立测试）。
 * 线坐标/颜色/宽度是渲染与测试共享的唯一事实源。
 */
export function getGuideLines(mode: CompositionMode): GuideLine[] {
    if (mode === 'off') {
        return [];
    }
    const strokeColor = 'rgba(255,255,255,0.4)';
    const strokeWidth = '0.3';
    const lines: GuideLine[] = [];
    switch (mode) {
        case 'ruleOfThirds':
            // 两条水平线（33%, 66%）+ 两条垂直线（33%, 66%）
            lines.push(
                { x1: 0, y1: 33.33, x2: 100, y2: 33.33, stroke: strokeColor, strokeWidth },
                { x1: 0, y1: 66.67, x2: 100, y2: 66.67, stroke: strokeColor, strokeWidth },
                { x1: 33.33, y1: 0, x2: 33.33, y2: 100, stroke: strokeColor, strokeWidth },
                { x1: 66.67, y1: 0, x2: 66.67, y2: 100, stroke: strokeColor, strokeWidth }
            );
            break;
        case 'goldenRatio':
            // 黄金分割线（约 38.2% 和 61.8%）
            lines.push(
                { x1: 0, y1: 38.2, x2: 100, y2: 38.2, stroke: strokeColor, strokeWidth },
                { x1: 0, y1: 61.8, x2: 100, y2: 61.8, stroke: strokeColor, strokeWidth },
                { x1: 38.2, y1: 0, x2: 38.2, y2: 100, stroke: strokeColor, strokeWidth },
                { x1: 61.8, y1: 0, x2: 61.8, y2: 100, stroke: strokeColor, strokeWidth }
            );
            break;
        case 'diagonal': {
            // 两条对角线 + 中心十字（辅助，透明度更低）
            const helper = 'rgba(255,255,255,0.15)';
            lines.push(
                { x1: 0, y1: 0, x2: 100, y2: 100, stroke: strokeColor, strokeWidth },
                { x1: 100, y1: 0, x2: 0, y2: 100, stroke: strokeColor, strokeWidth },
                { x1: 50, y1: 0, x2: 50, y2: 100, stroke: helper, strokeWidth: '0.15' },
                { x1: 0, y1: 50, x2: 100, y2: 50, stroke: helper, strokeWidth: '0.15' }
            );
            break;
        }
    }
    return lines;
}

/** 获取当前的辅助线模式。 */
export function getGuideMode(): CompositionMode {
    return _currentMode;
}

/**
 * 设置构图辅助线模式。
 * @param mode 'off' | 'ruleOfThirds' | 'goldenRatio' | 'diagonal'
 */
export function setGuideMode(mode: CompositionMode): void {
    _currentMode = mode;
    _refresh();
}

/** 创建或重建辅助线叠加层。 */
function _refresh(): void {
    _dispose();

    if (_currentMode === 'off') {
        return;
    }

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

    for (const line of getGuideLines(_currentMode)) {
        _drawLine(svg, line.x1, line.y1, line.x2, line.y2, line.stroke, line.strokeWidth);
    }

    _overlayEl.appendChild(svg);
    document.body.appendChild(_overlayEl);
}

/** 在 SVG 内画一条线。 */
function _drawLine(
    svg: SVGSVGElement,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    width: string
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
