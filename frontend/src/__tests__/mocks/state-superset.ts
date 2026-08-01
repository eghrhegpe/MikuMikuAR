// [doc:adr-219] state mock 超集工厂 — core/state（4 个 state 子模块的 barrel）分散 mock 形状收敛为单源。
// 参照 scene-superset.ts 模式：超集只兜「消费者需要的常见导出」，opts 覆盖各测试定制字段。
// 使用约束：仅替换「静态子集型」mock；async importActual（保留活绑定）与 globalThis 共享存储型不动。
import { vi } from 'vitest';

export const stateMockSuperset = (opts: Record<string, unknown> = {}) => ({
    // library-state
    focusedModelId: null as string | null,
    modelRegistry: new Map<string, unknown>(),
    recentModels: [] as string[],
    setUIPersistCallback: vi.fn(),
    setThumbnailUpdateCallback: vi.fn(),
    // ui-state
    uiState: {} as Record<string, unknown>,
    setFocusedModelId: vi.fn(),
    // scene-state
    envState: {} as Record<string, unknown>,
    setEnvState: vi.fn(),
    ...opts,
});
