// menu-schema-mocks.ts — 共享 vi.mock 工厂（ADR-204 P3，拆自 menu-schema.test.ts §6）
// 工厂函数供各拆分文件以 `vi.mock('...', () => factory())` 引用，避免 4 处 vi.mock 重复书写。
// 仅 mock 渲染链路依赖的副作用模块；@/core/state 保持真实（部分用例直接断言其 getter/setter）。
import { vi } from 'vitest';

export const mockScene = () => ({
    setEnvState: vi.fn(),
    getRenderState: vi.fn(() => ({})),
});

export const mockLighting = () => ({
    getLightState: vi.fn(() => ({})),
    setLightState: vi.fn(),
});

export const mockPerception = () => ({
    getPerceptionState: vi.fn(() => ({})),
    getPerceptionStateFor: vi.fn(() => ({})),
    setPerceptionState: vi.fn(),
    setPerceptionStateFor: vi.fn(),
});

export const mockRegistry = () => ({
    getModuleDefaultParam: vi.fn(),
    getModuleConflicts: vi.fn(() => []),
});
