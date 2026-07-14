// [doc:test-strategy] Function 签名契约测试
// 锁住 22 个高风险 Go 后端 binding 函数的返回类型与参数形状。
// Go 端改函数签名时此处 test 会 fail，防止静默破坏 Go↔TS 边界。

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { CancellablePromise as $CancellablePromise } from '@wailsio/runtime';
import * as App from '../../../bindings/mikumikuar/internal/app/app';
import type {
    BuildInfo,
    CacheStats,
    Config,
    EnvPresetEntry,
    EnvState,
    ModelEntry,
    ModelMeta,
    ModelPresetEntry,
    RenderPreset,
    UIState,
} from '../../../bindings/mikumikuar/internal/app/models';

// ---------- 总存在性快照 ----------

describe('app.ts binding surface sanity', () => {
    it('exports ≥ 100 binding functions', () => {
        const k = Object.keys(App);
        expect(k.length).toBeGreaterThanOrEqual(100);
    });
});

// ---------- 逐个函数签名锁 ----------

describe('GetAppVersion signature', () => {
    it('returns $CancellablePromise<string>', () => {
        expectTypeOf<ReturnType<typeof App.GetAppVersion>>().toEqualTypeOf<
            $CancellablePromise<string>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.GetAppVersion>().parameters.toEqualTypeOf<[]>();
    });
});

describe('GetBuildInfo signature', () => {
    it('returns $CancellablePromise<BuildInfo | null>', () => {
        expectTypeOf<ReturnType<typeof App.GetBuildInfo>>().toEqualTypeOf<
            $CancellablePromise<BuildInfo | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.GetBuildInfo>().parameters.toEqualTypeOf<[]>();
    });
});

describe('GetCacheStats signature', () => {
    it('returns $CancellablePromise<CacheStats | null>', () => {
        expectTypeOf<ReturnType<typeof App.GetCacheStats>>().toEqualTypeOf<
            $CancellablePromise<CacheStats | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.GetCacheStats>().parameters.toEqualTypeOf<[]>();
    });
});

describe('GetConfig signature', () => {
    it('returns $CancellablePromise<Config | null>', () => {
        expectTypeOf<ReturnType<typeof App.GetConfig>>().toEqualTypeOf<
            $CancellablePromise<Config | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.GetConfig>().parameters.toEqualTypeOf<[]>();
    });
});

describe('GetLibraryIndex signature', () => {
    it('returns $CancellablePromise<ModelEntry[] | null>', () => {
        expectTypeOf<ReturnType<typeof App.GetLibraryIndex>>().toEqualTypeOf<
            $CancellablePromise<ModelEntry[] | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.GetLibraryIndex>().parameters.toEqualTypeOf<[]>();
    });
});

describe('GetModelMeta signature', () => {
    it('returns $CancellablePromise<ModelMeta>', () => {
        expectTypeOf<ReturnType<typeof App.GetModelMeta>>().toEqualTypeOf<
            $CancellablePromise<ModelMeta>
        >();
    });
    it('takes parameters [string]', () => {
        expectTypeOf<typeof App.GetModelMeta>().parameters.toEqualTypeOf<[string]>();
    });
});

describe('GetModelPresets signature', () => {
    it('returns $CancellablePromise<ModelPresetEntry[] | null>', () => {
        expectTypeOf<ReturnType<typeof App.GetModelPresets>>().toEqualTypeOf<
            $CancellablePromise<ModelPresetEntry[] | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.GetModelPresets>().parameters.toEqualTypeOf<[]>();
    });
});

describe('GetRecentModels signature', () => {
    it('returns $CancellablePromise<string[] | null>', () => {
        expectTypeOf<ReturnType<typeof App.GetRecentModels>>().toEqualTypeOf<
            $CancellablePromise<string[] | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.GetRecentModels>().parameters.toEqualTypeOf<[]>();
    });
});

describe('GetRenderPresets signature', () => {
    it('returns $CancellablePromise<RenderPreset[] | null>', () => {
        expectTypeOf<ReturnType<typeof App.GetRenderPresets>>().toEqualTypeOf<
            $CancellablePromise<RenderPreset[] | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.GetRenderPresets>().parameters.toEqualTypeOf<[]>();
    });
});

describe('ListEnvPresets signature', () => {
    it('returns $CancellablePromise<EnvPresetEntry[] | null>', () => {
        expectTypeOf<ReturnType<typeof App.ListEnvPresets>>().toEqualTypeOf<
            $CancellablePromise<EnvPresetEntry[] | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.ListEnvPresets>().parameters.toEqualTypeOf<[]>();
    });
});

describe('ScanModelDir signature', () => {
    it('returns $CancellablePromise<ModelEntry[] | null>', () => {
        expectTypeOf<ReturnType<typeof App.ScanModelDir>>().toEqualTypeOf<
            $CancellablePromise<ModelEntry[] | null>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.ScanModelDir>().parameters.toEqualTypeOf<[]>();
    });
});

describe('SetEnvState signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.SetEnvState>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [EnvState]', () => {
        expectTypeOf<typeof App.SetEnvState>().parameters.toEqualTypeOf<[EnvState]>();
    });
});

describe('SetUIState signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.SetUIState>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [UIState]', () => {
        expectTypeOf<typeof App.SetUIState>().parameters.toEqualTypeOf<[UIState]>();
    });
});

describe('SetUIAccent signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.SetUIAccent>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [string]', () => {
        expectTypeOf<typeof App.SetUIAccent>().parameters.toEqualTypeOf<[string]>();
    });
});

describe('SetUIScale signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.SetUIScale>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [number]', () => {
        expectTypeOf<typeof App.SetUIScale>().parameters.toEqualTypeOf<[number]>();
    });
});

describe('OpenInBlender signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.OpenInBlender>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [string]', () => {
        expectTypeOf<typeof App.OpenInBlender>().parameters.toEqualTypeOf<[string]>();
    });
});

describe('SaveSceneFile signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.SaveSceneFile>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [string, string]', () => {
        expectTypeOf<typeof App.SaveSceneFile>().parameters.toEqualTypeOf<[string, string]>();
    });
});

describe('ImportDanceSet signature', () => {
    it('returns $CancellablePromise<string>', () => {
        expectTypeOf<ReturnType<typeof App.ImportDanceSet>>().toEqualTypeOf<
            $CancellablePromise<string>
        >();
    });
    it('takes parameters [string, string, string]', () => {
        expectTypeOf<typeof App.ImportDanceSet>().parameters.toEqualTypeOf<
            [string, string, string]
        >();
    });
});

describe('LoadLastScene signature', () => {
    it('returns $CancellablePromise<string>', () => {
        expectTypeOf<ReturnType<typeof App.LoadLastScene>>().toEqualTypeOf<
            $CancellablePromise<string>
        >();
    });
    it('takes no parameters', () => {
        expectTypeOf<typeof App.LoadLastScene>().parameters.toEqualTypeOf<[]>();
    });
});

describe('BundleScene signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.BundleScene>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [string, string, string[] | null]', () => {
        expectTypeOf<typeof App.BundleScene>().parameters.toEqualTypeOf<
            [string, string, string[] | null]
        >();
    });
});

describe('SaveModelPreset signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.SaveModelPreset>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [string, string]', () => {
        expectTypeOf<typeof App.SaveModelPreset>().parameters.toEqualTypeOf<[string, string]>();
    });
});

describe('StartFileServer signature', () => {
    it('returns $CancellablePromise<number>', () => {
        expectTypeOf<ReturnType<typeof App.StartFileServer>>().toEqualTypeOf<
            $CancellablePromise<number>
        >();
    });
    it('takes parameters [string]', () => {
        expectTypeOf<typeof App.StartFileServer>().parameters.toEqualTypeOf<[string]>();
    });
});

describe('StopFileServer signature', () => {
    it('returns $CancellablePromise<void>', () => {
        expectTypeOf<ReturnType<typeof App.StopFileServer>>().toEqualTypeOf<
            $CancellablePromise<void>
        >();
    });
    it('takes parameters [string]', () => {
        expectTypeOf<typeof App.StopFileServer>().parameters.toEqualTypeOf<[string]>();
    });
});

// ---------- 总导出存在性检查 ----------

describe('app.ts binding surface — no unexpected top-level keys drift', () => {
    it('all 22 target functions are exported on App namespace', () => {
        expect(App).toHaveProperty('GetAppVersion');
        expect(App).toHaveProperty('GetBuildInfo');
        expect(App).toHaveProperty('GetCacheStats');
        expect(App).toHaveProperty('GetConfig');
        expect(App).toHaveProperty('GetLibraryIndex');
        expect(App).toHaveProperty('GetModelMeta');
        expect(App).toHaveProperty('GetModelPresets');
        expect(App).toHaveProperty('GetRecentModels');
        expect(App).toHaveProperty('GetRenderPresets');
        expect(App).toHaveProperty('ListEnvPresets');
        expect(App).toHaveProperty('ScanModelDir');
        expect(App).toHaveProperty('SetEnvState');
        expect(App).toHaveProperty('SetUIState');
        expect(App).toHaveProperty('SetUIAccent');
        expect(App).toHaveProperty('SetUIScale');
        expect(App).toHaveProperty('OpenInBlender');
        expect(App).toHaveProperty('SaveSceneFile');
        expect(App).toHaveProperty('ImportDanceSet');
        expect(App).toHaveProperty('LoadLastScene');
        expect(App).toHaveProperty('BundleScene');
        expect(App).toHaveProperty('SaveModelPreset');
        expect(App).toHaveProperty('StartFileServer');
        expect(App).toHaveProperty('StopFileServer');
    });
});
