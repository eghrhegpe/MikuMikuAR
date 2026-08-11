// [ADR-248] 轻量日志调试面板 — 避免 console source map 卡顿
// 通过 DOM 面板显示日志缓冲区内容，支持过滤和实时更新

import { getLogBuffer, clearLogs, setConsoleOutput, type LogEntry } from './logger';

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
        return `<div class="log-entry" style="border-left:3px solid ${color};padding:4px 8px;font-family:monospace;font-size:11px;line-height:1.4;color:#fff;">
            <span style="color:#aaa">${time}</span>
            <span style="color:${color};font-weight:bold">[${e.level.toUpperCase()}]</span>
            <span>${e.message}</span>
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

    const consoleBtn = _panel.querySelector('[data-role="console"]');
    consoleBtn?.addEventListener('click', () => {
        const enabled = consoleBtn.textContent?.includes('ON') ?? false;
        setConsoleOutput(!enabled);
        consoleBtn.textContent = `Console: ${!enabled ? 'ON' : 'OFF'}`;
        consoleBtn.style.background = !enabled ? '#27ae60' : '#2980b9';
    });

    _panel.querySelector('[data-role="close"]')?.addEventListener('click', () => {
        if (_panel) _panel.style.display = 'none';
    });

    document.body.appendChild(_panel);

    _unsubscribe = getLogBuffer().subscribe(renderPanel);
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

// 注册到全局，方便控制台调用
declare global {
    interface Window {
        __logPanel?: {
            show: typeof showLogPanel;
            hide: typeof hideLogPanel;
            toggle: typeof toggleLogPanel;
            clear: typeof clearLogs;
        };
    }
}

if (typeof window !== 'undefined') {
    window.__logPanel = {
        show: showLogPanel,
        hide: hideLogPanel,
        toggle: toggleLogPanel,
        clear: clearLogs,
    };
}