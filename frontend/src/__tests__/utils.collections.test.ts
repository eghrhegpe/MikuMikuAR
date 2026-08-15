// @vitest-environment node
// [doc:adr-101] P3 工具函数单测：pure collection & json helpers
import { describe, it, expect } from 'vitest';
import { ensureArray, filterKeys, Cache, allSettledFilter } from '../core/collections';
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

        it('wraps falsy non-array values correctly', () => {
            expect(ensureArray(false)).toEqual([false]);
            expect(ensureArray(0)).toEqual([0]);
            expect(ensureArray('')).toEqual(['']);
        });

        it('wraps null and undefined as single-element array', () => {
            expect(ensureArray(null)).toEqual([null]);
            expect(ensureArray(undefined)).toEqual([undefined]);
        });

        it('wraps Set/arguments/array-likes as single elements (documented non-array behavior)', () => {
            const set = new Set([1, 2]);
            expect(ensureArray(set)).toEqual([set]);

            function captureArgs(..._xs: number[]): IArguments {
                return arguments;
            }
            const args = captureArgs(1, 2);
            expect(ensureArray(args)).toEqual([args]);

            const arrayLike = { 0: 'a', 1: 'b', length: 2 };
            expect(ensureArray(arrayLike)).toEqual([arrayLike]);
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

        it('handles empty object', () => {
            const result = filterKeys({}, () => true);
            expect(result).toEqual({});
        });

        it('predicate receives actual key names', () => {
            const keys: string[] = [];
            filterKeys({ x: 1, y: 2 }, (k) => {
                keys.push(k as string);
                return true;
            });
            expect(keys).toEqual(['x', 'y']);
        });

        it('returns empty object for nullish input', () => {
            expect(filterKeys(null as unknown as { a: number }, () => true)).toEqual({});
            expect(filterKeys(undefined as unknown as { a: number }, () => true)).toEqual({});
        });

        it('ignores inherited enumerable keys', () => {
            const proto = { inherited: 1 };
            const obj = Object.assign(Object.create(proto), { own: 2 });
            expect(filterKeys(obj, () => true)).toEqual({ own: 2 });
        });

        it('preserves own __proto__ key without polluting result prototype', () => {
            const obj: Record<string, unknown> = { safe: 1 };
            Object.defineProperty(obj, '__proto__', {
                value: { polluted: true },
                enumerable: true,
                configurable: true,
                writable: true,
            });

            const result = filterKeys(obj, () => true);
            expect(Object.keys(result)).toEqual(['safe', '__proto__']);
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            expect((result as Record<string, unknown>).polluted).toBeUndefined();
            expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
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

        it('set undefined value is indistinguishable from missing key', () => {
            const cache = new Cache<string, number | undefined>();
            cache.set('a', undefined);
            expect(cache.get('a')).toBeUndefined();
            expect(cache.has('a')).toBe(true);
        });

        it('supports undefined and NaN keys via Map semantics', () => {
            const cache = new Cache<string | number | undefined, string>();
            cache.set(undefined, 'undefined-key');
            cache.set(NaN, 'nan-key');
            expect(cache.get(undefined)).toBe('undefined-key');
            expect(cache.has(undefined)).toBe(true);
            expect(cache.get(NaN)).toBe('nan-key');
            expect(cache.has(NaN)).toBe(true);
            expect(cache.size).toBe(2);
        });

        it('delete on empty cache returns false', () => {
            const cache = new Cache<string, number>();
            expect(cache.delete('x')).toBe(false);
        });

        it('clear on empty cache is idempotent', () => {
            const cache = new Cache<string, number>();
            cache.clear();
            expect(cache.size).toBe(0);
            cache.clear();
            expect(cache.size).toBe(0);
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

        it('accepts non-Promise values as already fulfilled', async () => {
            const results = await allSettledFilter<number>([1, Promise.resolve(2)]);
            expect(results).toHaveLength(2);
            expect(results[0].value).toBe(1);
            expect(results[1].value).toBe(2);
        });

        it('treats synchronously throwing thenables as rejected', async () => {
            const syncThrowThenable = {
                then(): never {
                    throw new Error('sync-then');
                },
            };
            const results = await allSettledFilter<unknown>([syncThrowThenable]);
            expect(results).toEqual([]);
        });

        it('presolves undefined values (not filtered out)', async () => {
            const results = await allSettledFilter([Promise.resolve(undefined)]);
            expect(results).toHaveLength(1);
            expect(results[0].value).toBeUndefined();
        });

        it('preserves order of mixed types', async () => {
            const results = await allSettledFilter<string | number | boolean>([
                Promise.resolve(1),
                Promise.reject(new Error('x')),
                Promise.resolve('b'),
                Promise.resolve(true),
            ]);
            expect(results).toHaveLength(3);
            expect(results[0].value).toBe(1);
            expect(results[1].value).toBe('b');
            expect(results[2].value).toBe(true);
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

        it('normalizes undefined to "null" string', () => {
            expect(jsonStringify(undefined)).toBe('null');
        });

        it('serializes NaN and Infinity as null (JSON spec)', () => {
            expect(jsonStringify(NaN)).toBe('null');
            expect(jsonStringify(Infinity)).toBe('null');
            expect(jsonStringify(-Infinity)).toBe('null');
        });

        it('normalizes top-level function and symbol to "null" string', () => {
            expect(jsonStringify(() => 1)).toBe('null');
            expect(jsonStringify(Symbol('s'))).toBe('null');
        });

        it('throws on BigInt (JSON.stringify native limitation)', () => {
            expect(() => jsonStringify(123n)).toThrow();
        });

        it('throws on circular reference', () => {
            const obj: Record<string, unknown> = { a: 1 };
            obj.self = obj;
            expect(() => jsonStringify(obj)).toThrow();
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

        it('parses null literal (ambiguous with error null)', () => {
            expect(jsonParse('null')).toBeNull();
        });

        it('parses boolean and array edge cases', () => {
            expect(jsonParse<boolean>('true')).toBe(true);
            expect(jsonParse<boolean>('false')).toBe(false);
            expect(jsonParse<unknown[]>('[]')).toEqual([]);
        });
    });
});
