import { describe, it, expect, vi, beforeEach } from 'vitest';

// 代理层 mock：让 listPresets 的 backend 调用可控，不触发真实 resolveBackend()。
vi.mock('@/core/wails-bindings', () => ({
    ListEnvPresets: vi.fn(),
    GetRenderPresets: vi.fn(),
    GetPresetScenes: vi.fn(),
    GetModelPresets: vi.fn(),
}));

import {
    ListEnvPresets,
    GetRenderPresets,
    GetPresetScenes,
    GetModelPresets,
} from '@/core/wails-bindings';
import { listPresets, toPresetMeta } from '../preset-meta';

const env = ListEnvPresets as unknown as ReturnType<typeof vi.fn>;
const render = GetRenderPresets as unknown as ReturnType<typeof vi.fn>;
const scene = GetPresetScenes as unknown as ReturnType<typeof vi.fn>;
const model = GetModelPresets as unknown as ReturnType<typeof vi.fn>;

const fallback = {
    id: '',
    category: 'env' as const,
    name: '',
    label: '',
    createdAt: undefined,
    tags: undefined,
    version: undefined,
};

describe('toPresetMeta', () => {
    it('构造 id 且 label 缺省回退 name', () => {
        expect(toPresetMeta('env', 'sunset')).toEqual({
            ...fallback,
            id: 'env:sunset',
            category: 'env',
            name: 'sunset',
            label: 'sunset',
        });
    });

    it('接受 extra 的 label/createdAt/tags/version', () => {
        const m = toPresetMeta('render', 'cinematic', {
            label: '电影感',
            createdAt: 123,
            tags: ['fav'],
            version: 1,
        });
        expect(m).toEqual({
            id: 'render:cinematic',
            category: 'render',
            name: 'cinematic',
            label: '电影感',
            createdAt: 123,
            tags: ['fav'],
            version: 1,
        });
    });
});

describe('listPresets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('无过滤时聚合全部四类', async () => {
        env.mockResolvedValue([
            { name: 'a', label: 'A 预设', category: 'sky', createdAt: 100 },
            { name: 'b', label: 'B 预设', category: 'ground', createdAt: 200 },
        ]);
        render.mockResolvedValue([{ name: 'r1', params: '{}' }]);
        scene.mockResolvedValue(['s1']);
        model.mockResolvedValue([
            {
                name: 'm1',
                presetName: 'p',
                modelName: 'n',
                modelRef: 'r',
                updatedAt: 300,
                autoApply: false,
            },
        ]);

        const all = await listPresets();
        expect(all).toHaveLength(5);
        expect(all.map((p) => p.id)).toEqual([
            'env:a',
            'env:b',
            'render:r1',
            'scene:s1',
            'model:m1',
        ]);
        // env 已有 label/createdAt，归一后保留
        expect(all[0]).toEqual({
            ...fallback,
            id: 'env:a',
            category: 'env',
            name: 'a',
            label: 'A 预设',
            createdAt: 100,
        });
        // model 以 updatedAt 复用为时间字段
        expect(all[4].createdAt).toBe(300);
    });

    it('按 category 过滤时短路其余 list 调用', async () => {
        env.mockResolvedValue([{ name: 'a', label: 'A 预设', category: 'sky', createdAt: 1 }]);
        render.mockResolvedValue([]);
        scene.mockResolvedValue(['s1']);
        model.mockResolvedValue([]);

        const envOnly = await listPresets('env');
        expect(envOnly).toEqual([
            { ...fallback, id: 'env:a', category: 'env', name: 'a', label: 'A 预设', createdAt: 1 },
        ]);
        expect(render).not.toHaveBeenCalled();
        expect(scene).not.toHaveBeenCalled();
        expect(model).not.toHaveBeenCalled();
    });

    it('容忍 Go nullable 返回（?? [] 守卫）', async () => {
        env.mockResolvedValue(null);
        render.mockResolvedValue(null);
        scene.mockResolvedValue(null);
        model.mockResolvedValue(null);

        expect(await listPresets()).toEqual([]);
    });
});
