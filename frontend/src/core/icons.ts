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
