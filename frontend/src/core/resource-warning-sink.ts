// [feature:resource-warning-sink] 资源加载失败统一汇总。
// 各加载点（模型纹理 / 换装贴图 / FBX / 音频）调用 reportResourceWarning 累积警告，
// 在 debounce 窗口内合并为单条 info toast，避免逐条刷屏；
// flush 时附带 logWarn 诊断日志，便于无界面环境下定位。

import { showInfoToast } from '@/core/toast';
import { t } from '@/core/i18n/t';
import { logWarn } from '@/core/logger';

/** 同一次加载流程内的多次警告合并窗口（ms） */
const DEBOUNCE_MS = 400;

const _pending = new Set<string>();
let _timer: ReturnType<typeof setTimeout> | null = null;

function _flush(): void {
    _timer = null;
    if (_pending.size === 0) {
        return;
    }
    const items = [..._pending];
    _pending.clear();
    const count = items.length;
    const detail = items.slice(0, 8).join('、') + (count > 8 ? ` …+${count - 8}` : '');
    try {
        showInfoToast(t('resource.warnSummary', { count }), detail);
    } catch {
        // 无 document 的极端环境（如部分测试）toast 不可用，降级为日志
    }
    logWarn('resource-warning', `资源加载异常汇总(${count}):`, items);
}

/**
 * 上报一条资源加载警告（自动去重）。
 * 多次调用会在 DEBOUNCE_MS 窗口内合并为单条提示。
 * @param message 已本地化的可读描述（建议含资源名，便于用户定位）
 */
export function reportResourceWarning(message: string): void {
    _pending.add(message);
    if (_timer) {
        clearTimeout(_timer);
    }
    _timer = setTimeout(_flush, DEBOUNCE_MS);
}
