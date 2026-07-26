// [doc:test] ADR-176 / ADR-177 backend 抽象层单测
import { describe, it, expect, beforeEach, vi } from 'vitest';

// go-adapter 依赖 @bindings 运行时（Wails），测试中隔离为纯桩。
vi.mock('./go-adapter', () => ({
    goAdapter: {
        kind: 'go',
        capabilities: () => ({
            ar: true,
            externalApps: true,
            plazaWindow: true,
            fsAccess: false,
            watchDir: true,
            proxyServer: true,
            fileServer: true,
            systemDirOpen: true,
            storageMode: true,
            screenshotSave: true,
            cacheManage: true,
            configPersist: true,
            modelScan: true,
            crossOriginIsolated: true,
            clipboardReliable: true,
            arScope: 'none',
        }),
    },
}));

// idb 在 Node/happy-dom 下无 IndexedDB 实现，注入内存 Map 桩隔离浏览器存储依赖。
// 用 Map 使 idbGet/idbSet/idbDelete/idbKeys 可按 store/key 精确配置返回值（ADR-177 Phase 2）。
const _idbStore = new Map<string, unknown>();
vi.mock('./idb', () => ({
    idbGet: vi.fn(async (_store: string, key: string) => _idbStore.get(key)),
    idbSet: vi.fn(async (_store: string, key: string, val: unknown) => {
        _idbStore.set(key, val);
    }),
    idbDelete: vi.fn(async (_store: string, key: string) => {
        _idbStore.delete(key);
    }),
    idbKeys: vi.fn(async (_store: string) => Array.from(_idbStore.keys())),
    closeIDB: vi.fn(),
}));

import JSZip from 'jszip';
import { browserAdapter } from './browser-adapter';
import type { UIState, EnvState } from '@bindings/mikumikuar/internal/app/models';
import { isWebPlatform, isAndroidPlatform, guardExternalAction } from '../platform';

// [doc:adr-177] browser-adapter 扩展方法（Partial 签名便利方法，不在统一 BackendService 接口；
// Go 侧用 SetConfig 统一持久化，浏览器侧提供细粒度 GetUIState/SetUIState/SetEnvState）
interface BrowserAdapterExt {
    GetUIState(): Promise<UIState>;
    SetUIState(s: Partial<UIState>): Promise<void>;
    SetEnvState(e: Partial<EnvState>): Promise<void>;
}
const ext = browserAdapter as unknown as BrowserAdapterExt;

function setWindow(w: unknown): void {
    (globalThis as { window?: unknown }).window = w;
}
function clearWebFlag(): void {
    (globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ = false;
    delete (globalThis as { __MMKU_BACKEND__?: string }).__MMKU_BACKEND__;
}

describe('browserAdapter 能力矩阵', () => {
    it('ar / externalApps / plazaWindow 等原生独占为 false', () => {
        const c = browserAdapter.capabilities();
        expect(c.ar).toBe(false);
        expect(c.externalApps).toBe(false);
        expect(c.plazaWindow).toBe(false);
        expect(c.watchDir).toBe(false);
        expect(c.proxyServer).toBe(false);
    });
    it('浏览器可真实能力为 true', () => {
        const c = browserAdapter.capabilities();
        expect(c.screenshotSave).toBe(true);
        expect(c.cacheManage).toBe(true);
        expect(c.configPersist).toBe(true);
    });
    it('readFileBytes 返回 Uint8Array | null 契约', async () => {
        const r = await browserAdapter.readFileBytes('nope');
        expect(r).toBeNull();
    });
    it('[adr-178] 宿主运行时键：crossOriginIsolated / clipboardReliable / arScope 读运行时自报', () => {
        // 与 browser-adapter `_cap()` 运行时判定完全对齐（不硬编码环境假设）。
        const c = browserAdapter.capabilities();
        const crossOriginIsolatedAtRuntime =
            typeof window !== 'undefined' &&
            (window as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
        const clipboardReliableAtRuntime =
            typeof navigator !== 'undefined' && !!navigator.clipboard;
        const arScopeAtRuntime =
            typeof navigator !== 'undefined' && 'xr' in navigator ? 'webxr' : 'none';
        expect(c.crossOriginIsolated).toBe(crossOriginIsolatedAtRuntime);
        expect(c.clipboardReliable).toBe(clipboardReliableAtRuntime);
        expect(c.arScope).toBe(arScopeAtRuntime);
    });
});

// [doc:adr-177] Phase 2 A4：path 映射 + 默认值 + Delete* + SetEnvState 单源
describe('ADR-177 Phase 2 A4：browser-adapter 数据链补齐', () => {
    beforeEach(() => {
        _idbStore.clear();
    });

    describe('_resolveIdbKey path 映射（readFileBytes）', () => {
        it('绝对路径 → file:<name>（去扩展名）', async () => {
            const bytes = new Uint8Array([1, 2, 3]);
            _idbStore.set('file:Miku', bytes);
            const r = await browserAdapter.readFileBytes('D:/models/Miku.pmx');
            expect(r).toBe(bytes);
        });

        it('已是 file: 前缀 → 原样查', async () => {
            const bytes = new Uint8Array([4, 5]);
            _idbStore.set('file:foo', bytes);
            const r = await browserAdapter.readFileBytes('file:foo');
            expect(r).toBe(bytes);
        });

        it('entry: / recent: 前缀 → 原样查（元数据）', async () => {
            _idbStore.set('entry:Miku', { name: 'Miku', kind: 'pmx' });
            const r = await browserAdapter.readFileBytes('entry:Miku');
            expect(r).toEqual({ name: 'Miku', kind: 'pmx' });
        });

        it('反斜杠路径 → 提取文件名', async () => {
            const bytes = new Uint8Array([6, 7]);
            _idbStore.set('file:test', bytes);
            const r = await browserAdapter.readFileBytes('C:\\models\\test.zip');
            expect(r).toBe(bytes);
        });

        it('查不到 → 返回 null', async () => {
            const r = await browserAdapter.readFileBytes('D:/nonexistent/ghost.pmx');
            expect(r).toBeNull();
        });

        it('web://selected-dir/ 路径 → 剥离类别段后 file:<relIdStem>', async () => {
            const bytes = new Uint8Array([8, 8]);
            _idbStore.set('file:分类1/miku', bytes);
            const r = await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/miku.pmx');
            expect(r).toBe(bytes);
        });

        it('web://selected-dir/ 深层同名 → 各层 key 不冲突', async () => {
            const b1 = new Uint8Array([1, 1]);
            const b2 = new Uint8Array([2, 2]);
            _idbStore.set('file:分类1/miku', b1);
            _idbStore.set('file:分类1/sub/miku', b2);
            expect(
                await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/miku.pmx')
            ).toBe(b1);
            expect(
                await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/sub/miku.pmx')
            ).toBe(b2);
        });

        it('FileExists 经 path 映射', async () => {
            _idbStore.set('file:bar', new Uint8Array([1]));
            expect(await browserAdapter.FileExists('D:/models/bar.pmx')).toBe(true);
            expect(await browserAdapter.FileExists('D:/models/missing.pmx')).toBe(false);
        });
    });

    describe('_defaultConfig / _defaultUIState 默认值', () => {
        it('GetConfig 首次启动返回完整默认值（非 {version:1}）', async () => {
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.config_version).toBe(1);
            expect(cfg.ui_state).toBeDefined();
            expect(cfg.ui_state.scale).toBe(1.0);
            expect(cfg.resource_root).toBe('');
            expect(cfg.storage_mode).toBe('web');
            expect(cfg.override_paths).toBeDefined();
            expect(cfg.override_paths.pmx).toBe('');
        });

        it('GetUIState 首次启动返回完整默认值（非空对象）', async () => {
            const s = await ext.GetUIState();
            expect(s.scale).toBe(1.0);
            expect(s.popupWidth).toBe(280);
            expect(s.accent).toBe('#4a6cf7');
            expect(s.animations).toBe(true);
            expect(s.performanceMode).toBe('balanced');
        });

        it('SetUIState 双写 Config.ui_state + uistate store', async () => {
            await ext.SetUIState({ scale: 1.3 });
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.ui_state.scale).toBe(1.3);
            expect(_idbStore.get('state')).toMatchObject({ scale: 1.3 });
        });
    });

    describe('SetEnvState 单源（Config.env）', () => {
        it('写入 Config.env（非 uistate/envState）', async () => {
            await ext.SetEnvState({ skyMode: 'sunset' });
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.env).toBeDefined();
            expect(cfg.env.skyMode).toBe('sunset');
            // 旧键 uistate/envState 不应存在
            expect(_idbStore.has('envState')).toBe(false);
        });

        it('重复写入合并而非覆盖', async () => {
            await ext.SetEnvState({ skyMode: 'sunset' });
            await ext.SetEnvState({ groundVisible: false });
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.env.skyMode).toBe('sunset');
            expect(cfg.env.groundVisible).toBe(false);
        });
    });

    // [bugfix:web-config-not-persisted] 细粒度 setter 写入路径必须能被
    // 恢复侧 GetConfig()/GetUIState() 读回（round-trip），防止写读路径脱节回归。
    describe('细粒度 setter → Config round-trip（对齐恢复侧读取路径）', () => {
        it('SetUIAccent/Scale/Font 等写入 ui_state，GetUIState 可读回', async () => {
            await browserAdapter.SetUIAccent('#ff0000');
            await browserAdapter.SetUIScale(1.5);
            await browserAdapter.SetUIFontFamily('noto');
            await browserAdapter.SetUIPopupWidth(320);
            await browserAdapter.SetUIAnimations(false);
            await browserAdapter.SetUIBlurBg(false);
            await browserAdapter.SetUIAutoUpdate(true);
            const s = await ext.GetUIState();
            expect(s.accent).toBe('#ff0000');
            expect(s.scale).toBe(1.5);
            expect(s.fontFamily).toBe('noto');
            expect(s.popupWidth).toBe(320);
            expect(s.animations).toBe(false);
            expect(s.blurBg).toBe(false);
            expect(s.autoUpdateEnabled).toBe(true);
        });

        it('SetPerformanceMode(string) 写入 ui_state.performanceMode', async () => {
            await browserAdapter.SetPerformanceMode('performance');
            const s = await ext.GetUIState();
            expect(s.performanceMode).toBe('performance');
        });

        it('SetBlenderPath/SetMMDPath/SetDisplayNamePriority 写入 Config 顶层字段', async () => {
            await browserAdapter.SetBlenderPath('C:/blender.exe');
            await browserAdapter.SetMMDPath('C:/mmd.exe');
            await browserAdapter.SetDisplayNamePriority('name_en');
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.blender_path).toBe('C:/blender.exe');
            expect(cfg.mmd_path).toBe('C:/mmd.exe');
            expect(cfg.display_name_priority).toBe('name_en');
        });

        it('SetOverridePath(category, path) 双参写入 override_paths[category]', async () => {
            await browserAdapter.SetOverridePath('pmx', 'D:/models');
            await browserAdapter.SetOverridePath('vmd', 'D:/motions');
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.override_paths.pmx).toBe('D:/models');
            expect(cfg.override_paths.vmd).toBe('D:/motions');
        });
    });

    describe('Delete*Preset 真实删除', () => {
        it('DeleteEnvPreset 从 presets store 删除', async () => {
            _idbStore.set('env:sunset', new Uint8Array([1]));
            await browserAdapter.DeleteEnvPreset('sunset');
            expect(_idbStore.has('env:sunset')).toBe(false);
        });

        it('DeleteModelPreset 从 presets store 删除', async () => {
            _idbStore.set('model:default', new Uint8Array([2]));
            await browserAdapter.DeleteModelPreset('default');
            expect(_idbStore.has('model:default')).toBe(false);
        });

        it('DeletePresetScene 从 presets store 删除', async () => {
            _idbStore.set('scene:test', new Uint8Array([3]));
            await browserAdapter.DeletePresetScene('test');
            expect(_idbStore.has('scene:test')).toBe(false);
        });
    });
});

describe('③ 原生独占降级契约', () => {
    const blocked = [
        'AddCustomSoftware',
        'ClosePlazaWindow',
        'DownloadFromPlaza',
        'LaunchSoftware',
        'OpenCacheDir',
        'StartProxy',
        'StopProxy',
    ] as const;
    for (const name of blocked) {
        it(`${name} 抛 NotSupportedError`, async () => {
            // @ts-expect-error 动态调用 BackendService 方法
            await expect(browserAdapter[name]()).rejects.toThrow(/浏览器环境下不可用/);
        });
    }
});

describe('guardExternalAction 三态', () => {
    beforeEach(() => {
        setWindow(undefined);
        clearWebFlag();
    });
    it('desktop 放行', () => {
        setWindow({ wails: { platform: () => 'desktop' } });
        expect(guardExternalAction('blender')).toBe(true);
    });
    it('android 拦截', () => {
        setWindow({ wails: { platform: () => 'android' } });
        expect(isAndroidPlatform()).toBe(true);
        expect(guardExternalAction('blender')).toBe(false);
    });
    it('web 拦截', () => {
        setWindow({}); // 无 wails 桥
        expect(isWebPlatform()).toBe(true);
        expect(guardExternalAction('blender')).toBe(false);
    });
});

// [doc:adr-177] Phase 2 A4 剩余项（p2-5）：虚拟目录语义 + 伴生文件加载
describe('ADR-177 Phase 2 A4 p2-5：虚拟目录 + 伴生文件加载', () => {
    beforeEach(() => {
        _idbStore.clear();
    });

    /** 用 JSZip 构造测试 zip 字节。 */
    async function makeZip(files: Record<string, Uint8Array>): Promise<Uint8Array> {
        const zip = new JSZip();
        for (const [name, data] of Object.entries(files)) {
            zip.file(name, data);
        }
        return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer' }));
    }

    describe('IsolateModelDir 虚拟目录', () => {
        it('绝对路径 → web://model/<stem>', async () => {
            expect(await browserAdapter.IsolateModelDir('D:/models/Miku.pmx')).toBe(
                'web://model/Miku'
            );
        });
        it('file: 前缀 → web://model/<stem>', async () => {
            expect(await browserAdapter.IsolateModelDir('file:Miku')).toBe('web://model/Miku');
        });
        it('web://selected-dir/ 路径 → 剥离类别段并编码 web://model/<encRelIdStem>', async () => {
            // [bugfix:tex-stem-collision] stem 含路径维度须 encodeURIComponent，
            // 否则不同目录同名 PMX 的 dir: 纹理键会互相覆盖。
            expect(
                await browserAdapter.IsolateModelDir('web://selected-dir/PMX/分类1/miku.pmx')
            ).toBe(`web://model/${encodeURIComponent('分类1/miku')}`);
        });
    });

    describe('ListDirRecursive 扫描 dir: 前缀', () => {
        it('返回带 relativePath 的 FileInfo[]', async () => {
            _idbStore.set('dir:Miku:tex/face.png', new Uint8Array([1]));
            _idbStore.set('dir:Miku:bg/sky.png', new Uint8Array([2]));
            _idbStore.set('dir:Other:foo.png', new Uint8Array([3]));
            const entries = await browserAdapter.ListDirRecursive('web://model/Miku');
            expect(entries).toHaveLength(2);
            expect(entries).toEqual(
                expect.arrayContaining([
                    { name: 'face.png', relativePath: 'tex/face.png' },
                    { name: 'sky.png', relativePath: 'bg/sky.png' },
                ])
            );
        });

        it('无 dir: 条目 → 返回空数组', async () => {
            const entries = await browserAdapter.ListDirRecursive('web://model/Ghost');
            expect(entries).toEqual([]);
        });

        it('FSA stem 含类别前缀 → bare stem fallback 命中', async () => {
            // FSA 扫描存储 bare stem 键 dir:Miku:tex/face.png，
            // 查询 web://model/分类1/Miku 时精确前缀 miss，fallback 到 bare stem
            _idbStore.set('dir:Miku:tex/face.png', new Uint8Array([10]));
            _idbStore.set('dir:Miku:bg/sky.png', new Uint8Array([20]));
            const entries = await browserAdapter.ListDirRecursive('web://model/分类1/Miku');
            expect(entries).toHaveLength(2);
            expect(entries).toEqual(
                expect.arrayContaining([
                    { name: 'face.png', relativePath: 'tex/face.png' },
                    { name: 'sky.png', relativePath: 'bg/sky.png' },
                ])
            );
        });
    });

    describe('readFileBytes web://model/ 路由', () => {
        it('经虚拟目录路径命中 dir:<stem>:<relPath>', async () => {
            const tex = new Uint8Array([9, 9]);
            _idbStore.set('dir:Miku:tex/face.png', tex);
            const r = await browserAdapter.readFileBytes('web://model/Miku/tex/face.png');
            expect(r).toBe(tex);
        });

        it('dir: 未命中时兜底 file:<baseName>', async () => {
            const tex = new Uint8Array([7]);
            _idbStore.set('file:face', tex); // ExtractZip 扁平键兜底
            const r = await browserAdapter.readFileBytes('web://model/Miku/tex/face.png');
            expect(r).toBe(tex);
        });

        it('FSA stem 含类别前缀 → bare stem fallback 命中', async () => {
            // 模拟真实链路：ListDirRecursive 返回 bare relativePath（tex/face.png），
            // model-loader 拼接 modelDir + '/' + relativePath 后 readFileBytes 查找
            // FSA 扫描存储 dir:Miku:tex/face.png（bare stem），拼接路径精确命中
            const tex = new Uint8Array([11, 12]);
            _idbStore.set('dir:Miku:tex/face.png', tex);
            const r = await browserAdapter.readFileBytes('web://model/分类1/Miku/tex/face.png');
            expect(r).toBe(tex);
        });
    });

    describe('LoadOutfitFile 伴生换装配置', () => {
        it('查 outfit:<stem> 返回 JSON string', async () => {
            const json = '{"version":1,"variants":[]}';
            _idbStore.set('outfit:Miku', new TextEncoder().encode(json));
            const r = await browserAdapter.LoadOutfitFile('web://model/Miku');
            expect(r).toBe(json);
        });

        it('不存在 → 返回空字符串（对齐 Go ("", nil)）', async () => {
            const r = await browserAdapter.LoadOutfitFile('web://model/None');
            expect(r).toBe('');
        });
    });

    describe('LoadSceneFile 三路路由', () => {
        it('预设路径 → presets store scene:<name>', async () => {
            const json = '{"actors":[]}';
            _idbStore.set('scene:myScene', new TextEncoder().encode(json));
            const r = await browserAdapter.LoadSceneFile('web://presets/scenes/myScene');
            expect(r).toBe(json);
        });

        it('bundle 路径 → scenes store bundle:<stem>', async () => {
            const json = '{"actors":[]}';
            _idbStore.set('bundle:MikuPack', new TextEncoder().encode(json));
            const r = await browserAdapter.LoadSceneFile('web://bundle/MikuPack/scene.json');
            expect(r).toBe(json);
        });

        it('兜底走 _resolveIdbKey → file:<stem>', async () => {
            const json = '{"x":1}';
            _idbStore.set('file:foo', new TextEncoder().encode(json));
            const r = await browserAdapter.LoadSceneFile('D:/models/foo.json');
            expect(r).toBe(json);
        });

        it('全部未命中 → 返回空字符串', async () => {
            const r = await browserAdapter.LoadSceneFile('web://presets/scenes/ghost');
            expect(r).toBe('');
        });
    });

    describe('ExtractZip 解压分类落地', () => {
        it('[adr-182] 命名空间 zipStem/pmxStem 存 dir:/outfit: + scene.json 存 bundle:', async () => {
            const pmx = new Uint8Array([1, 2, 3]);
            const tex = new Uint8Array([4, 5]);
            const outfit = new TextEncoder().encode('{"version":1,"variants":[]}');
            const scene = new TextEncoder().encode('{"actors":[]}');
            const zipBytes = await makeZip({
                'Miku.pmx': pmx,
                'tex/face.png': tex,
                'outfits.json': outfit,
                'scene.json': scene,
            });
            // zipPath 'MikuPack.zip' → _resolveIdbKey → 'file:MikuPack'
            _idbStore.set('file:MikuPack', zipBytes);

            const result = await browserAdapter.ExtractZip('MikuPack.zip', '');

            // [adr-182] nsStem = enc(zipStem/pmxStem)，返回 web://model/<nsStem>（非裸 Miku.pmx）
            const ns = encodeURIComponent('MikuPack/Miku');
            expect(result?.file_path).toBe(`web://model/${ns}`);
            expect(result?.dir).toBe('web://bundle/MikuPack');
            // dir: 命名空间纹理组（隔离核心修复）
            expect(_idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(tex);
            // outfit: 命名空间伴生配置
            expect(_idbStore.get(`outfit:${ns}`)).toEqual(outfit);
            // file:<nsStem> PMX 命名空间扁平键（供 readFileBytes 兜底2 命中）
            expect(_idbStore.get(`file:${ns}`)).toEqual(pmx);
            // bundle: scene.json（scenes store，_idbStore 单 Map 忽略 store 维度）
            expect(_idbStore.get('bundle:MikuPack')).toEqual(scene);
            // file:<裸stem> 扁平兜底保留（向后兼容 + 跨模型共享）
            expect(_idbStore.get('file:face')).toEqual(tex);
        });

        it('[adr-182] 不同 zip 内同名 PMX+纹理 → dir: 键互不碰撞，各自精确解析', async () => {
            // 核心回归：packA.zip 与 packB.zip 都含 Miku.pmx + tex/face.png，
            // 旧实现 dir:Miku:tex/face.png 会互相覆盖 → 加载 A 却贴 B 的纹理（静默错渲染）。
            const pmxA = new Uint8Array([0xa1]);
            const texA = new Uint8Array([0xa2]);
            const pmxB = new Uint8Array([0xb1]);
            const texB = new Uint8Array([0xb2]);
            _idbStore.set(
                'file:packA',
                await makeZip({ 'Miku.pmx': pmxA, 'tex/face.png': texA })
            );
            _idbStore.set(
                'file:packB',
                await makeZip({ 'Miku.pmx': pmxB, 'tex/face.png': texB })
            );

            const rA = await browserAdapter.ExtractZip('packA.zip', '');
            const rB = await browserAdapter.ExtractZip('packB.zip', '');

            const nsA = encodeURIComponent('packA/Miku');
            const nsB = encodeURIComponent('packB/Miku');
            expect(rA?.file_path).toBe(`web://model/${nsA}`);
            expect(rB?.file_path).toBe(`web://model/${nsB}`);
            // 纹理键互不碰撞，字节各自正确
            expect(_idbStore.get(`dir:${nsA}:tex/face.png`)).toEqual(texA);
            expect(_idbStore.get(`dir:${nsB}:tex/face.png`)).toEqual(texB);

            // 全链路解析：加载 A 的返回路径 → readFileBytes 取回 A 的 PMX + 纹理（非 B）
            expect(await browserAdapter.readFileBytes(rA!.file_path)).toEqual(pmxA);
            const dirA = await browserAdapter.IsolateModelDir(rA!.file_path);
            expect(dirA).toBe(`web://model/${nsA}`); // 幂等，不双重编码
            expect(await browserAdapter.readFileBytes(`${dirA}/tex/face.png`)).toEqual(texA);
            // 对称验证 B
            expect(await browserAdapter.readFileBytes(rB!.file_path)).toEqual(pmxB);
            const dirB = await browserAdapter.IsolateModelDir(rB!.file_path);
            expect(await browserAdapter.readFileBytes(`${dirB}/tex/face.png`)).toEqual(texB);
        });

        it('[adr-182] IsolateModelDir 幂等：web://model/<enc> 输入不二次编码', async () => {
            const enc = encodeURIComponent('packA/Miku'); // packA%2FMiku
            expect(await browserAdapter.IsolateModelDir(`web://model/${enc}`)).toBe(
                `web://model/${enc}`
            );
        });

        it('无 PMX 时 mainPmx 为空，dir: 不写', async () => {
            const tex = new Uint8Array([1]);
            const zipBytes = await makeZip({ 'tex/face.png': tex });
            _idbStore.set('file:TexOnly', zipBytes);
            const result = await browserAdapter.ExtractZip('TexOnly.zip', '');
            expect(result?.file_path).toBe('');
            expect(_idbStore.has('dir::tex/face.png')).toBe(false);
            expect(_idbStore.get('file:face')).toEqual(tex);
        });

        it('[bugfix:zip-pmx-subdir] PMX 在 zip 子目录时贴图能被正确读取（relPath 相对 PMX）', async () => {
            // 复现：zip 内 `char/Miku.pmx` + `char/tex/face.png` + `char/tex/body.png`。
            // 旧实现写 `dir:<ns>:char/tex/face.png`（zip 内完整路径），
            // babylon-mmd 拼 `web://model/<ns>/tex/face.png`（相对 PMX）→ 维度失配 → 贴图读不到。
            // 修复后写 `dir:<ns>:tex/face.png`（剥掉 PMX 目录前缀），与读取维度一致。
            const pmx = new Uint8Array([1, 2, 3]);
            const faceTex = new Uint8Array([10, 20]);
            const bodyTex = new Uint8Array([30, 40, 50]);
            const zipBytes = await makeZip({
                'char/Miku.pmx': pmx,
                'char/tex/face.png': faceTex,
                'char/tex/body.png': bodyTex,
            });
            _idbStore.set('file:CharPack', zipBytes);

            const result = await browserAdapter.ExtractZip('CharPack.zip', '');

            const ns = encodeURIComponent('CharPack/Miku');
            expect(result?.file_path).toBe(`web://model/${ns}`);

            // 写入键的 relPath 已剥掉 PMX 子目录前缀 `char/`
            expect(_idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(faceTex);
            expect(_idbStore.get(`dir:${ns}:tex/body.png`)).toEqual(bodyTex);
            // 不应残留带子目录前缀的旧键（旧实现的 bug 形态）
            expect(_idbStore.has(`dir:${ns}:char/tex/face.png`)).toBe(false);

            // 全链路：IsolateModelDir + ListDirRecursive + readFileBytes 都能取到正确字节
            const dir = await browserAdapter.IsolateModelDir(result!.file_path);
            const entries = await browserAdapter.ListDirRecursive(dir);
            const relPaths = entries.map((e) => e.relativePath);
            expect(relPaths).toContain('tex/face.png');
            expect(relPaths).toContain('tex/body.png');
            expect(relPaths).not.toContain('char/tex/face.png'); // 旧 bug 形态
            // babylon-mmd 拼接路径形态（web://model/<ns>/tex/face.png）能命中
            expect(await browserAdapter.readFileBytes(`${dir}/tex/face.png`)).toEqual(faceTex);
            expect(await browserAdapter.readFileBytes(`${dir}/tex/body.png`)).toEqual(bodyTex);
        });

        it('[bugfix:zip-pmx-subdir] zip 内多个 PMX 在不同子目录，加载指定 PMX 只读对应子目录贴图', async () => {
            // 多 PMX zip：`A/Miku.pmx` + `A/tex/face.png` + `B/Miku.pmx` + `B/tex/face.png`。
            // 通过 innerPath 定位 B/Miku.pmx，期望 B 的贴图被读、A 的贴图不污染命名空间。
            const pmxA = new Uint8Array([0xa1]);
            const texA = new Uint8Array([0xa2]);
            const pmxB = new Uint8Array([0xb1]);
            const texB = new Uint8Array([0xb2]);
            const zipBytes = await makeZip({
                'A/Miku.pmx': pmxA,
                'A/tex/face.png': texA,
                'B/Miku.pmx': pmxB,
                'B/tex/face.png': texB,
            });
            _idbStore.set('file:MultiPack', zipBytes);

            // 加载 B 子目录的 Miku.pmx
            const result = await browserAdapter.ExtractZip('MultiPack.zip', 'B/Miku.pmx');

            const ns = encodeURIComponent('MultiPack/Miku');
            expect(result?.file_path).toBe(`web://model/${ns}`);

            // B 子目录的贴图写入命名空间，且 relPath 剥掉 B/ 前缀
            expect(_idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(texB);
            // A 子目录的贴图不应污染命名空间（旧实现会写入 dir:<ns>:A/tex/face.png 覆盖 B 的同 relPath 键）
            expect(_idbStore.has(`dir:${ns}:A/tex/face.png`)).toBe(false);

            // 全链路：加载 B 路径，读到 B 的贴图（非 A 的）
            const dir = await browserAdapter.IsolateModelDir(result!.file_path);
            const got = await browserAdapter.readFileBytes(`${dir}/tex/face.png`);
            expect(got).toEqual(texB);
            expect(got).not.toEqual(texA);

            // 反向验证：加载 A 子目录的 Miku.pmx，读到 A 的贴图
            _idbStore.clear();
            _idbStore.set('file:MultiPack', zipBytes);
            const rA = await browserAdapter.ExtractZip('MultiPack.zip', 'A/Miku.pmx');
            const dirA = await browserAdapter.IsolateModelDir(rA!.file_path);
            const gotA = await browserAdapter.readFileBytes(`${dirA}/tex/face.png`);
            expect(gotA).toEqual(texA);
            expect(gotA).not.toEqual(texB);
        });

        it('[bugfix:zip-pmx-subdir] outfits.json 仅与 PMX 同子目录时写入命名空间', async () => {
            // zip 内：`char/Miku.pmx` + `char/outfits.json` + `other/outfits.json`。
            // 期望：仅 char/outfits.json 写入 outfit:<ns>，other/ 不污染。
            const pmx = new Uint8Array([1]);
            const charOutfit = new TextEncoder().encode('{"version":1,"tag":"char"}');
            const otherOutfit = new TextEncoder().encode('{"version":1,"tag":"other"}');
            const zipBytes = await makeZip({
                'char/Miku.pmx': pmx,
                'char/outfits.json': charOutfit,
                'other/outfits.json': otherOutfit,
            });
            _idbStore.set('file:OutfitPack', zipBytes);

            const result = await browserAdapter.ExtractZip('OutfitPack.zip', '');
            const ns = encodeURIComponent('OutfitPack/Miku');

            // 仅 char/outfits.json 写入命名空间
            expect(_idbStore.get(`outfit:${ns}`)).toEqual(charOutfit);
            expect(_idbStore.get(`outfit:${ns}`)).not.toEqual(otherOutfit);
        });

        it('[bugfix:zip-pmx-subdir] innerPath 用反斜杠分隔时同样能定位 PMX', async () => {
            // 兼容 Windows 反斜杠：调用方可能传 'char\\Miku.pmx'。
            const pmx = new Uint8Array([1]);
            const tex = new Uint8Array([2]);
            const zipBytes = await makeZip({
                'char/Miku.pmx': pmx,
                'char/tex/face.png': tex,
            });
            _idbStore.set('file:BackslashPack', zipBytes);

            const result = await browserAdapter.ExtractZip('BackslashPack.zip', 'char\\Miku.pmx');
            const ns = encodeURIComponent('BackslashPack/Miku');
            expect(result?.file_path).toBe(`web://model/${ns}`);
            expect(_idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(tex);
        });
    });
});

describe('resolveBackend 三路径（异步选型，Android 冷启动竞态防护）', () => {
    beforeEach(() => {
        setWindow(undefined);
        clearWebFlag();
        vi.useRealTimers();
    });

    it('Web 入口短路 → browserAdapter', async () => {
        vi.resetModules();
        (globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ = true;
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('browser');
    });

    it('Tier0 显式 __MMKU_BACKEND__=browser 即便 window.wails 存在仍走 browserAdapter', async () => {
        vi.resetModules();
        (globalThis as { __MMKU_BACKEND__?: string }).__MMKU_BACKEND__ = 'browser';
        setWindow({ wails: { platform: () => 'desktop' } });
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('browser');
    });

    it('Tier0 显式 __MMKU_BACKEND__=go 且 wails 就绪 → goAdapter', async () => {
        vi.resetModules();
        (globalThis as { __MMKU_BACKEND__?: string }).__MMKU_BACKEND__ = 'go';
        setWindow({ wails: { platform: () => 'desktop' } });
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('go');
    });

    it('window.wails 存在 → goAdapter', async () => {
        vi.resetModules();
        setWindow({ wails: { platform: () => 'desktop' } });
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('go');
    });

    it('无 wails 且非 web → awaitWailsBridge 超时后回退 browserAdapter', async () => {
        vi.resetModules();
        setWindow({}); // 无 wails
        vi.useFakeTimers();
        const { resolveBackend } = await import('./index');
        const p = resolveBackend();
        vi.advanceTimersByTime(3100);
        const b = await p;
        vi.useRealTimers();
        expect(b.kind).toBe('browser');
    });
});

// [doc:test] P1 修复回归：FSA 目录扫描需保留嵌套层级，且不同子目录的同名文件互不覆盖
describe('FSA 目录扫描嵌套结构（保留目录层级 + 同名不覆盖）', () => {
    interface FakeNode {
        name: string;
        kind: 'directory' | 'file';
        bytes?: Uint8Array;
        children?: FakeNode[];
    }
    function buildFakeTree(node: FakeNode): unknown {
        return {
            name: node.name,
            kind: 'directory',
            async *values() {
                for (const c of node.children ?? []) {
                    if (c.kind === 'file') {
                        yield {
                            kind: 'file',
                            name: c.name,
                            getFile: async () => ({
                                arrayBuffer: async () => (c.bytes ?? new Uint8Array()).buffer,
                            }),
                        };
                    } else {
                        yield buildFakeTree(c);
                    }
                }
            },
            async getDirectoryHandle(name: string) {
                const c = (node.children ?? []).find(
                    (x) => x.name === name && x.kind === 'directory'
                );
                if (!c) throw new Error('no such dir ' + name);
                return buildFakeTree(c);
            },
        };
    }

    beforeEach(() => {
        _idbStore.clear();
    });

    it('嵌套目录 → entry.dir 保留层级，同名 miku.pmx 不互相覆盖', async () => {
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [
                { kind: 'file', name: 'test.pmx', bytes: new Uint8Array([1, 2]) },
                {
                    kind: 'directory',
                    name: '分类1',
                    children: [
                        { kind: 'file', name: 'miku.pmx', bytes: new Uint8Array([3, 4]) },
                        {
                            kind: 'directory',
                            name: 'sub',
                            children: [
                                { kind: 'file', name: 'miku.pmx', bytes: new Uint8Array([5, 6]) },
                            ],
                        },
                    ],
                },
            ],
        }) as FileSystemDirectoryHandle;
        setWindow({ showDirectoryPicker: async () => root });
        await browserAdapter.SelectDir();

        const models = await browserAdapter.GetLibraryIndex();
        const byPath = new Map(models.map((m) => [m.file_path, m]));

        // 根 pmx → web://selected-dir/PMX（扁平子集仍工作）
        expect(byPath.get('web://selected-dir/PMX/test.pmx')?.dir).toBe('web://selected-dir/PMX');
        // 分类1/miku → 嵌套 dir
        const m1 = byPath.get('web://selected-dir/PMX/分类1/miku.pmx');
        expect(m1?.dir).toBe('web://selected-dir/PMX/分类1');
        // 分类1/sub/miku → 更深嵌套，独立 entry（同名不覆盖）
        const m2 = byPath.get('web://selected-dir/PMX/分类1/sub/miku.pmx');
        expect(m2?.dir).toBe('web://selected-dir/PMX/分类1/sub');
        expect(m1).not.toBe(m2);

        // readFileBytes 经类别段剥离正确命中各自字节
        expect(await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/miku.pmx')).toEqual(
            new Uint8Array([3, 4])
        );
        expect(
            await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/sub/miku.pmx')
        ).toEqual(new Uint8Array([5, 6]));
    });

    it('[p2b] 子目录纹理 → 按相对 PMX 路径写入 dir:<stem>:<relPath>，readFileBytes 精确命中', async () => {
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [
                {
                    kind: 'directory',
                    name: 'PMX',
                    children: [
                        { kind: 'file', name: 'miku.pmx', bytes: new Uint8Array([9, 9]) },
                        { kind: 'file', name: 'toon.png', bytes: new Uint8Array([1, 1]) },
                        {
                            kind: 'directory',
                            name: 'tex',
                            children: [
                                { kind: 'file', name: 'face.png', bytes: new Uint8Array([2, 2]) },
                            ],
                        },
                    ],
                },
            ],
        }) as FileSystemDirectoryHandle;
        setWindow({ showDirectoryPicker: async () => root });
        await browserAdapter.SelectDir();

        // 子目录纹理按相对 PMX 路径落地：dir:<stem>:<relToPmx>/<name>
        expect(_idbStore.get('dir:miku:tex/face.png')).toEqual(new Uint8Array([2, 2]));
        // 同层纹理仍按 basename 落地（相对 PMX 路径为空）：dir:<stem>:<name>
        expect(_idbStore.get('dir:miku:toon.png')).toEqual(new Uint8Array([1, 1]));
        // 旧实现错存键 dir:<stem>:<name>（丢子目录）应不存在
        expect(_idbStore.get('dir:miku:face.png')).toBeUndefined();

        // 读取侧：web://model/<stem>/<relPath> 精确路由到 dir:<stem>:<relPath>
        expect(await browserAdapter.readFileBytes('web://model/miku/tex/face.png')).toEqual(
            new Uint8Array([2, 2])
        );
        expect(await browserAdapter.readFileBytes('web://model/miku/toon.png')).toEqual(
            new Uint8Array([1, 1])
        );
    });

    it('[adr-180] SelectDir 后持久化 fsaRootHandle 到 IndexedDB', async () => {
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [{ kind: 'file', name: 'm.pmx', bytes: new Uint8Array([1]) }],
        });
        setWindow({ showDirectoryPicker: async () => root });
        await browserAdapter.SelectDir();
        expect(_idbStore.get('fsaRootHandle')).toBe(root);
    });

    it('[adr-180] ScanModelDir 从持久化句柄自动重扫，覆盖旧塌缩 entry', async () => {
        // 隔离模块状态：fresh import 使 _fsaRootHandle 重置为 null，专测「恢复」路径。
        vi.resetModules();
        const { browserAdapter: fresh } = await import('./browser-adapter');
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [
                {
                    kind: 'directory',
                    name: 'PMX',
                    children: [{ kind: 'file', name: 'miku.pmx', bytes: new Uint8Array([9, 9]) }],
                },
            ],
        }) as FileSystemDirectoryHandle & {
            queryPermission: (o: { mode: string }) => Promise<string>;
        };
        root.queryPermission = async () => 'granted';
        // 预置持久化句柄 + 一个旧版塌缩 entry（平铺、字段齐全，_listModels 过滤不掉）。
        _idbStore.set('fsaRootHandle', root);
        _idbStore.set('entry:foo', {
            dir: 'web://selected-dir/PMX',
            file_path: 'web://selected-dir/PMX/foo.pmx',
            name: 'foo',
            fileName: 'foo.pmx',
            type: 'actor',
            format: 'pmx',
            container: 'file',
            kind: 'pmx',
            size: 1,
            savedAt: Date.now(),
        });
        const models = await fresh.ScanModelDir();
        // 根重扫先清旧：旧平铺 entry 必须消失
        expect(_idbStore.get('entry:foo')).toBeUndefined();
        // 新嵌套 entry 来自重扫
        const byPath = new Map(models.map((m) => [m.file_path, m]));
        expect(byPath.get('web://selected-dir/PMX/miku.pmx')?.dir).toBe('web://selected-dir/PMX');
    });

    it('[adr-180] 根重扫不误删用户导入模型（无 dir 的 import entry 与 file:/dir: 保留）', async () => {
        const root = buildFakeTree({
            name: 'models',
            kind: 'directory',
            children: [{ kind: 'file', name: 'm.pmx', bytes: new Uint8Array([1]) }],
        });
        setWindow({ showDirectoryPicker: async () => root });
        // 预置用户导入模型（SelectImportFile 写入：entry 无 dir，file:/dir: 与扫描同命名空间）。
        _idbStore.set('entry:importedMiku', {
            file_path: 'web://import/importedMiku.pmx',
            name: 'importedMiku',
            fileName: 'importedMiku.pmx',
            type: 'actor',
            format: 'pmx',
            container: 'file',
            kind: 'pmx',
            size: 2,
            savedAt: Date.now(),
        });
        _idbStore.set('file:importedMiku', new Uint8Array([7, 7]));
        _idbStore.set('dir:importedMiku:toon.png', new Uint8Array([8, 8]));

        await browserAdapter.SelectDir(); // 触发根重扫（清旧）

        // 导入模型索引 entry 必须保留（无 dir → 不被 _clearScannedEntries 命中）
        expect(_idbStore.get('entry:importedMiku')).toBeDefined();
        // 导入模型字节与纹理保留
        expect(_idbStore.get('file:importedMiku')).toEqual(new Uint8Array([7, 7]));
        expect(_idbStore.get('dir:importedMiku:toon.png')).toEqual(new Uint8Array([8, 8]));
        // FSA 扫描写入的新 entry 同时存在
        expect(_idbStore.get('entry:m')).toBeDefined();
    });
});

// [doc:adr-179] P3-2：适配器 CheckForUpdate / DownloadApk 返回值形状断言
describe('ADR-179 更新安装 — browser-adapter 形状', () => {
    it('CheckForUpdate 返回字段与 Go UpdateCheckResult 对齐', async () => {
        const r = await browserAdapter.CheckForUpdate();
        // 必含字段（字段名与 Go JSON tag 严格对齐）
        expect(r).toHaveProperty('current');
        expect(r).toHaveProperty('latest');
        expect(r).toHaveProperty('available');
        expect(r).toHaveProperty('url');
        expect(r).toHaveProperty('checkedAt');
        expect(r).toHaveProperty('downloadUrl');
        expect(r).toHaveProperty('assetName');
        expect(r).toHaveProperty('size');
        expect(r).toHaveProperty('error');
        // web 端恒定
        expect(r.available).toBe(false);
        expect(r.downloadUrl).toBe('');
    });

    it('DownloadApk 返回 InstallResult 形状', async () => {
        const r = await browserAdapter.DownloadApk();
        expect(r).not.toBeNull();
        expect(r).toHaveProperty('localPath');
        expect(r).toHaveProperty('success');
        expect(r).toHaveProperty('error');
        // web 端恒定不成功
        expect(r!.success).toBe(false);
    });
});
