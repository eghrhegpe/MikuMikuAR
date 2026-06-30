import { describe, it, expect } from 'vitest';
import { formatTime, escapeHtml } from '../core/config';
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
            expect(formatTime(59.999)).toBe('00:59.99'); // floor-based: 59.999s → 59s + 99cs
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
