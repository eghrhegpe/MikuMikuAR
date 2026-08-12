// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { formatTime, formatError } from '../core/format';
import {
    addRecentMotion,
    getRecentMotions,
    clearRecentMotions,
    toggleExpandedFolder,
    clearExpandedFolders,
    expandedFolders,
    setLibraryRoot,
} from '../core/library-state';
import { computeLibraryRef, resolveLibraryRef } from '@/core/library-path';
import { toBase64, thumbDataUrl } from '../core/image';
import { escapeHtml } from '../core/escape-html';
import {
    normPath,
    getBaseName,
    getDirPath,
    isUnderRoot,
    isStageLike,
    computeLibraryRef as pureComputeLibraryRef,
} from '../core/path';

describe('config pure functions', () => {
    describe('formatTime', () => {
        it('0 seconds → "00:00.00"', () => {
            expect(formatTime(0)).toBe('00:00.00');
        });

        it('90 seconds → "01:30.00"', () => {
            expect(formatTime(90)).toBe('01:30.00');
        });

        it('3661 seconds → "61:01.00"', () => {
            expect(formatTime(3661)).toBe('61:01.00');
        });

        it('handles fractional seconds (centiseconds)', () => {
            expect(formatTime(12.345)).toBe('00:12.34');
            expect(formatTime(59.999)).toBe('00:59.99');
        });

        it('handles large values', () => {
            expect(formatTime(59999)).toBe('999:59.00');
        });

        it('60 seconds → "01:00.00" (minute carry)', () => {
            expect(formatTime(60)).toBe('01:00.00');
            expect(formatTime(3600)).toBe('60:00.00');
        });

        it('sub-second values keep centisecond precision', () => {
            expect(formatTime(0.5)).toBe('00:00.50');
            expect(formatTime(0.05)).toBe('00:00.05');
        });

        it('NaN / Infinity → "00:00.00" (safe fallback)', () => {
            expect(formatTime(NaN)).toBe('00:00.00');
            expect(formatTime(Infinity)).toBe('00:00.00');
            expect(formatTime(-Infinity)).toBe('00:00.00');
        });

        it('handles negative values without crashing', () => {
            // Negative durations shouldn't occur in practice but must not throw
            expect(() => formatTime(-1)).not.toThrow();
            expect(typeof formatTime(-1)).toBe('string');
            expect(formatTime(-1).length).toBeGreaterThan(0);
        });
    });

    describe('formatError', () => {
        it('returns "unknown error" for null', () => {
            expect(formatError(null)).toBe('unknown error');
        });

        it('returns "unknown error" for undefined', () => {
            expect(formatError(undefined)).toBe('unknown error');
        });

        it('returns message for Error instances', () => {
            expect(formatError(new Error('fail'))).toBe('fail');
        });

        it('truncates long Error messages', () => {
            const longMsg = 'x'.repeat(200);
            const result = formatError(new Error(longMsg), 100);
            expect(result.length).toBe(100);
            expect(result.endsWith('...')).toBe(true);
        });

        it('returns string as-is when short', () => {
            expect(formatError('oops')).toBe('oops');
        });

        it('truncates long strings', () => {
            const longStr = 'y'.repeat(200);
            const result = formatError(longStr, 50);
            expect(result.length).toBe(50);
            expect(result.endsWith('...')).toBe(true);
        });

        it('converts other types via String()', () => {
            expect(formatError(42)).toBe('42');
            expect(formatError(true)).toBe('true');
            expect(formatError({ toString: () => 'obj' })).toBe('obj');
        });

        it('uses default maxLen of 120', () => {
            const s = 'z'.repeat(130);
            const result = formatError(s);
            expect(result.length).toBe(120);
            expect(result.endsWith('...')).toBe(true);
        });

        it('does not truncate when exactly at maxLen', () => {
            const s = 'a'.repeat(120);
            expect(formatError(s)).toBe(s);
        });

        it('returns "unknown error" for objects that throw on String()', () => {
            const bad = {
                toString: () => {
                    throw new Error('bad');
                },
            };
            expect(formatError(bad)).toBe('unknown error');
        });

        it('formats LibraryLoadError with [loadId/phase] prefix', () => {
            const err = { name: 'LibraryLoadError', loadId: 'lib1', phase: 'scan', cause: 'timeout' };
            const result = formatError(err);
            expect(result).toBe('[lib1/scan] timeout');
        });

        it('LibraryLoadError with nested Error cause', () => {
            const err = {
                name: 'LibraryLoadError',
                loadId: 'lib2',
                phase: 'load',
                cause: new Error('file not found'),
            };
            const result = formatError(err);
            expect(result).toBe('[lib2/load] file not found');
        });

        it('LibraryLoadError truncates long combined output', () => {
            const err = {
                name: 'LibraryLoadError',
                loadId: 'x'.repeat(50),
                phase: 'scan',
                cause: 'y'.repeat(200),
            };
            const result = formatError(err, 80);
            expect(result.length).toBe(80);
            expect(result.endsWith('...')).toBe(true);
        });

        it('LibraryLoadError with null cause → "[loadId/phase] unknown error"', () => {
            const err = { name: 'LibraryLoadError', loadId: 'lib3', phase: 'scan', cause: null };
            expect(formatError(err)).toBe('[lib3/scan] unknown error');
        });

        it('plain object without LibraryLoadError name goes through String()', () => {
            expect(formatError({ name: 'Other', detail: 'x' })).toBe('[object Object]');
        });

        it('tiny maxLen (< 3) does not crash and keeps 3-char ellipsis semantics', () => {
            // limit 下限为 3：内容必被截断为 3 字符的 "..."
            expect(formatError('abcdef', 0)).toBe('...');
            expect(formatError('abcdef', 3)).toBe('...');
            expect(formatError('abcdef', 4)).toBe('a...');
            expect(() => formatError('abcdef', -5)).not.toThrow();
        });
    });

    describe('toBase64', () => {
        it('encodes ASCII string', () => {
            expect(toBase64('hello')).toBe(btoa('hello'));
        });

        it('encodes empty string', () => {
            expect(toBase64('')).toBe('');
        });

        it('encodes unicode (UTF-8)', () => {
            // "日本語" in UTF-8 is 9 bytes
            const result = toBase64('日本語');
            const expected = btoa(String.fromCharCode(...new TextEncoder().encode('日本語')));
            expect(result).toBe(expected);
        });

        it('round-trips with atob', () => {
            const original = 'test 123 !@#';
            expect(atob(toBase64(original))).toBe(original);
        });
    });

    describe('thumbDataUrl', () => {
        it('sniffs PNG header', () => {
            expect(thumbDataUrl('iVBORw0KGgoAAAANSUhEUg==')).toBe(
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
            );
        });

        it('sniffs JPEG header', () => {
            expect(thumbDataUrl('/9j/4AAQSkZJRg==')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
        });

        it('sniffs WebP header', () => {
            expect(thumbDataUrl('UklGRlIAAABXRUJQVlA4')).toBe(
                'data:image/webp;base64,UklGRlIAAABXRUJQVlA4'
            );
        });

        it('falls back to PNG for unknown / empty input', () => {
            expect(thumbDataUrl('')).toBe('data:image/png;base64,');
            expect(thumbDataUrl('abc123')).toBe('data:image/png;base64,abc123');
        });
    });

    describe('escapeHtml', () => {
        it('escapes < and >', () => {
            expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        });

        it('escapes & first (no double-escape)', () => {
            expect(escapeHtml('a & b')).toBe('a &amp; b');
        });

        it('escapes double and single quotes', () => {
            expect(escapeHtml('"')).toBe('&quot;');
            expect(escapeHtml("'")).toBe('&#39;');
            expect(escapeHtml('"\'')).toBe('&quot;&#39;');
        });

        it('passes through safe strings unchanged', () => {
            expect(escapeHtml('hello world')).toBe('hello world');
        });

        it('handles empty string', () => {
            expect(escapeHtml('')).toBe('');
        });

        it('escapes all special chars in one string', () => {
            expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
        });
    });

    describe('normPath', () => {
        it('converts Windows backslashes to forward slashes', () => {
            expect(normPath('C:\\a\\b')).toBe('C:/a/b');
        });

        it('strips trailing slash', () => {
            expect(normPath('C:/a/b/')).toBe('C:/a/b');
        });

        it('leaves Unix paths unchanged', () => {
            expect(normPath('/usr/local/bin')).toBe('/usr/local/bin');
        });

        it('handles empty string', () => {
            expect(normPath('')).toBe('');
        });

        it('passes through content:// URIs (strip trailing slash only)', () => {
            expect(normPath('content://a/b/c/')).toBe('content://a/b/c');
            expect(normPath('content://a/b/c')).toBe('content://a/b/c');
        });

        it('strips ./ prefix and /./ segments', () => {
            expect(normPath('./models/file.pmx')).toBe('models/file.pmx');
            expect(normPath('a/./b/./c')).toBe('a/b/c');
        });

        it('strips multiple trailing slashes', () => {
            expect(normPath('C:/a/b///')).toBe('C:/a/b');
            expect(normPath('content://a/b//')).toBe('content://a/b');
        });

        it('collapses leading /./ segment', () => {
            expect(normPath('/./a')).toBe('/a');
        });

        it('root "/" normalizes to empty string', () => {
            expect(normPath('/')).toBe('');
        });
    });

    describe('isStageLike', () => {
        it('returns true for stage and scene', () => {
            expect(isStageLike('stage')).toBe(true);
            expect(isStageLike('scene')).toBe(true);
        });

        it('returns false for other kinds', () => {
            expect(isStageLike('pmx')).toBe(false);
            expect(isStageLike('vmd')).toBe(false);
            expect(isStageLike('')).toBe(false);
        });
    });
});

describe('computeLibraryRef', () => {
    beforeEach(() => {
        setLibraryRoot('C:/Users/test/MMD');
    });

    it('returns relative path for main library file', () => {
        expect(computeLibraryRef('C:/Users/test/MMD/models/scene.pmx')).toBe('models/scene.pmx');
    });

    it('returns null for path outside all libraries', () => {
        expect(computeLibraryRef('/tmp/random.pmx')).toBeNull();
    });

    it('returns null when libraryRoot is empty', () => {
        setLibraryRoot('');
        expect(computeLibraryRef('C:/Users/test/MMD/models/scene.pmx')).toBeNull();
    });

    it('returns null for pseudo-folder prefix attack', () => {
        // "MMDS" ≠ "MMD/" — must not match
        expect(computeLibraryRef('C:/Users/test/MMDS/models/scene.pmx')).toBeNull();
    });

    it('is case-insensitive for root comparison', () => {
        expect(computeLibraryRef('c:/users/test/mmd/models/scene.pmx')).toBe('models/scene.pmx');
    });

    it('strips trailing slash from file path before computing ref', () => {
        expect(computeLibraryRef('C:/Users/test/MMD/models/')).toBe('models');
    });

    it('returns null when filePath equals the root itself', () => {
        expect(computeLibraryRef('C:/Users/test/MMD')).toBeNull();
    });

    it('pure function returns null for null/undefined root', () => {
        expect(pureComputeLibraryRef('C:/Users/test/MMD/models/scene.pmx', null)).toBeNull();
        expect(pureComputeLibraryRef('C:/Users/test/MMD/models/scene.pmx', undefined)).toBeNull();
    });

    it('pure function matches case-insensitively (normPath cache may keep first-seen case)', () => {
        const ref = pureComputeLibraryRef('C:/Users/TEST/MMD/Models/Scene.pmx', 'c:/users/test/mmd');
        expect(ref).not.toBeNull();
        expect(ref!.toLowerCase()).toBe('models/scene.pmx');
    });
});

describe('resolveLibraryRef', () => {
    beforeEach(() => {
        setLibraryRoot('C:/Users/test/MMD');
    });

    it('returns null for empty ref', () => {
        expect(resolveLibraryRef('')).toBeNull();
    });

    it('rejects refs starting with "/"', () => {
        expect(resolveLibraryRef('/etc/passwd')).toBeNull();
    });

    it('rejects refs containing ".."', () => {
        expect(resolveLibraryRef('../etc/passwd')).toBeNull();
    });

    it('resolves main library ref', () => {
        const result = resolveLibraryRef('models/scene.pmx');
        expect(result).toContain('models/scene.pmx');
        expect(result).toContain('MMD');
    });

    it('rejects external library refs (no longer supported)', () => {
        expect(resolveLibraryRef('ExtLib:chars/ami.pmx')).toBeNull();
    });

    it('returns null for unknown external source', () => {
        expect(resolveLibraryRef('Unknown:file.pmx')).toBeNull();
    });

    it('returns null when libraryRoot is empty', () => {
        setLibraryRoot('');
        expect(resolveLibraryRef('models/scene.pmx')).toBeNull();
    });

    it('rejects main ref with path traversal', () => {
        expect(resolveLibraryRef('../../etc/passwd')).toBeNull();
    });

    it('resolves main library ref with nested path', () => {
        const result = resolveLibraryRef('a/b/c/model.pmx');
        expect(result).toContain('a/b/c/model.pmx');
    });

    it('normalizes backslash refs to forward slashes', () => {
        const result = resolveLibraryRef('models\\scene.pmx');
        expect(result).toBe('C:/Users/test/MMD/models/scene.pmx');
    });

    it('rejects backslash absolute paths (bypass attempt)', () => {
        expect(resolveLibraryRef('\\etc\\passwd')).toBeNull();
    });

    it('collapses ./ segments in ref before resolving', () => {
        const result = resolveLibraryRef('a/./b.pmx');
        expect(result).toBe('C:/Users/test/MMD/a/b.pmx');
    });

    it('is case-insensitive for lowercase libraryRoot', () => {
        setLibraryRoot('c:/users/test/mmd');
        const result = resolveLibraryRef('models/scene.pmx');
        expect(result).not.toBeNull();
        expect(result!.toLowerCase()).toBe('c:/users/test/mmd/models/scene.pmx');
    });
});

describe('path helpers (getBaseName / getDirPath / isUnderRoot)', () => {
    it('getBaseName extracts last segment across separators', () => {
        expect(getBaseName('C:\\x\\y.pmx')).toBe('y.pmx');
        expect(getBaseName('C:/x/y.pmx')).toBe('y.pmx');
        expect(getBaseName('C:/x/y.pmx/')).toBe('y.pmx'); // 去尾斜杠
        expect(getBaseName('foo.pmx')).toBe('foo.pmx');
    });

    it('getBaseName handles multiple trailing slashes and content:// URIs', () => {
        expect(getBaseName('C:/a/b///')).toBe('b');
        expect(getBaseName('content://a/b')).toBe('b');
        expect(getBaseName('/')).toBe(''); // 根路径无文件名
    });

    it('getDirPath extracts parent directory', () => {
        expect(getDirPath('C:/x/y.pmx')).toBe('C:/x');
        expect(getDirPath('actors/miku.pmx')).toBe('actors');
        expect(getDirPath('foo.pmx')).toBe(''); // 无父目录
    });

    it('getDirPath handles trailing slash and content:// URIs', () => {
        expect(getDirPath('a/b/')).toBe('a');
        expect(getDirPath('content://a/b')).toBe('content://a');
        expect(getDirPath('/')).toBe(''); // 根路径无父目录
    });

    it('isUnderRoot rejects ".." traversal segments', () => {
        expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMX/../VMD/foo.pmx')).toBe(false);
        expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMX/Sub')).toBe(true);
        expect(isUnderRoot('C:/text-model/PMX', 'C:/text-model/PMXSub')).toBe(false); // 伪文件夹防护
        expect(isUnderRoot('c:/text-model/PMX', 'C:/text-model/PMX/Sub')).toBe(true); // 盘符大小写
    });

    it('isUnderRoot rejects bare ".." and ".."-prefixed/suffixed children', () => {
        expect(isUnderRoot('C:/x', '..')).toBe(false);
        expect(isUnderRoot('C:/x', '../evil')).toBe(false);
        expect(isUnderRoot('C:/x', 'C:/x/..')).toBe(false);
        expect(isUnderRoot('C:/x', 'C:/x/a/../b')).toBe(false);
    });

    it('isUnderRoot tolerates trailing slash on base', () => {
        expect(isUnderRoot('C:/text-model/PMX/', 'C:/text-model/PMX/Sub')).toBe(true);
    });

    it('isUnderRoot returns true for exact match', () => {
        expect(isUnderRoot('C:/models', 'C:/models')).toBe(true);
    });

    it('isUnderRoot is case-insensitive', () => {
        expect(isUnderRoot('C:/Models/PMX', 'c:/models/pmx/file.pmx')).toBe(true);
    });
});

describe('recentMotions', () => {
    beforeEach(() => {
        clearRecentMotions();
    });

    it('addRecentMotion adds to list', () => {
        addRecentMotion('/path/to/dance.vmd', 'dance');
        const motions = getRecentMotions();
        expect(motions.length).toBeGreaterThanOrEqual(1);
        expect(motions.some((m) => m.path === '/path/to/dance.vmd')).toBe(true);
    });

    it('addRecentMotion deduplicates by path', () => {
        addRecentMotion('/path/a.vmd', 'a1');
        addRecentMotion('/path/a.vmd', 'a2');
        const motions = getRecentMotions();
        const matches = motions.filter((m) => m.path === '/path/a.vmd');
        expect(matches.length).toBe(1);
    });

    it('deduplication keeps the latest name and moves entry to front', () => {
        addRecentMotion('/path/a.vmd', 'a1');
        addRecentMotion('/path/b.vmd', 'b1');
        addRecentMotion('/path/a.vmd', 'a2');
        const motions = getRecentMotions();
        expect(motions[0].path).toBe('/path/a.vmd');
        expect(motions[0].name).toBe('a2');
        expect(motions.length).toBe(2);
    });

    it('getRecentMotions returns a defensive copy (external mutation is ignored)', () => {
        addRecentMotion('/path/a.vmd', 'a1');
        const first = getRecentMotions() as { path: string; name: string; timestamp: number }[];
        first[0].name = 'hacked';
        (first as any).push({ path: '/fake.vmd', name: 'fake', timestamp: 0 });
        const second = getRecentMotions();
        expect(second[0].name).toBe('a1');
        expect(second.length).toBe(1);
    });

    it('addRecentMotion caps at 10 entries', () => {
        for (let i = 0; i < 15; i++) {
            addRecentMotion(`/path/${i}.vmd`, `${i}`);
        }
        expect(getRecentMotions().length).toBeLessThanOrEqual(10);
    });

    it('getRecentMotions returns an array', () => {
        const motions = getRecentMotions();
        expect(Array.isArray(motions)).toBe(true);
    });
});

describe('toggleExpandedFolder', () => {
    beforeEach(() => {
        expandedFolders.clear();
    });

    it('toggles folder path in expanded set', () => {
        const path = '/test/folder';
        const wasExpanded = expandedFolders.has(path);
        toggleExpandedFolder(path);
        expect(expandedFolders.has(path)).toBe(!wasExpanded);
        toggleExpandedFolder(path);
        expect(expandedFolders.has(path)).toBe(wasExpanded);
    });

    it('clearExpandedFolders empties the set', () => {
        toggleExpandedFolder('/a');
        toggleExpandedFolder('/b');
        clearExpandedFolders();
        expect(expandedFolders.size).toBe(0);
    });
});
