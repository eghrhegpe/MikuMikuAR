// [doc:test] ADR-179 更新安装（拆自 backend.test.ts）
import { describe, it, expect, vi } from 'vitest';

vi.mock('./go-adapter', () => ({ goAdapter: {} }));
vi.mock('./idb', () => ({
    idbGet: vi.fn(),
    idbSet: vi.fn(),
    idbDelete: vi.fn(),
    idbKeys: vi.fn(),
    closeIDB: vi.fn(),
}));

import { browserAdapter } from './browser-adapter';

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
