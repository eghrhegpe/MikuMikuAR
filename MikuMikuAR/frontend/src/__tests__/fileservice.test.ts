import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normPath } from '../core/fileservice';

// Mock ../../wailsjs/go/main/App BEFORE importing fileservice
// Wails 生成的 JS 在测试环境不存在，必须 mock
vi.mock('../../wailsjs/go/main/App', () => ({
    StartFileServer: vi.fn(),
    IsolateModelDir: vi.fn(),
}));

import { resolveFileUrl } from '../core/fileservice';
import { StartFileServer, IsolateModelDir } from '../../wailsjs/go/main/App';

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

        // 文件名应被 encodeURIComponent
        expect(result.url).toBe('http://127.0.0.1:12345/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF.pmx');
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

        // 空格 → %20
        const { url } = await resolveFileUrl('C:/Users/test/my model.pmx');
        expect(url).toContain('my%20model.pmx');
    });
});
