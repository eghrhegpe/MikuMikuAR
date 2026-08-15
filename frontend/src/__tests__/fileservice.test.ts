import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normPath, encodeFileRef } from '../core/fileservice';

// Mock ../core/wails-bindings BEFORE importing fileservice.
// Wails 生成的 JS 在测试环境不存在，必须 mock。
// fileservice 还会经 ./backend 选型 go/browser，这里用可变 backend 对象同时覆盖两条分支，
// 避免测试隐式依赖 setup-wails.ts 注入的 window.wails。
const backendMocks = vi.hoisted(() => {
    const backend = {
        kind: 'go' as 'go' | 'browser',
        readFileBytes: vi.fn(),
    };
    return {
        backend,
        resolveBackend: vi.fn(() => Promise.resolve(backend)),
        getCachedCapabilities: vi.fn(() => ({ crossOriginIsolated: true })),
    };
});

vi.mock('../core/wails-bindings', () => ({
    StartFileServer: vi.fn(),
    IsolateModelDir: vi.fn(),
}));

vi.mock('../core/backend', () => ({
    resolveBackend: backendMocks.resolveBackend,
    getCachedCapabilities: backendMocks.getCachedCapabilities,
}));

import { resolveFileUrl, resolveModelDir, revokeFileUrl } from '../core/fileservice';
import { StartFileServer, IsolateModelDir } from '../core/wails-bindings';

const mockStartFileServer = vi.mocked(StartFileServer);
const mockIsolateModelDir = vi.mocked(IsolateModelDir);
const mockReadFileBytes = backendMocks.backend.readFileBytes;

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

describe('encodeFileRef', () => {
    it('ASCII 文件名输出 base64url 且无填充', () => {
        expect(encodeFileRef('my model.pmx')).toBe('bXkgbW9kZWwucG14');
        expect(encodeFileRef('my model.pmx')).not.toMatch(/[+/=]/);
    });

    it('Unicode 文件名可无损往返且不含 URL 保留字符', () => {
        const encoded = encodeFileRef('初音ミク.pmx');
        expect(encoded).not.toMatch(/[+/=]/);
        const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        expect(new TextDecoder().decode(bytes)).toBe('初音ミク.pmx');
    });

    it('空字符串返回空串', () => {
        expect(encodeFileRef('')).toBe('');
    });
});

describe('resolveFileUrl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        backendMocks.backend.kind = 'go';
        mockStartFileServer.mockResolvedValue(12345);
        mockIsolateModelDir.mockResolvedValue('/safe/path');
        mockReadFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
        backendMocks.getCachedCapabilities.mockReturnValue({ crossOriginIsolated: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('构造正确的 HTTP URL', async () => {
        mockIsolateModelDir.mockResolvedValue('/safe/path');
        mockStartFileServer.mockResolvedValue(12345);

        const result = await resolveFileUrl('C:\\Users\\test\\初音ミク.pmx');

        // [doc:adr-057] URL 形如 ?f=<base64url(fileName)>，绕开路径段编码歧义
        const expectedEnc = encodeFileRef('初音ミク.pmx');
        expect(result.url).toBe(`http://127.0.0.1:12345/?f=${expectedEnc}`);
        expect(result.port).toBe(12345);
        expect(mockIsolateModelDir).toHaveBeenCalledWith('C:/Users/test/初音ミク.pmx');
        expect(mockStartFileServer).toHaveBeenCalledWith('/safe/path');
    });

    it('路径中的反斜杠被标准化', async () => {
        mockIsolateModelDir.mockResolvedValue('/safe/path');
        mockStartFileServer.mockResolvedValue(9999);

        await resolveFileUrl('C:\\Users\\test\\model.pmx');

        // normPath 会把反斜杠转为正斜杠
        expect(mockIsolateModelDir).toHaveBeenCalledWith('C:/Users/test/model.pmx');
        expect(mockStartFileServer).toHaveBeenCalledWith('/safe/path');
    });

    it('IsolateModelDir 返回的路径被传给 StartFileServer', async () => {
        mockIsolateModelDir.mockResolvedValue('/isolated/path');
        mockStartFileServer.mockResolvedValue(8080);

        const result = await resolveFileUrl('/any/path/model.pmx');

        expect(mockStartFileServer).toHaveBeenCalledWith('/isolated/path');
        expect(result.dir).toBe('/isolated/path');
    });

    it('带空格的文件名被正确编码', async () => {
        mockIsolateModelDir.mockResolvedValue('/safe/path');
        mockStartFileServer.mockResolvedValue(1111);

        const { url } = await resolveFileUrl('C:/Users/test/my model.pmx');

        // [doc:adr-057] 空格通过 base64url 编码，不再需要 %20 转义
        const expectedEnc = encodeFileRef('my model.pmx');
        expect(url).toBe(`http://127.0.0.1:1111/?f=${expectedEnc}`);
    });

    it('浏览器分支读取虚拟目录并生成 blob URL，不启动文件服务器', async () => {
        backendMocks.backend.kind = 'browser';
        const modelDir = 'web://model/%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF';
        mockIsolateModelDir.mockResolvedValue(modelDir);
        mockReadFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
        const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');

        try {
            const result = await resolveFileUrl('C:/Users/test/初音ミク.pmx');

            expect(result.url).toBe('blob:mock');
            expect(result.port).toBe(-1);
            expect(result.dir).toBe(modelDir);
            // 浏览器适配器的模型主文件键是 file:<encodedStem>，读取入口应是
            // IsolateModelDir 返回的虚拟目录本身，而不是再拼一次原始文件名。
            expect(mockReadFileBytes).toHaveBeenCalledWith(modelDir);
            expect(mockStartFileServer).not.toHaveBeenCalled();
            expect(createSpy).toHaveBeenCalledWith(expect.any(Blob));
        } finally {
            createSpy.mockRestore();
        }
    });

    it('go 后端但 crossOriginIsolated=false 时仍按隔离目录+文件名读取', async () => {
        backendMocks.backend.kind = 'go';
        backendMocks.getCachedCapabilities.mockReturnValue({ crossOriginIsolated: false });
        mockIsolateModelDir.mockResolvedValue('/android/isolated');
        mockReadFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));

        const result = await resolveFileUrl('C:/Users/test/model.pmx');

        expect(result.url).toMatch(/^blob:/);
        expect(result.port).toBe(-1);
        expect(mockReadFileBytes).toHaveBeenCalledWith('/android/isolated/model.pmx');
        expect(mockStartFileServer).not.toHaveBeenCalled();
    });

    it('浏览器分支 readFileBytes 返回空时抛出明确错误', async () => {
        backendMocks.backend.kind = 'browser';
        mockReadFileBytes.mockResolvedValue(null);

        await expect(resolveFileUrl('C:/Users/test/model.pmx')).rejects.toThrow(
            '[fileservice] readFileBytes failed'
        );
        expect(mockStartFileServer).not.toHaveBeenCalled();
    });
});

describe('resolveModelDir', () => {
    it('规范化路径后仅调用 IsolateModelDir，不启动文件服务器', async () => {
        mockIsolateModelDir.mockResolvedValue('/isolated/dir');

        const dir = await resolveModelDir('C:\\Users\\test\\model.pmx');

        expect(dir).toBe('/isolated/dir');
        expect(mockIsolateModelDir).toHaveBeenCalledWith('C:/Users/test/model.pmx');
        expect(mockStartFileServer).not.toHaveBeenCalled();
    });
});

describe('revokeFileUrl', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('释放 blob URL', () => {
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        revokeFileUrl('blob:mock');

        expect(revokeSpy).toHaveBeenCalledWith('blob:mock');
    });

    it('http URL 与空值不触发 revokeObjectURL', () => {
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        revokeFileUrl('http://127.0.0.1:12345/?f=abc');
        revokeFileUrl(undefined);
        revokeFileUrl(null);

        expect(revokeSpy).not.toHaveBeenCalled();
    });
});
