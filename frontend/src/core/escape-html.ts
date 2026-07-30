// [doc:architecture] HTML escape helper — zero-dependency leaf.
// Extracted from utils.ts as part of ADR-191 de-barreling.

/** Escape HTML special characters to prevent injection. */
export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
