// [doc:architecture] Type-safe ShortcutRegistry — key binding management + dispatch.
// No framework dependency, pure TypeScript module-level state.
// KeyboardEvent.code is used for key matching (e.g. 'Digit1', 'Space', 'Escape', 'KeyA').

export interface ShortcutDef {
    id: string;           // unique, e.g. 'toggle:models'
    label: string;        // Chinese label, e.g. '模型库'
    defaultKey: string;   // KeyboardEvent.code value, e.g. 'Digit1'
    defaultCtrl?: boolean;
    defaultShift?: boolean;
    defaultAlt?: boolean;
    prevent?: boolean;    // call e.preventDefault()
    handler: () => void | Promise<void>;
    scope?: string;       // 'global' | 'menu' | 'dialog' | 'slider' (default 'global')
    group: string;        // UI grouping, e.g. '弹窗导航' '播放控制'
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
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

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
    return (
        e.code === b.key
        && e.ctrlKey === b.ctrl
        && e.shiftKey === b.shift
        && e.altKey === b.alt
    );
}

function isInputElement(el: EventTarget | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function isInsideSlider(el: EventTarget | null): boolean {
    if (!el || !(el instanceof HTMLElement)) return false;
    return !!el.closest('.cs-slider, .color-slider');
}

// ======== Public API ========

/** Register ONE shortcut. */
export function registerShortcut(def: ShortcutDef): void {
    if (!def.handler) {
        console.warn(`[shortcut-registry] Shortcut "${def.id}" has no handler`);
        return;
    }
    _shortcuts.set(def.id, def);
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

/**
 * Set custom key binding for a shortcut ID.
 * Returns { ok: true } on success, or conflict info if the key combo is taken.
 */
export function setKeyBinding(
    id: string,
    key: string,
    ctrl?: boolean,
    shift?: boolean,
    alt?: boolean,
): { ok: true } | { ok: false; conflictId: string; conflictLabel: string } {
    const prospective: EffectiveBinding = {
        key,
        ctrl: ctrl ?? false,
        shift: shift ?? false,
        alt: alt ?? false,
    };

    // Check all other shortcuts for conflict
    for (const [otherId, otherDef] of _shortcuts) {
        if (otherId === id) continue;
        const otherBinding = getEffectiveBinding(otherDef);
        if (
            prospective.key === otherBinding.key
            && prospective.ctrl === otherBinding.ctrl
            && prospective.shift === otherBinding.shift
            && prospective.alt === otherBinding.alt
        ) {
            return {
                ok: false,
                conflictId: otherId,
                conflictLabel: otherDef.label,
            };
        }
    }

    _overrides[id] = { key, ctrl, shift, alt };
    return { ok: true };
}

/** Reset one shortcut to its default binding. */
export function resetKeyBinding(id: string): void {
    delete _overrides[id];
}

/** Reset ALL shortcuts to their default bindings. */
export function resetAllKeyBindings(): void {
    for (const key of Object.keys(_overrides)) {
        delete _overrides[key];
    }
}

/** Load custom bindings from persisted state (call at app init). */
export function loadKeyBindings(bindings: Record<string, KeyBindingOverride>): void {
    for (const [id, override] of Object.entries(bindings)) {
        _overrides[id] = { ...override };
    }
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
        console.warn('[shortcut-registry] Dispatcher already initialized');
        return;
    }
    _initialized = true;

    _keydownHandler = (e: KeyboardEvent) => {
        // Skip if target is an input element
        if (isInputElement(e.target)) return;

        // Skip arrow keys when inside a slider
        if (
            (e.code === 'ArrowLeft' || e.code === 'ArrowRight')
            && isInsideSlider(e.target)
        ) return;

        // Find matching shortcut (first match wins)
        for (const def of _shortcuts.values()) {
            const binding = getEffectiveBinding(def);
            if (bindingMatches(e, binding)) {
                if (def.prevent) {
                    e.preventDefault();
                }
                def.handler();
                return;
            }
        }
    };

    window.addEventListener('keydown', _keydownHandler);
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
    if (_keydownHandler) {
        window.removeEventListener('keydown', _keydownHandler);
        _keydownHandler = null;
    }
    _initialized = false;
}
