// [doc:architecture] JSON serialization helpers — zero-dependency leaf.
// Extracted from utils.ts as part of ADR-191 de-barreling.

/** Format a value as pretty-printed JSON (2-space indent). */
export function jsonStringify(x: unknown): string {
    return JSON.stringify(x, null, 2);
}

/** Safely parse JSON; returns null on failure instead of throwing. */
export function jsonParse<T>(s: string): T | null {
    try {
        return JSON.parse(s) as T;
    } catch {
        return null;
    }
}
