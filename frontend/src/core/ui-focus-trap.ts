// ui-focus-trap.ts — focus trap + restore 工具（ADR-153 Phase 1）
//
// 用法：
//   const restore = createFocusTrap({ container: dialogEl, onEscape: close });
//   // ... later in close handler:
//   restore();
//
// createFocusTrap 返回的 restore 函数：
//   1. 移除 keydown 监听器（trap 解除）
//   2. 若 previousFocus 仍可聚焦，回打焦点（防止焦点丢失到 <body>）

interface FocusTrapOptions {
    container: HTMLElement;
    onEscape?: () => void;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(
        container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
    );
}

export function createFocusTrap(opts: FocusTrapOptions): () => void {
    const { container, onEscape } = opts;

    const previousFocus = document.activeElement as HTMLElement | null;

    function handleKeyDown(e: KeyboardEvent): void {
        if (onEscape && e.key === 'Escape') {
            e.preventDefault();
            onEscape();
            return;
        }
        if (e.key !== 'Tab') return;

        const focusable = getFocusableElements(container);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === container)) {
            e.preventDefault();
            first.focus();
        }
    }

    container.addEventListener('keydown', handleKeyDown);

    return function restore(): void {
        container.removeEventListener('keydown', handleKeyDown);
        if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
            previousFocus.focus();
        }
    };
}