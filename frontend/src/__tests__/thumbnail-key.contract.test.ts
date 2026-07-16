// thumbnail-key.contract.test.ts — 缩略图 key 双源对齐契约（防反弹熔断丝）
//
// 断言：同一逻辑模型的「写侧视图」(model-loader captureThumbnail 视角) 与
// 「读侧视图」(library-core thumbnailKeyForModel 视角) 生成的缓存 key 必须逐字节相等。
// 任何一侧漂移（baseKey 规则、isStage 判定、res/aspect 拼接）都会让本测试红。

import { describe, it, expect } from 'vitest';
import {
    thumbnailBaseKey,
    libraryModelBaseKey,
    buildThumbnailKey,
} from '../scene/manager/thumbnail-key';
import { isStageLike } from '../core/utils';
import type { LibraryModel } from '../core/types';

function libModel(over: Partial<LibraryModel>): LibraryModel {
    return {
        dir: '',
        file_path: '',
        name_jp: '',
        name_en: '',
        comment: '',
        has_thumb: false,
        type: 'actor',
        format: 'pmx',
        container: 'file',
        zip_inner: '',
        category: '',
        source: '',
        ...over,
    } as LibraryModel;
}

describe('thumbnail key 双源对齐契约', () => {
    // 写侧 captureThumbnail 的 libraryPath 恒等于库点击传入的 m.file_path（library-actions.ts:299）
    const cases: Array<{ name: string; file_path: string; innerPath?: string; type: string }> = [
        { name: 'actor 普通模型', file_path: '/lib/a.pmx', type: 'actor' },
        { name: 'stage 普通模型', file_path: '/lib/s.pmx', type: 'stage' },
        { name: 'prop 道具', file_path: '/lib/p.pmx', type: 'prop' },
        { name: 'zip 内 actor', file_path: '/lib/m.zip', innerPath: 'models/a.pmx', type: 'actor' },
        { name: 'zip 内 stage', file_path: '/lib/m.zip', innerPath: 'stage/s.pmx', type: 'stage' },
        { name: 'zip 内 prop', file_path: '/lib/m.zip', innerPath: 'props/p.pmx', type: 'prop' },
    ];

    for (const c of cases) {
        it(`write key === read key（${c.name}）`, () => {
            // 写侧：libraryPath 来自库点击 = m.file_path；filePath 为解压临时路径（≠ file_path）
            const writeBase = thumbnailBaseKey({
                libraryPath: c.file_path,
                filePath: `/tmp/${c.file_path.split('/').pop()}`,
                innerPath: c.innerPath,
            });
            const writeKey = buildThumbnailKey({
                baseKey: writeBase,
                isStage: isStageLike(c.type),
                resolution: 512,
            });

            // 读侧：LibraryModel
            const m = libModel({
                file_path: c.file_path,
                type: c.type,
                container: c.innerPath ? 'zip' : 'file',
                zip_inner: c.innerPath ?? '',
            });
            const readBase = libraryModelBaseKey(m);
            const readKey = buildThumbnailKey({
                baseKey: readBase,
                isStage: isStageLike(m.type),
                resolution: 512,
            });

            expect(writeKey).toBe(readKey);
        });
    }
});

describe('道具写侧经 thumbnailBaseKey 收口（与 model-loader 同源自洽）', () => {
    // props.ts:157 实际调用：renderPropThumbnail(scene, inst, thumbnailBaseKey({ filePath: inst.filePath }))
    // 读侧 library-core 经 libraryModelBaseKey(m)（m.type='prop' → 16/9）。
    // 道具无 innerPath（不支持 zip 内）；库加载时 req.path === m.file_path（load-manager.ts:97/103）。
    const propPaths = ['/lib/p.pmx', '/models/desk.glb', '/r/chair.obj'];

    for (const p of propPaths) {
        it(`prop write key === read key（${p}）`, () => {
            // 写侧：props.ts 实际代码（无 libraryPath，仅 filePath）
            const writeKey = buildThumbnailKey({
                baseKey: thumbnailBaseKey({ filePath: p }),
                isStage: isStageLike('prop'),
                resolution: 512,
            });

            // 读侧：LibraryModel（type='prop'，container 通常为 'file'）
            const m = libModel({ file_path: p, type: 'prop', container: 'file', zip_inner: '' });
            const readKey = buildThumbnailKey({
                baseKey: libraryModelBaseKey(m),
                isStage: isStageLike(m.type),
                resolution: 512,
            });

            expect(writeKey).toBe(readKey);
        });
    }

    it('道具无 innerPath：写侧与读侧均不含 zip_inner 段', () => {
        const writeBase = thumbnailBaseKey({ filePath: '/lib/p.pmx' });
        expect(writeBase).toBe('/lib/p.pmx');
        const m = libModel({ file_path: '/lib/p.pmx', type: 'prop', container: 'file', zip_inner: '' });
        expect(libraryModelBaseKey(m)).toBe('/lib/p.pmx');
    });
});

describe('thumbnailBaseKey 规则', () => {
    it('普通模型：libraryPath 优先且回退 filePath', () => {
        expect(thumbnailBaseKey({ libraryPath: '/lib/a.pmx', filePath: '/tmp/a.pmx' })).toBe('/lib/a.pmx');
        expect(thumbnailBaseKey({ filePath: '/tmp/a.pmx' })).toBe('/tmp/a.pmx');
    });

    it('zip 模型：追加 innerPath', () => {
        expect(
            thumbnailBaseKey({ libraryPath: '/lib/m.zip', filePath: '/tmp/m.zip', innerPath: 'models/a.pmx' })
        ).toBe('/lib/m.zip::models/a.pmx');
    });

    it('libraryPath 与 filePath 相等时仍用 filePath（无冗余）', () => {
        expect(thumbnailBaseKey({ libraryPath: '/lib/a.pmx', filePath: '/lib/a.pmx' })).toBe('/lib/a.pmx');
    });
});

describe('buildThumbnailKey 规则', () => {
    it('aspect 由 isStage 决定：横屏 16/9 / 竖屏 2/3', () => {
        expect(buildThumbnailKey({ baseKey: 'k', isStage: true, resolution: 512 })).toBe('k::512::16/9');
        expect(buildThumbnailKey({ baseKey: 'k', isStage: false, resolution: 512 })).toBe('k::512::2/3');
    });

    it('resolution 缺省回退 512', () => {
        expect(buildThumbnailKey({ baseKey: 'k', isStage: false })).toBe('k::512::2/3');
    });

    it('不同分辨率视为独立条目', () => {
        expect(buildThumbnailKey({ baseKey: 'k', isStage: false, resolution: 1024 })).toBe('k::1024::2/3');
    });
});
