import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normPath, encodeFileRef } from '../core/fileservice';

// Mock ../core/wails-bindings BEFORE importing fileservice
// Wails 生成的 JS 在测试环境不存在，必须 mock
vi.mock('../core/wails-bindings', () => ({
    StartFileServer: vi.fn(),
    IsolateModelDir: vi.fn(),
}));

import { resolveFileUrl } from '../core/fileservice';
import { StartFileServer, IsolateModelDir } from '../core/wails-bindings';

describe('normPath', () => {
    it('反斜杠统一为正斜杠', () => {
        expect(normPath('C:\\Users\\test\\model.pmx')).toBe('C:/Users/test/model.pmx');
        expect(normPath('C:/Users/test/model.pmx')).toBe('C:/Users/test/model.pmx');
    });

    it('去掉尾部斜杠', () => {
        expect(normPath('/path/to/dir/')).toBe('/path/to/dir');
        expect(normPath('/path/to/dir///')).toBe('/path/to/dir');
    });

    it('空字符串原样返回', () => {
        expect(normPath('')).toBe('');
    });

    it('只有文件名时原样返回', () => {
        expect(normPath('model.pmx')).toBe('model.pmx');
    });
});

describe('resolveFileUrl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('构造正确的 HTTP URL', async () => {
        (IsolateModelDir as any).mockResolvedValue('/safe/path');
        (StartFileServer as any).mockResolvedValue(12345);

        const result = await resolveFileUrl('C:\\Users\\test\\初音ミク.pmx');

        // [doc:adr-057] URL 形如 ?f=<base64url(fileName)>，绕开路径段编码歧义
        const expectedEnc = encodeFileRef('初音ミク.pmx');
        expect(result.url).toBe(`http://127.0.0.1:12345/?f=${expectedEnc}`);
        expect(result.port).toBe(12345);
        expect(IsolateModelDir).toHaveBeenCalledWith('C:/Users/test/初音ミク.pmx');
    });

    it('路径中的反斜杠被标准化', async () => {
        (IsolateModelDir as any).mockResolvedValue('/safe/path');
        (StartFileServer as any).mockResolvedValue(9999);

        await resolveFileUrl('C:\\Users\\test\\model.pmx');

        // normPath 会把反斜杠转为正斜杠
        expect(IsolateModelDir).toHaveBeenCalledWith('C:/Users/test/model.pmx');
    });

    it('IsolateModelDir 返回的路径被传给 StartFileServer', async () => {
        (IsolateModelDir as any).mockResolvedValue('/isolated/path');
        (StartFileServer as any).mockResolvedValue(8080);

        const result = await resolveFileUrl('/any/path/model.pmx');

        expect(StartFileServer).toHaveBeenCalledWith('/isolated/path');
        expect(result.dir).toBe('/isolated/path');
    });

    it('带空格的文件名被正确编码', async () => {
        (IsolateModelDir as any).mockResolvedValue('/safe/path');
        (StartFileServer as any).mockResolvedValue(1111);

        await resolveFileUrl('C:/Users/test/my model.pmx');

        // [doc:adr-057] 空格通过 base64url 编码，不再需要 %20 转义
        const { url } = await resolveFileUrl('C:/Users/test/my model.pmx');
        const expectedEnc = encodeFileRef('my model.pmx');
        expect(url).toBe(`http://127.0.0.1:1111/?f=${expectedEnc}`);
    });
});
