import { describe, it, expect, vi } from 'vitest';
import { logInfo, logWarn, logError } from '../logger';

describe('logger', () => {
    it('logInfo formats [tag] message', () => {
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logInfo('test', 'hello');
        expect(spy).toHaveBeenCalledWith('[test] hello');
        spy.mockRestore();
    });

    it('logInfo with empty message omits space', () => {
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logInfo('test', '');
        expect(spy).toHaveBeenCalledWith('[test]');
        spy.mockRestore();
    });

    it('logInfo with extra args', () => {
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logInfo('test', 'msg', 'a', 1);
        expect(spy).toHaveBeenCalledWith('[test] msg', 'a', 1);
        spy.mockRestore();
    });

    it('logWarn formats [tag] message', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logWarn('test', 'warn');
        expect(spy).toHaveBeenCalledWith('[test] warn');
        spy.mockRestore();
    });

    it('logWarn with error passes error as second arg', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = new Error('test');
        logWarn('test', 'warn', err);
        expect(spy).toHaveBeenCalledWith('[test] warn', err);
        spy.mockRestore();
    });

    it('logError formats [tag] message', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        logError('test', 'err');
        expect(spy).toHaveBeenCalledWith('[test] err');
        spy.mockRestore();
    });
});
