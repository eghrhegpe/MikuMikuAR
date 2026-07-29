// browser-adapter-mocks.ts — 共享 vi.mock 工厂（ADR-206 Phase 4 拆自 browser-adapter.test.ts）
// 通过 vi.mock('./idb') 注入内存 store，绕过 IndexedDB。
// vi.hoisted 结果不能 export 跨文件（Vite 报 Cannot export hoisted variable），
// 故 mem 用普通 const + vi.mock 工厂留在各测试文件内联。

export const mem = new Map<string, Map<string, unknown>>();

export function setStore(store: string, entries: Record<string, unknown>): void {
    mem.set(store, new Map(Object.entries(entries)));
}

export const eqBytes = (a: Uint8Array | null, b: Uint8Array): boolean =>
    !!a && a.length === b.length && a.every((v, i) => v === b[i]);

export function resetMem(): void {
    mem.clear();
}
