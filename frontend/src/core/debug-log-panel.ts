// 轻量日志调试面板（git commit ce02492d）— 避免 console source map 卡顿
// 通过 DOM 面板显示日志缓冲区内容，支持过滤和实时更新。
// 注意：日志面板决策无正式 ADR，勿引用 ADR-248（该编号已被其他决策占用，audit:round18）。

import { getLogBuffer, getConsoleOutput, clearLogs, setConsoleOutput, type LogEntry } from './logger';
import { escapeHtml } from './escape-html';

let _panel: HTMLElement | null = null;
let _unsubscribe: (() => void) | null = null;
let _filterTag = '';
let _minLevel: LogEntry['level'] = 'info';

const LEVEL_COLORS: Record<LogEntry['level'], string> = {
    info: '#4FC3F7',
    warn: '#FFB74D',
    error: '#EF5350',
};

const LEVEL_ORDER: Record<LogEntry['level'], number> = {
    info: 0,
    warn: 1,
    error: 2,
};

function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** [audit:round18 P2] 同步 Console 按钮文案/背景到实际 console 输出状态。
 * 每次 showLogPanel（含面板已存在复用）都调用，避免初始文案与实际状态不同步。 */
function syncConsoleButton(): void {
    const btn = _panel?.querySelector<HTMLElement>('[data-role="console"]');
    if (!btn) return;
    const on = getConsoleOutput();
    btn.textContent = `Console: ${on ? 'ON' : 'OFF'}`;
    btn.style.background = on ? '#27ae60' : '#2980b9';
}

function renderPanel(): void {
    if (!_panel) return;
    const entries = getLogBuffer().getAll().filter((e) => {
        if (LEVEL_ORDER[e.level] < LEVEL_ORDER[_minLevel]) return false;
        if (_filterTag && !e.tag.toLowerCase().includes(_filterTag.toLowerCase())) return false;
        return true;
    });

    const listEl = _panel.querySelector('[data-role="log-list"]');
    if (!listEl) return;

    // 检查用户是否在底部（允许 50px 误差）
    const isNearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 50;

    const html = entries.map((e) => {
        const color = LEVEL_COLORS[e.level];
        const time = formatTime(e.time);
        // [audit:round18 P2] message 可能含用户可控文本（文件名/错误信息），
        // innerHTML 拼入前必须转义，防注入。
        const safeMsg = escapeHtml(e.message);
        return `<div class="log-entry" style="border-left:3px solid ${color};padding:4px 8px;font-family:monospace;font-size:11px;line-height:1.4;color:#fff;">
            <span style="color:#aaa">${time}</span>
            <span style="color:${color};font-weight:bold">[${e.level.toUpperCase()}]</span>
            <span>${safeMsg}</span>
        </div>`;
    }).join('');

    listEl.innerHTML = html || '<div style="color:#666;padding:8px;text-align:center">暂无日志</div>';
    
    // 只有用户在底部附近时才自动滚动到底部，否则保留用户位置
    if (isNearBottom) {
        listEl.scrollTop = listEl.scrollHeight;
    }
}

export function showLogPanel(): void {
    if (_panel) {
        _panel.style.display = 'block';
        renderPanel();
        syncConsoleButton();
        return;
    }

    _panel = document.createElement('div');
    _panel.className = 'debug-log-panel';
    _panel.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 600px;
        max-height: 400px;
        background: rgba(20, 20, 30, 0.95);
        border: 1px solid #444;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    `;

    _panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(40,40,50,0.9);border-bottom:1px solid #333;">
            <span style="color:#fff;font-weight:bold;font-size:12px;">📋 日志面板</span>
            <input type="text" data-role="filter" placeholder="过滤 tag..." 
                style="flex:1;background:#222;border:1px solid #444;color:#fff;padding:4px 8px;border-radius:4px;font-size:11px;" />
            <select data-role="level" style="background:#222;border:1px solid #444;color:#fff;padding:4px;border-radius:4px;font-size:11px;">
                <option value="info">INFO+</option>
                <option value="warn">WARN+</option>
                <option value="error">ERROR</option>
            </select>
            <button data-role="clear" style="background:#c0392b;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;">清空</button>
            <!-- [audit:round18 P2] 初始文案由 syncConsoleButton() 按实际状态同步 -->
            <button data-role="console" style="background:#2980b9;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;">Console: OFF</button>
            <button data-role="close" style="background:#555;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;">✕</button>
        </div>
        <div data-role="log-list" style="flex:1;overflow-y:auto;padding:4px;"></div>
    `;

    // 事件绑定
    _panel.querySelector('[data-role="filter"]')?.addEventListener('input', (e) => {
        _filterTag = (e.target as HTMLInputElement).value;
        renderPanel();
    });

    _panel.querySelector('[data-role="level"]')?.addEventListener('change', (e) => {
        _minLevel = (e.target as HTMLSelectElement).value as LogEntry['level'];
        renderPanel();
    });

    _panel.querySelector('[data-role="clear"]')?.addEventListener('click', () => {
        clearLogs();
        renderPanel();
    });

    const consoleBtn = _panel.querySelector<HTMLElement>('[data-role="console"]');
    consoleBtn?.addEventListener('click', () => {
        const enabled = /:\s*ON$/i.test(consoleBtn.textContent ?? '');
        setConsoleOutput(!enabled);
        syncConsoleButton();
    });

    _panel.querySelector('[data-role="close"]')?.addEventListener('click', () => {
        hideLogPanel();
    });

    document.body.appendChild(_panel);

    _unsubscribe = getLogBuffer().subscribe(renderPanel);
    syncConsoleButton();
    renderPanel();
}

export function hideLogPanel(): void {
    if (_panel) {
        _panel.style.display = 'none';
    }
}

export function toggleLogPanel(): void {
    if (!_panel || _panel.style.display === 'none') {
        showLogPanel();
    } else {
        hideLogPanel();
    }
}

export function disposeLogPanel(): void {
    if (_unsubscribe) {
        _unsubscribe();
        _unsubscribe = null;
    }
    if (_panel) {
        _panel.remove();
        _panel = null;
    }
    _filterTag = '';
    _minLevel = 'info';
}

// 注册到全局，方便控制台调用
declare global {
    interface Window {
        __logPanel?: {
            show: typeof showLogPanel;
            hide: typeof hideLogPanel;
            toggle: typeof toggleLogPanel;
            clear: typeof clearLogs;
            dispose: typeof disposeLogPanel;
        };
    }
}

if (typeof window !== 'undefined') {
    window.__logPanel = {
        show: showLogPanel,
        hide: hideLogPanel,
        toggle: toggleLogPanel,
        clear: clearLogs,
        dispose: disposeLogPanel,
    };
}