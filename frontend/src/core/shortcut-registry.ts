// [doc:architecture] Type-safe ShortcutRegistry — key binding management + dispatch.
// No framework dependency, pure TypeScript module-level state.
// KeyboardEvent.code is used for key matching (e.g. 'Digit1', 'Space', 'Escape', 'KeyA').

import { logWarn } from './logger';
import { addDisposableListener, type Disposable } from './dom';
import { safeDispose } from './dispose-helpers';

export interface ShortcutDef {
    id: string; // unique, e.g. 'toggle:model'
    label: string; // i18n key into shortcuts.label.* (e.g. 'shortcuts.label.models')
    defaultKey: string; // KeyboardEvent.code value, e.g. 'Digit1'
    defaultCtrl?: boolean;
    defaultShift?: boolean;
    defaultAlt?: boolean;
    prevent?: boolean; // call e.preventDefault()
    handler: () => void | Promise<void>;
    scope?: string; // 'global' | 'menu' | 'dialog' | 'slider' (default 'global')
    group: string; // UI grouping, e.g. '弹窗导航' '播放控制'
}

// Custom binding overrides stored in-memory (loaded from uiState at init)
export interface KeyBindingOverride {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
}

// ======== Module-level state ========

const _shortcuts = new Map<string, ShortcutDef>();
const _overrides: Record<string, KeyBindingOverride> = {};
let _initialized = false;
// [doc:adr-102] 持有 keydown 监听器的 Disposable，便于在 _resetShortcutRegistry 中统一释放
let _keydownDisposable: Disposable | null = null;

// ======== Internal helpers ========

interface EffectiveBinding {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
}

export interface ShortcutWithBinding extends ShortcutDef {
    currentKey: string;
    currentCtrl: boolean;
    currentShift: boolean;
    currentAlt: boolean;
}

function getEffectiveBinding(def: ShortcutDef): EffectiveBinding {
    const ov = _overrides[def.id];
    return {
        key: ov?.key ?? def.defaultKey,
        ctrl: ov?.ctrl ?? def.defaultCtrl ?? false,
        shift: ov?.shift ?? def.defaultShift ?? false,
        alt: ov?.alt ?? def.defaultAlt ?? false,
    };
}

function bindingMatches(e: KeyboardEvent, b: EffectiveBinding): boolean {
    return e.code === b.key && e.ctrlKey === b.ctrl && e.shiftKey === b.shift && e.altKey === b.alt;
}

function isInputElement(el: EventTarget | null): boolean {
    if (!el || !(el instanceof HTMLElement)) {
        return false;
    }
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function isInsideSlider(el: EventTarget | null): boolean {
    if (!el || !(el instanceof HTMLElement)) {
        return false;
    }
    return !!el.closest('.cs-slider, .color-slider, .cs-bar');
}

function getCurrentScope(el: EventTarget | null): string {
    if (!el || !(el instanceof HTMLElement)) {
        return 'global';
    }
    if (el.closest('.dialog') || el.closest('.modal')) {
        return 'dialog';
    }
    if (el.closest('.slide-menu') || el.closest('.menu-container')) {
        return 'menu';
    }
    if (el.closest('.cs-slider, .color-slider, .cs-bar')) {
        return 'slider';
    }
    return 'global';
}

function scopeMatches(shortcutScope: string | undefined, currentScope: string): boolean {
    if (!shortcutScope || shortcutScope === 'global') {
        return true;
    }
    return shortcutScope === currentScope;
}

// ======== Public API ========

/** 两个有效绑定是否按键组合冲突（key + 修饰键组合完全一致）。 */
function bindingsConflict(a: EffectiveBinding, b: EffectiveBinding): boolean {
    return (
        a.key === b.key && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt
    );
}

/**
 * [fix code_review P3] 冲突延迟队列：注册时按键冲突的 shortcut 存入此队列（不直接
 * 丢弃），待绑定变更（setKeyBinding/resetKeyBinding/loadKeyBindings）后重试注册——
 * 用户改绑或重置冲突方后，被延迟的快捷键自动恢复，而非永久失效直到整页刷新。
 */
const _deferredShortcuts: ShortcutDef[] = [];

/** 绑定变更后重新尝试注册延迟队列中的快捷键；冲突已消失者注册并移除。 */
function _flushDeferredShortcuts(): void {
    if (_deferredShortcuts.length === 0) {
        return;
    }
    const remaining: ShortcutDef[] = [];
    // 本轮已恢复的绑定——防止多个 deferred 项彼此冲突时同时恢复
    // （例：b=Space 与 c=Space 均因与 a=Space 冲突入队，a 改绑后 flush
    // 若不加此守卫，b 和 c 会同时进入 _shortcuts 导致冲突泄漏）
    const reclaimed: EffectiveBinding[] = [];
    for (const def of _deferredShortcuts) {
        // 注：不做 `_shortcuts.has(def.id)` 跳过——stale 清理已在 registerShortcut
        // 成功路径完成（set 时删队列同 id 条目），此处残留的同 id 条目必然都是
        // 成功注册之后的 fresh 重新入队（最新意图），可直接按最新意图覆盖恢复。
        const incoming = getEffectiveBinding(def);
        let conflict = false;
        for (const [otherId, otherDef] of _shortcuts) {
            if (otherId === def.id) {
                continue;
            }
            if (bindingsConflict(incoming, getEffectiveBinding(otherDef))) {
                conflict = true;
                break;
            }
        }
        if (!conflict) {
            for (const rb of reclaimed) {
                if (bindingsConflict(incoming, rb)) {
                    conflict = true;
                    break;
                }
            }
        }
        if (conflict) {
            remaining.push(def);
        } else {
            _shortcuts.set(def.id, def);
            reclaimed.push(incoming);
            logWarn('shortcut-registry', `Shortcut "${def.id}" 冲突已解除，恢复注册`);
        }
    }
    _deferredShortcuts.length = 0;
    _deferredShortcuts.push(...remaining);
}

/** 定位延迟队列中指定 id 的条目下标（无则 -1）。入队按 id 去重（replace-or-push），
 *  同 id 至多一条——冲突替换路径与成功清理路径共用此查找，保持维护点同步。 */
function findDeferredIndex(id: string): number {
    return _deferredShortcuts.findIndex((d) => d.id === id);
}

/** Register ONE shortcut. */
export function registerShortcut(def: ShortcutDef): void {
    if (!def.handler) {
        logWarn('shortcut-registry', `Shortcut "${def.id}" has no handler`);
        return;
    }
    // [fix P2] 冲突守卫：检测与已注册 shortcut 的按键绑定冲突（同 key + 修饰键组合）。
    // 呼应 Ctrl+Space 被三模块同时注册静默覆盖的 P1 先例——后注册者若按键冲突，
    // 此前 Map.set 静默覆盖先注册者，功能静默失效无告警。现改为：冲突时 logWarn
    // 并保留先注册者（同 id 跳过——HMR 重载重注册合法，仅跨 id 冲突被拦截）。
    // [fix code_review P3] 冲突项入 deferred 队列而非永久丢弃：绑定变更后自动重试。
    const incoming = getEffectiveBinding(def);
    for (const [otherId, otherDef] of _shortcuts) {
        if (otherId === def.id) {
            continue;
        }
        const other = getEffectiveBinding(otherDef);
        if (bindingsConflict(incoming, other)) {
            logWarn(
                'shortcut-registry',
                `Shortcut "${def.id}" 与 "${otherId}" 按键冲突 ` +
                    `(${incoming.key}${incoming.ctrl ? '+Ctrl' : ''}${incoming.shift ? '+Shift' : ''}${incoming.alt ? '+Alt' : ''})——` +
                    `保留先注册者，忽略后注册者（冲突解除后自动恢复）`
            );
            // [fix code_review P2] 入队按 id 去重：同 id 重复冲突注册（HMR 期间冲突持续）
            // 会累积多条 stale 条目，flush 时重复恢复 + 重复 logWarn；已入队的同 id
            // 直接覆盖（保留最新 def，旧条目替换）
            const existingIdx = findDeferredIndex(def.id);
            if (existingIdx >= 0) {
                _deferredShortcuts[existingIdx] = def;
            } else {
                _deferredShortcuts.push(def);
            }
            return;
        }
    }
    _shortcuts.set(def.id, def);
    // [fix code_review P2] 成功路径清理队列中同 id 的 stale 条目：若 id 曾在冲突入队后
    // 又成功重注册（HMR 改绑），旧队列条目已过时——保留会让 flush 误以为它是最新意图
    // 而覆盖权威注册。此处同步移除，使 flush 时残留的同 id 条目必然都是成功注册之后的
    // fresh 重新入队（最新意图），可按最新意图恢复。
    const staleIdx = findDeferredIndex(def.id);
    if (staleIdx >= 0) {
        _deferredShortcuts.splice(staleIdx, 1);
    }
}

/** Register MULTIPLE shortcuts at once. */
export function registerShortcuts(defs: ShortcutDef[]): void {
    for (const def of defs) {
        registerShortcut(def);
    }
}

/** Get all registered shortcuts with their CURRENT effective bindings. */
export function getAllShortcuts(): ShortcutWithBinding[] {
    const result: ShortcutWithBinding[] = [];
    for (const def of _shortcuts.values()) {
        const binding = getEffectiveBinding(def);
        result.push({
            ...def,
            currentKey: binding.key,
            currentCtrl: binding.ctrl,
            currentShift: binding.shift,
            currentAlt: binding.alt,
        });
    }
    return result;
}

/** 格式化按键绑定为可读字符串，如 "Ctrl+1"、"Shift+←" */
export function formatKeyBinding(key: string, ctrl: boolean, shift: boolean, alt: boolean): string {
    const parts: string[] = [];
    if (ctrl) {
        parts.push('Ctrl');
    }
    if (shift) {
        parts.push('Shift');
    }
    if (alt) {
        parts.push('Alt');
    }
    let display = key;
    if (key === 'Space') {
        display = 'Space';
    } else if (key === 'Escape') {
        display = 'Esc';
    } else if (key === 'ArrowLeft') {
        display = '←';
    } else if (key === 'ArrowRight') {
        display = '→';
    } else if (key === 'ArrowUp') {
        display = '↑';
    } else if (key === 'ArrowDown') {
        display = '↓';
    } else if (key === 'Enter') {
        display = 'Enter';
    } else if (key.startsWith('Digit')) {
        display = key.slice(5);
    } else if (key.startsWith('Key')) {
        display = key.slice(3);
    }
    parts.push(display);
    return parts.join('+');
}

/** 将 ShortcutDef 格式化为 aria-keyshortcuts 值，如 "Control+1" */
export function getAriaKeyshortcuts(def: ShortcutDef): string {
    const binding = getEffectiveBinding(def);
    const parts: string[] = [];
    if (binding.ctrl) {
        parts.push('Control');
    }
    if (binding.shift) {
        parts.push('Shift');
    }
    if (binding.alt) {
        parts.push('Alt');
    }
    // 将 KeyboardEvent.code 转为 aria-keyshortcuts 格式
    let key = binding.key;
    if (key.startsWith('Digit')) {
        key = key.slice(5);
    } else if (key.startsWith('Key')) {
        key = key.slice(3);
    }
    parts.push(key);
    return parts.join('+');
}

/**
 * Set custom key binding for a shortcut ID.
 * Returns { ok: true } on success, or conflict info if the key combo is taken.
 */
export function setKeyBinding(
    id: string,
    key: string,
    ctrl?: boolean,
    shift?: boolean,
    alt?: boolean
): { ok: true } | { ok: false; conflictId: string; conflictLabel: string } {
    const prospective: EffectiveBinding = {
        key,
        ctrl: ctrl ?? false,
        shift: shift ?? false,
        alt: alt ?? false,
    };

    // Check all other shortcuts for conflict
    for (const [otherId, otherDef] of _shortcuts) {
        if (otherId === id) {
            continue;
        }
        const otherBinding = getEffectiveBinding(otherDef);
        if (
            prospective.key === otherBinding.key &&
            prospective.ctrl === otherBinding.ctrl &&
            prospective.shift === otherBinding.shift &&
            prospective.alt === otherBinding.alt
        ) {
            return {
                ok: false,
                conflictId: otherId,
                conflictLabel: otherDef.label,
            };
        }
    }

    _overrides[id] = { key, ctrl, shift, alt };
    // [fix code_review P3] 绑定变更后重试延迟队列（可能解除某 deferred shortcut 的冲突）
    _flushDeferredShortcuts();
    return { ok: true };
}

/** Reset one shortcut to its default binding. */
export function resetKeyBinding(id: string): void {
    delete _overrides[id];
    // [fix code_review P3] 重置可能解除冲突，重试延迟队列
    _flushDeferredShortcuts();
}

/** Reset ALL shortcuts to their default bindings. */
export function resetAllKeyBindings(): void {
    for (const key of Object.keys(_overrides)) {
        delete _overrides[key];
    }
    _flushDeferredShortcuts();
}

/** Load custom bindings from persisted state (call at app init). */
export function loadKeyBindings(bindings: Record<string, KeyBindingOverride>): void {
    for (const [id, override] of Object.entries(bindings)) {
        _overrides[id] = { ...override };
    }
    _flushDeferredShortcuts();
}

/** Get current custom bindings (for saving to uiState). */
export function exportKeyBindings(): Record<string, KeyBindingOverride> {
    const result: Record<string, KeyBindingOverride> = {};
    for (const [id, ov] of Object.entries(_overrides)) {
        result[id] = { ...ov };
    }
    return result;
}

/**
 * Initialize the dispatcher — call once at app startup.
 * Attaches a single window keydown listener that dispatches to matching shortcuts.
 * Scope filter: if element is input/textarea/contentEditable, skip.
 * Arrow key conflict prevention: if target or ancestor has class 'cs-slider' or 'color-slider',
 * skip global ArrowLeft/ArrowRight shortcuts.
 */
export function initShortcutDispatcher(): void {
    if (_initialized) {
        logWarn('shortcut-registry', 'Dispatcher already initialized');
        return;
    }
    _initialized = true;

    _keydownDisposable = addDisposableListener(window, 'keydown', (e: KeyboardEvent) => {
        // Skip if target is an input element
        if (isInputElement(e.target)) {
            return;
        }

        // ADR-153: 3D camera keyboard control — skip Arrow/zoom keys when canvas focused
        const canvasArrowKeys = [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Equal',
            'Minus',
            'NumpadAdd',
            'NumpadSubtract',
        ];
        if (canvasArrowKeys.includes(e.code) && document.activeElement?.id === 'renderCanvas') {
            return;
        }

        // Skip arrow keys when inside a slider
        if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && isInsideSlider(e.target)) {
            return;
        }

        const currentScope = getCurrentScope(e.target);

        // Find matching shortcut (first match wins)
        for (const def of _shortcuts.values()) {
            if (!scopeMatches(def.scope, currentScope)) {
                continue;
            }
            const binding = getEffectiveBinding(def);
            if (bindingMatches(e, binding)) {
                if (def.prevent) {
                    e.preventDefault();
                }
                def.handler();
                return;
            }
        }
    });
}

// ======== Testing Support ========

/**
 * Reset all internal state — only for use in tests.
 * @internal
 */
export function _resetShortcutRegistry(): void {
    _shortcuts.clear();
    for (const key of Object.keys(_overrides)) {
        delete _overrides[key];
    }
    // [fix code_review P3] 清空延迟队列：reset 契约须覆盖全部模块级状态——否则测试
    // 遗留的 deferred 条目会在下个测试的 setKeyBinding/resetKeyBinding flush 时被
    // 注入全新注册表（跨测试污染 + stale handler 分发）
    _deferredShortcuts.length = 0;
    _keydownDisposable = safeDispose(_keydownDisposable);
    _initialized = false;
}
