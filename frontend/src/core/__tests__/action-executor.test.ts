// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 隔离测试 action-executor + 真实 control 动作（adr-155/197 NL 控制）。
// 真实 action-registry-defs 顶层会 import 场景/菜单模块，那些模块在 happy-dom 下
// 因 `@/` 别名解析失败无法加载；此处把相关模块全部 mock 掉，仅保留真实注册表与
// 真实 8 个 control 动作定义，从而精确回归「实体动作单次加载」不变量。
vi.mock('../../scene/render/lighting', () => ({ setLightState: vi.fn() }));
vi.mock('../../scene/camera/camera-state', () => ({ setCameraMode: vi.fn() }));
vi.mock('../../scene/env/env-time-of-day', () => ({ applyEnvPreset: vi.fn(() => true) }));
vi.mock('../../scene/env/_bridge/env-bridge', () => ({ setEnvState: vi.fn() }));
vi.mock('../../scene/render/performance', () => ({ setPerformanceMode: vi.fn() }));
vi.mock('../state', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../state')>();
    return { ...actual, envState: { groundVisibleEnabled: true } };
});
vi.mock('../action-defs/settings-actions', () => ({ registerSettingsActions: vi.fn() }));
vi.mock('../action-defs/scene-actions', () => ({ registerSceneActions: vi.fn() }));
vi.mock('../action-defs/motion-actions', () => ({ registerMotionActions: vi.fn() }));
vi.mock('../action-defs/env-actions', () => ({ registerEnvActions: vi.fn() }));
vi.mock('../action-defs/library-actions-def', () => ({ registerLibraryActions: vi.fn() }));
// 完全 mock library-actions：绝不可 importOriginal，否则会加载真实模块并连带拉起 Babylon Scene（happy-dom 下崩溃）。
vi.mock('../../menus/library-actions', () => ({
    findLibraryModelByName: vi.fn(() => ({ file_path: 'dummy.pmx' }) as never),
    replaceModel: vi.fn(),
    findLibraryMotionByName: vi.fn(() => ({ file_path: 'dummy.vmd' }) as never),
    replaceMotion: vi.fn(),
}));

import { executeActionById } from '../action-executor';
import { registerControlActions } from '../ai/action-registry-defs';
import {
    replaceModel,
    replaceMotion,
    findLibraryModelByName,
    findLibraryMotionByName,
} from '../../menus/library-actions';
import { _resetActionRegistry } from '../action-registry';
// [doc:adr-238] library-actions 被 mock 后其尾部桥注册也失效，测试手动补注册到 scene-action-bridge
import { registerSceneAction } from '../scene-action-bridge';

beforeEach(() => {
    vi.clearAllMocks();
    _resetActionRegistry();
    // 桥注册（真实模块被 mock，模块尾部注册不执行，此处手动补齐）
    registerSceneAction('replaceModel', (m) => replaceModel(m as never));
    registerSceneAction('replaceMotion', (m) => replaceMotion(m as never));
    registerSceneAction('findLibraryModelByName', (n) => findLibraryModelByName(n as never));
    registerSceneAction('findLibraryMotionByName', (n) => findLibraryMotionByName(n as never));
    registerControlActions();
});

describe('action-executor：P1 双重加载回归（真实 control 动作）', () => {
    it('loadModel 仅加载一次（resolve 返回实体对象，execute 调 replaceModel 一次）', async () => {
        const res = await executeActionById('ai:control:loadModel', { name: 'miku' });
        expect(res.success).toBe(true);
        expect(findLibraryModelByName).toHaveBeenCalledTimes(1);
        expect(replaceModel).toHaveBeenCalledTimes(1);
        // entity 语义名副其实：execute 拿到的是 resolve 返回的实体对象，而非字符串名
        expect(replaceModel).toHaveBeenCalledWith({ file_path: 'dummy.pmx' });
    });

    it('loadMotion 仅加载一次（resolve 返回实体对象，execute 调 replaceMotion 一次）', async () => {
        const res = await executeActionById('ai:control:loadMotion', { name: 'dance' });
        expect(res.success).toBe(true);
        expect(findLibraryMotionByName).toHaveBeenCalledTimes(1);
        expect(replaceMotion).toHaveBeenCalledTimes(1);
        expect(replaceMotion).toHaveBeenCalledWith({ file_path: 'dummy.vmd' });
    });

    it('实体未找到时返回失败且不调用加载器', async () => {
        (findLibraryModelByName as ReturnType<typeof vi.fn>).mockImplementationOnce(() => null);
        const res = await executeActionById('ai:control:loadModel', { name: 'nope' });
        expect(res.success).toBe(false);
        expect(res.message).toContain('未找到');
        expect(replaceModel).not.toHaveBeenCalled();
    });
});

describe('action-executor：参数校验与分发', () => {
    it('缺少必要参数返回失败 message', async () => {
        const res = await executeActionById('ai:control:setLightIntensity', {});
        expect(res.success).toBe(false);
        expect(res.message).toContain('缺少必要参数');
    });

    it('枚举非法值经 adapter 拦截返回失败', async () => {
        const res = await executeActionById('ai:control:setCameraMode', { mode: 'bogus' });
        expect(res.success).toBe(false);
        expect(res.message).toContain('不在可选范围');
    });

    it('枚举同义词被适配（high → quality）', async () => {
        const res = await executeActionById('ai:control:setPerformance', { mode: 'high' });
        expect(res.success).toBe(true);
    });
});
