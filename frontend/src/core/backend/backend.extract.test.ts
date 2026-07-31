// [doc:test] ADR-177 Phase 2 A4 p2-5 伴生文件 + ExtractZip（拆自 backend.test.ts）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { idbStore, resetIdb } from './backend-mocks';

vi.mock('./go-adapter', () => ({ goAdapter: {} }));
vi.mock('./idb', () => ({
    idbGet: vi.fn(async (_store: string, key: string) => idbStore.get(key)),
    idbSet: vi.fn(async (_store: string, key: string, val: unknown) => {
        idbStore.set(key, val);
    }),
    idbDelete: vi.fn(async (_store: string, key: string) => {
        idbStore.delete(key);
    }),
    idbKeys: vi.fn(async (_store: string) => Array.from(idbStore.keys())),
    closeIDB: vi.fn(),
}));

import { zipSync } from 'fflate';
import { browserAdapter } from './browser-adapter';

describe('ADR-177 Phase 2 A4 p2-5：虚拟目录 + 伴生文件加载（续）', () => {
    beforeEach(() => {
        resetIdb();
    });

    /** 用 fflate zipSync 构造测试 zip 字节。 */
    async function makeZip(files: Record<string, Uint8Array>): Promise<Uint8Array> {
        return zipSync(files);
    }

    describe('LoadOutfitFile 伴生换装配置', () => {
        it('查 outfit:<stem> 返回 JSON string', async () => {
            const json = '{"version":1,"variants":[]}';
            idbStore.set('outfit:Miku', new TextEncoder().encode(json));
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
            idbStore.set('scene:myScene', new TextEncoder().encode(json));
            const r = await browserAdapter.LoadSceneFile('web://presets/scenes/myScene');
            expect(r).toBe(json);
        });

        it('bundle 路径 → scenes store bundle:<stem>', async () => {
            const json = '{"actors":[]}';
            idbStore.set('bundle:MikuPack', new TextEncoder().encode(json));
            const r = await browserAdapter.LoadSceneFile('web://bundle/MikuPack/scene.json');
            expect(r).toBe(json);
        });

        it('兜底走 _resolveIdbKey → file:<stem>', async () => {
            const json = '{"x":1}';
            idbStore.set('file:foo', new TextEncoder().encode(json));
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
            idbStore.set('file:MikuPack', zipBytes);

            const result = await browserAdapter.ExtractZip('MikuPack.zip', '');

            // [adr-182] nsStem = enc(zipStem/pmxStem)，返回 web://model/<nsStem>（非裸 Miku.pmx）
            const ns = encodeURIComponent('MikuPack/Miku');
            expect(result?.file_path).toBe(`web://model/${ns}`);
            expect(result?.dir).toBe('web://bundle/MikuPack');
            // dir: 命名空间纹理组（隔离核心修复）
            expect(idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(tex);
            // outfit: 命名空间伴生配置
            expect(idbStore.get(`outfit:${ns}`)).toEqual(outfit);
            // file:<nsStem> PMX 命名空间扁平键（供 readFileBytes 兜底2 命中）
            expect(idbStore.get(`file:${ns}`)).toEqual(pmx);
            // bundle: scene.json（scenes store，idbStore 单 Map 忽略 store 维度）
            expect(idbStore.get('bundle:MikuPack')).toEqual(scene);
            // file:<裸stem> 扁平兜底保留（向后兼容 + 跨模型共享）
            expect(idbStore.get('file:face')).toEqual(tex);
        });

        it('[adr-182] 不同 zip 内同名 PMX+纹理 → dir: 键互不碰撞，各自精确解析', async () => {
            // 核心回归：packA.zip 与 packB.zip 都含 Miku.pmx + tex/face.png，
            // 旧实现 dir:Miku:tex/face.png 会互相覆盖 → 加载 A 却贴 B 的纹理（静默错渲染）。
            const pmxA = new Uint8Array([0xa1]);
            const texA = new Uint8Array([0xa2]);
            const pmxB = new Uint8Array([0xb1]);
            const texB = new Uint8Array([0xb2]);
            idbStore.set('file:packA', await makeZip({ 'Miku.pmx': pmxA, 'tex/face.png': texA }));
            idbStore.set('file:packB', await makeZip({ 'Miku.pmx': pmxB, 'tex/face.png': texB }));

            const rA = await browserAdapter.ExtractZip('packA.zip', '');
            const rB = await browserAdapter.ExtractZip('packB.zip', '');

            const nsA = encodeURIComponent('packA/Miku');
            const nsB = encodeURIComponent('packB/Miku');
            expect(rA?.file_path).toBe(`web://model/${nsA}`);
            expect(rB?.file_path).toBe(`web://model/${nsB}`);
            // 纹理键互不碰撞，字节各自正确
            expect(idbStore.get(`dir:${nsA}:tex/face.png`)).toEqual(texA);
            expect(idbStore.get(`dir:${nsB}:tex/face.png`)).toEqual(texB);

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
            idbStore.set('file:TexOnly', zipBytes);
            const result = await browserAdapter.ExtractZip('TexOnly.zip', '');
            expect(result?.file_path).toBe('');
            expect(idbStore.has('dir::tex/face.png')).toBe(false);
            expect(idbStore.get('file:face')).toEqual(tex);
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
            idbStore.set('file:CharPack', zipBytes);

            const result = await browserAdapter.ExtractZip('CharPack.zip', '');

            const ns = encodeURIComponent('CharPack/Miku');
            expect(result?.file_path).toBe(`web://model/${ns}`);

            // 写入键的 relPath 已剥掉 PMX 子目录前缀 `char/`
            expect(idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(faceTex);
            expect(idbStore.get(`dir:${ns}:tex/body.png`)).toEqual(bodyTex);
            // 不应残留带子目录前缀的旧键（旧实现的 bug 形态）
            expect(idbStore.has(`dir:${ns}:char/tex/face.png`)).toBe(false);

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
            idbStore.set('file:MultiPack', zipBytes);

            // 加载 B 子目录的 Miku.pmx
            const result = await browserAdapter.ExtractZip('MultiPack.zip', 'B/Miku.pmx');

            const ns = encodeURIComponent('MultiPack/Miku');
            expect(result?.file_path).toBe(`web://model/${ns}`);

            // B 子目录的贴图写入命名空间，且 relPath 剥掉 B/ 前缀
            expect(idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(texB);
            // A 子目录的贴图不应污染命名空间（旧实现会写入 dir:<ns>:A/tex/face.png 覆盖 B 的同 relPath 键）
            expect(idbStore.has(`dir:${ns}:A/tex/face.png`)).toBe(false);

            // 全链路：加载 B 路径，读到 B 的贴图（非 A 的）
            const dir = await browserAdapter.IsolateModelDir(result!.file_path);
            const got = await browserAdapter.readFileBytes(`${dir}/tex/face.png`);
            expect(got).toEqual(texB);
            expect(got).not.toEqual(texA);

            // 反向验证：加载 A 子目录的 Miku.pmx，读到 A 的贴图
            idbStore.clear();
            idbStore.set('file:MultiPack', zipBytes);
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
            idbStore.set('file:OutfitPack', zipBytes);

            await browserAdapter.ExtractZip('OutfitPack.zip', '');
            const ns = encodeURIComponent('OutfitPack/Miku');

            // 仅 char/outfits.json 写入命名空间
            expect(idbStore.get(`outfit:${ns}`)).toEqual(charOutfit);
            expect(idbStore.get(`outfit:${ns}`)).not.toEqual(otherOutfit);
        });

        it('[bugfix:zip-pmx-subdir] innerPath 用反斜杠分隔时同样能定位 PMX', async () => {
            // 兼容 Windows 反斜杠：调用方可能传 'char\\Miku.pmx'。
            const pmx = new Uint8Array([1]);
            const tex = new Uint8Array([2]);
            const zipBytes = await makeZip({
                'char/Miku.pmx': pmx,
                'char/tex/face.png': tex,
            });
            idbStore.set('file:BackslashPack', zipBytes);

            const result = await browserAdapter.ExtractZip('BackslashPack.zip', 'char\\Miku.pmx');
            const ns = encodeURIComponent('BackslashPack/Miku');
            expect(result?.file_path).toBe(`web://model/${ns}`);
            expect(idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(tex);
        });

        it('[fflate-migration] UTF-8 中文文件名的 ZIP 能正确解压（gpf bit 11 设置 → UTF-8 键）', async () => {
            // 验证 parseZipCentralDir 的 fflateKey 对齐 fflate unzipSync 的键生成逻辑。
            // fflate zipSync 构造的 ZIP 默认设置 gpf bit 11（UTF-8），unzipSync 用 UTF-8 解码键。
            // 旧代码始终用 Latin-1 解码 rawName 作为键 → 对 UTF-8 多字节字符匹配失败。
            // 修复后 fflateKey 检查 bit 11，选择 UTF-8 解码，与 unzipSync 一致。
            const pmx = new Uint8Array([1, 2, 3]);
            const tex = new Uint8Array([4, 5]);
            const zipBytes = zipSync({
                '美希.pmx': pmx,
                'tex/face.png': tex,
            });
            idbStore.set('file:CnPack', zipBytes);

            const result = await browserAdapter.ExtractZip('CnPack.zip', '');
            // bit 11 设置 → parseZipCentralDir 用 UTF-8 解码 → 正确文件名「美希」
            const ns = encodeURIComponent('CnPack/美希');
            expect(result?.file_path).toBe(`web://model/${ns}`);
            // fflateKey = UTF-8 解码 → 与 unzipSync 键匹配 → 数据取回成功
            expect(idbStore.get(`dir:${ns}:tex/face.png`)).toEqual(tex);
            expect(idbStore.get(`file:${ns}`)).toEqual(pmx);
        });
    });
});
