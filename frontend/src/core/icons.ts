// Iconify icon registry — mix Lucide + Tabler seamlessly.
// Convention: icon name "library:icon" (e.g. "tabler:bone") or bare "icon" → auto-prefixed with "lucide:".

const defaultLib = 'lucide';

/** Normalize icon name: "folder" → "lucide:folder"; tabler icons keep their tabler: prefix. */
function resolveIcon(name: string): string {
    return name.includes(':') ? name : `${defaultLib}:${name}`;
}

/** Create an <iconify-icon> element for the given icon name. */
export function createIconifyIcon(name: string): HTMLElement | null {
    try {
        const el = document.createElement('iconify-icon');
        el.setAttribute('icon', resolveIcon(name));
        el.classList.add('menu-icon-svg');
        return el;
    } catch {
        return null;
    }
}

/**
 * 创建图标按钮（默认 slide-action 样式）。
 * 返回按钮元素，调用方自行添加事件监听器和额外样式。
 */
export function createIconButton(
    iconName: string,
    title: string,
    className = 'slide-action'
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    const icon = createIconifyIcon(iconName);
    if (icon) {
        btn.appendChild(icon);
    }
    btn.title = title;
    return btn;
}

/** Map software kind to an iconify icon name. */
export function softwareKindIcon(kind: string): string {
    switch (kind) {
        case 'blender':
            return 'lucide:box';
        case 'mmd':
            return 'lucide:music';
        case 'pmxeditor':
            return 'lucide:file-code-2';
        default:
            return 'lucide:app-window';
    }
}
