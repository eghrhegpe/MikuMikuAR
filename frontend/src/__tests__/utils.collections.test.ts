// [doc:adr-101] P3 工具函数单测：pure collection & json helpers
import { describe, it, expect } from 'vitest';
import {
    ensureArray,
    filterKeys,
    Cache,
    allSettledFilter,
} from '../core/collections';
import { jsonStringify, jsonParse } from '../core/json-stringify';

describe('ADR-101 P3: pure collection & json helpers', () => {
    describe('ensureArray', () => {
        it('wraps non-array as single-element array', () => {
            expect(ensureArray(5)).toEqual([5]);
            expect(ensureArray('x')).toEqual(['x']);
        });

        it('passes through arrays unchanged', () => {
            expect(ensureArray([1, 2, 3])).toEqual([1, 2, 3]);
            expect(ensureArray<number>([])).toEqual([]);
        });
    });

    describe('filterKeys', () => {
        it('keeps only keys satisfying predicate', () => {
            const obj = { a: 1, b: 2, c: 3, d: 4 };
            const result = filterKeys(obj, (k) => k === 'a' || k === 'c');
            expect(result).toEqual({ a: 1, c: 3 });
        });

        it('returns empty object when no key matches', () => {
            const obj = { a: 1, b: 2 };
            const result = filterKeys(obj, () => false);
            expect(result).toEqual({});
        });

        it('returns all keys when predicate always true', () => {
            const obj = { a: 1, b: 2 };
            const result = filterKeys(obj, () => true);
            expect(result).toEqual({ a: 1, b: 2 });
        });

        it('does not mutate original object', () => {
            const obj = { a: 1, b: 2 };
            filterKeys(obj, (k) => k === 'a');
            expect(obj).toEqual({ a: 1, b: 2 });
        });
    });

    describe('Cache', () => {
        it('get returns undefined for missing key', () => {
            const cache = new Cache<string, number>();
            expect(cache.get('x')).toBeUndefined();
            expect(cache.has('x')).toBe(false);
        });

        it('set/get/has round-trip', () => {
            const cache = new Cache<string, number>();
            cache.set('a', 1);
            expect(cache.has('a')).toBe(true);
            expect(cache.get('a')).toBe(1);
        });

        it('set overwrites existing value', () => {
            const cache = new Cache<string, number>();
            cache.set('a', 1);
            cache.set('a', 2);
            expect(cache.get('a')).toBe(2);
        });

        it('delete removes key and returns true', () => {
            const cache = new Cache<string, number>();
            cache.set('a', 1);
            expect(cache.delete('a')).toBe(true);
            expect(cache.has('a')).toBe(false);
            expect(cache.delete('a')).toBe(false);
        });

        it('clear removes all keys', () => {
            const cache = new Cache<string, number>();
            cache.set('a', 1);
            cache.set('b', 2);
            cache.clear();
            expect(cache.size).toBe(0);
        });

        it('size reflects entry count', () => {
            const cache = new Cache<string, number>();
            expect(cache.size).toBe(0);
            cache.set('a', 1);
            expect(cache.size).toBe(1);
            cache.set('b', 2);
            expect(cache.size).toBe(2);
            cache.delete('a');
            expect(cache.size).toBe(1);
        });
    });

    describe('allSettledFilter', () => {
        it('returns only fulfilled results in order', async () => {
            const results = await allSettledFilter([
                Promise.resolve('a'),
                Promise.reject(new Error('boom')),
                Promise.resolve('b'),
            ]);
            expect(results).toHaveLength(2);
            expect(results[0].value).toBe('a');
            expect(results[1].value).toBe('b');
        });

        it('returns empty array when all reject', async () => {
            const results = await allSettledFilter([
                Promise.reject(new Error('1')),
                Promise.reject(new Error('2')),
            ]);
            expect(results).toEqual([]);
        });

        it('returns all when all resolve', async () => {
            const results = await allSettledFilter([Promise.resolve(1), Promise.resolve(2)]);
            expect(results).toHaveLength(2);
            expect(results[0].value).toBe(1);
            expect(results[1].value).toBe(2);
        });

        it('handles empty input', async () => {
            const results = await allSettledFilter([]);
            expect(results).toEqual([]);
        });
    });

    describe('jsonStringify', () => {
        it('serializes with 2-space indent', () => {
            const result = jsonStringify({ a: 1, b: [2, 3] });
            expect(result).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
        });

        it('serializes primitives', () => {
            expect(jsonStringify(42)).toBe('42');
            expect(jsonStringify('x')).toBe('"x"');
            expect(jsonStringify(null)).toBe('null');
        });
    });

    describe('jsonParse', () => {
        it('parses valid JSON', () => {
            expect(jsonParse<number>('42')).toBe(42);
            expect(jsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
            expect(jsonParse<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
        });

        it('returns null for invalid JSON', () => {
            expect(jsonParse('not json')).toBeNull();
            expect(jsonParse('{invalid')).toBeNull();
        });

        it('returns null for empty string', () => {
            expect(jsonParse('')).toBeNull();
        });
    });
});
