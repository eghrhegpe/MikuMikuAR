// [doc:adr-feedback] 结构化反馈 API —— 统一「动作 + 目标 + 结果」三要素
//
// 设计动机：旧模式 showToast(t('scene.saveFailed'), msg) 中 title 无目标、
// detail 暴露技术堆栈，用户困惑「保存哪个文件？什么错误？」。
// 本模块保证每条反馈回答三个问题：做了什么 / 对谁做 / 结果如何。
//
// ## 使用规范（调用方必读）
//
// ### toast — 阻塞级反馈（需立即关注）
// - 用 `feedbackError(actionKey, target)`：标题含操作名+目标名
// - detail 由内部自动拼接 translateGoError + 可读降级，不传原始 err
// - info 用 `feedbackInfo(actionKey, target?)`
//
// ### status — 行级反馈（可快速扫过）
// - 用 `feedbackStatus(actionKey, target?, ok?)`：auto-detect ok from translated keys
// - 自动追加 ": {target}" 到标题，避免「操作名≠目标名」的歧义
//
// ### 占位符约定
// - actionKey 必须是 i18n 短 key（如 'scene.saveSuccess'），不含 {target}
// - target 是目标名称（如文件名/模型名/预设名），可为 undefined（静默回退）
// - 当 target 为 string 时，feedback 内部将 t(key, { target }) 拼接为完整文本

import { t } from './i18n/t';
import { translateGoError } from './i18n/goerr';
import { setStatus } from './status-bar';
import { showErrorToast, showInfoToast } from './toast';

// ===================================================================
// Toast 反馈 —— 用户必须关注的阻塞级通知
// ===================================================================

/**
 * 错误级 toast 反馈。标题 =「动作 + 目标」，detail 自动从 error 翻译。
 *
 * 用法：
 *   feedbackError('scene.save', undefined)                    // 无目标名
 *   feedbackError('library.load', 'miku.pmx', err)           // 有目标名
 *   feedbackError('env-preset.save', autoLabel, err)         // 动态目标
 */
export function feedbackError(actionKey: string, target: string | undefined, err?: unknown): void {
    const titleTarget = target ? ` — ${target}` : '';
    const detail = err != null ? translateGoError(err) : undefined;
    showErrorToast(t(actionKey) + titleTarget, detail);
}

/**
 * Info 级 toast 反馈。标题 =「动作 + 目标」。
 *
 * 用法：
 *   feedbackInfo('scene.saved', undefined)        // 只提示操作完成
 *   feedbackInfo('modelLoaded', 'hatsune.mmd')    // 告知具体哪个模型
 */
export function feedbackInfo(actionKey: string, target: string | undefined): void {
    const titleTarget = target ? ` — ${target}` : '';
    showInfoToast(t(actionKey) + titleTarget);
}

// ===================================================================
// Status 反馈 —— 状态栏轻提示（可快速扫过）
// ===================================================================

/**
 * 通用状态栏反馈。auto-detect 成功与否：title 以 ✗ 开头则为失败。
 *
 * 用法：
 *   feedbackStatus('loading')                                          // 无目标，中性色
 *   feedbackStatus('library.modelLoadFailed', 'model.pmx')            // 目标名，红色
 *   feedbackStatus('library.modelLoaded', 'model.pmx', true)          // 显式成功
 */
export function feedbackStatus(statusKey: string, target?: string, explicitOk?: boolean): void {
    const baseText = t(statusKey);
    const fullText = target ? `${baseText}${target}` : baseText;
    const ok = explicitOk ?? !baseText.startsWith('\u2717'); // ✗ = 失败
    setStatus(fullText, ok);
}

// ===================================================================
// withFeedback —— 包装异步操作的快捷函数
// ===================================================================

/**
 * 包装一个 async 操作，自动管理 loading → success → error 状态 + toast。
 *
 * - 开始：显示 loading 状态，ok=false
 * - 成功：显示 success 状态，ok=true + info toast
 * - 失败：显示 error 状态，ok=false + error toast（含 error 详情）
 *
 * 用法：
 *   await withFeedback(
 *       'loadModel',           // action key prefix
 *       modelEntry.name,       // target name
 *       async () => doLoad(),  // the operation
 *   );
 */
export async function withFeedback<T>(
    actionKey: string,
    target: string | undefined,
    fn: () => T | Promise<T>,
    successKey?: string,
    failKey?: string
): Promise<T | undefined> {
    const loadingKey = `${actionKey}.loading`;
    const success = successKey || `${actionKey}.success`;
    const fail = failKey || `${actionKey}.failed`;

    feedbackStatus(actionKey, target);

    try {
        const result = await fn();
        feedbackInfo(success, target);
        return result;
    } catch (err) {
        feedbackError(fail, target, err);
        return undefined;
    }
}
