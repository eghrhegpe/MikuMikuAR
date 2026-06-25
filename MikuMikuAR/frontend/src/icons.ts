// Iconify icon registry — mix Lucide + Tabler seamlessly.
// Convention: icon name "library:icon" or bare "icon" → auto-prefixed with "lucide:".

const defaultLib = "lucide";

/** Normalize icon name: "folder" → "lucide:folder", "tabler:dance" stays. */
function resolveIcon(name: string): string {
    return name.includes(":") ? name : `${defaultLib}:${name}`;
}

/** Create an <iconify-icon> element for the given icon name. */
export function createIconifyIcon(name: string): HTMLElement | null {
    try {
        const el = document.createElement("iconify-icon");
        el.setAttribute("icon", resolveIcon(name));
        el.classList.add("menu-icon-svg");
        return el;
    } catch {
        return null;
    }
}
