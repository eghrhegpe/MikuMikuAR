import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    formatTime,
    formatError,
    toBase64,
    escapeHtml,
    computeLibraryRef,
    resolveLibraryRef,
    addRecentMotion,
    getRecentMotions,
    toggleExpandedFolder,
    expandedFolders,
    setLibraryRoot,
    setExternalPaths,
} from '../core/config';
import { normPath } from '../core/fileservice';

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
            const bad = { toString: () => { throw new Error('bad'); } };
            expect(formatError(bad)).toBe('unknown error');
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
    });
});

describe('computeLibraryRef', () => {
    beforeEach(() => {
        setLibraryRoot('C:/Users/test/MMD');
        setExternalPaths([
            { path: 'D:/ExternalLib', name: 'ExtLib' },
        ]);
    });

    it('returns relative path for main library file', () => {
        expect(computeLibraryRef('C:/Users/test/MMD/models/scene.pmx')).toBe('models/scene.pmx');
    });

    it('returns prefixed ref for external library file', () => {
        expect(computeLibraryRef('D:/ExternalLib/chars/ami.pmx')).toBe('ExtLib:chars/ami.pmx');
    });

    it('returns null for path outside all libraries', () => {
        expect(computeLibraryRef('/tmp/random.pmx')).toBeNull();
    });

    it('returns null when libraryRoot is empty', () => {
        setLibraryRoot('');
        expect(computeLibraryRef('C:/Users/test/MMD/models/scene.pmx')).toBeNull();
    });

    it('external path takes priority over main library', () => {
        // If a path matches both, external (more specific) wins
        setLibraryRoot('D:/ExternalLib');
        expect(computeLibraryRef('D:/ExternalLib/chars/ami.pmx')).toBe('ExtLib:chars/ami.pmx');
    });
});

describe('resolveLibraryRef', () => {
    beforeEach(() => {
        setLibraryRoot('C:/Users/test/MMD');
        setExternalPaths([
            { path: 'D:/ExternalLib', name: 'ExtLib' },
        ]);
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

    it('resolves external library ref', () => {
        const result = resolveLibraryRef('ExtLib:chars/ami.pmx');
        expect(result).toContain('chars/ami.pmx');
        expect(result).toContain('ExternalLib');
    });

    it('returns null for unknown external source', () => {
        expect(resolveLibraryRef('Unknown:file.pmx')).toBeNull();
    });

    it('returns null when libraryRoot is empty', () => {
        setLibraryRoot('');
        expect(resolveLibraryRef('models/scene.pmx')).toBeNull();
    });

    it('rejects external ref with "/" in relPath', () => {
        expect(resolveLibraryRef('ExtLib:../etc/passwd')).toBeNull();
    });

    it('rejects external ref with ".." in relPath', () => {
        expect(resolveLibraryRef('ExtLib:../../etc/passwd')).toBeNull();
    });

    it('rejects main ref with path traversal', () => {
        expect(resolveLibraryRef('../../etc/passwd')).toBeNull();
    });

    it('resolves main library ref with nested path', () => {
        const result = resolveLibraryRef('a/b/c/model.pmx');
        expect(result).toContain('a/b/c/model.pmx');
    });
});

describe('recentMotions', () => {
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
    it('toggles folder path in expanded set', () => {
        const path = '/test/folder';
        const wasExpanded = expandedFolders.has(path);
        toggleExpandedFolder(path);
        expect(expandedFolders.has(path)).toBe(!wasExpanded);
        toggleExpandedFolder(path);
        expect(expandedFolders.has(path)).toBe(wasExpanded);
    });
});
