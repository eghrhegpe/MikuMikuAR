// @vitest-environment node
// [doc:adr-155][doc:adr-197] action-catalog 守护测试：Tool Schema 构建 + 文本目录生成。
// 隔离测试：mock action-registry 以注入已知动作集，避免真实注册表污染。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock t() 保持可预测输出
vi.mock('../../i18n/t', () => ({
    t: (key: string) => {
        const map: Record<string, string> = {
            'ai.system.catalogHeader': '可用工具:',
            'ai.actions.control.setLightIntensity': '设置灯光强度',
            'ai.actions.control.setCameraMode': '切换相机模式',
            'ai.actions.control.toggleGround': '切换地面显隐',
            'ai.actions.control.loadModel': '加载模型',
            'ai.actions.scene.listModels': '列出场景模型',
            'ai.actions.diagnostic.getErrors': '获取前端错误',
        };
        return map[key] ?? key;
    },
}));

import { registerAction, _resetActionRegistry } from '../../action-registry';
import { buildToolSchemas, buildToolCatalogText } from '../action-catalog';

beforeEach(() => {
    _resetActionRegistry();
});

afterEach(() => {
    _resetActionRegistry();
});

describe('buildToolSchemas', () => {
    it('空注册表返回空数组', () => {
        expect(buildToolSchemas()).toEqual([]);
    });

    it('uiOnly 动作被排除', () => {
        registerAction({
            id: 'test:ui',
            label: 'UI 操作',
            domain: 'settings',
            params: [],
            uiOnly: true,
            execute: () => {},
        });
        expect(buildToolSchemas()).toEqual([]);
    });

    it('无参动作为 function type，parameters 空', () => {
        registerAction({
            id: 'test:noop',
            label: '无参动作',
            domain: 'scene',
            params: [],
            execute: () => {},
        });
        const schemas = buildToolSchemas();
        expect(schemas).toHaveLength(1);
        expect(schemas[0].type).toBe('function');
        expect(schemas[0].function.name).toBe('test:noop');
        expect(schemas[0].function.parameters.properties).toEqual({});
        expect(schemas[0].function.parameters.required).toEqual([]);
    });

    it('enum 参数生成 enum 属性', () => {
        registerAction({
            id: 'test:enum',
            label: '枚举测试',
            domain: 'scene',
            params: [{ name: 'mode', type: 'enum', enum: ['a', 'b', 'c'] }],
            execute: () => {},
        });
        const schemas = buildToolSchemas();
        const prop = schemas[0].function.parameters.properties['mode'] as Record<string, unknown>;
        expect(prop.type).toBe('string');
        expect(prop.enum).toEqual(['a', 'b', 'c']);
        expect(schemas[0].function.parameters.required).toEqual(['mode']);
    });

    it('可选参数不出现在 required 中', () => {
        registerAction({
            id: 'test:opt',
            label: '可选参数',
            domain: 'scene',
            params: [
                { name: 'required', type: 'string' },
                { name: 'optional', type: 'string', optional: true },
            ],
            execute: () => {},
        });
        const schemas = buildToolSchemas();
        expect(schemas[0].function.parameters.required).toEqual(['required']);
    });

    it('range 参数含 minimum/maximum/description', () => {
        registerAction({
            id: 'test:range',
            label: '范围测试',
            domain: 'scene',
            params: [{ name: 'val', type: 'range', min: 0, max: 1, step: 0.05 }],
            execute: () => {},
        });
        const schemas = buildToolSchemas();
        const prop = schemas[0].function.parameters.properties['val'] as Record<string, unknown>;
        expect(prop.type).toBe('number');
        expect(prop.minimum).toBe(0);
        expect(prop.maximum).toBe(1);
    });

    it('color 参数描述含 hex 提示', () => {
        registerAction({
            id: 'test:color',
            label: '颜色测试',
            domain: 'scene',
            params: [{ name: 'color', type: 'color' }],
            execute: () => {},
        });
        const schemas = buildToolSchemas();
        const prop = schemas[0].function.parameters.properties['color'] as Record<string, unknown>;
        expect(prop.description).toContain('hex');
    });

    it('readonly 动作仍出现在 schema 中', () => {
        registerAction({
            id: 'test:readonly',
            label: '只读测试',
            domain: 'diagnostic',
            params: [],
            readonly: true,
            execute: () => {},
        });
        const schemas = buildToolSchemas();
        expect(schemas).toHaveLength(1);
    });

    it('boolean/toggle 参数生成 boolean 属性', () => {
        registerAction({
            id: 'test:bool',
            label: '布尔测试',
            domain: 'scene',
            params: [
                { name: 'flag', type: 'boolean' },
                { name: 'sw', type: 'toggle' },
            ],
            execute: () => {},
        });
        const schemas = buildToolSchemas();
        const props = schemas[0].function.parameters.properties;
        expect(props['flag']).toEqual({ type: 'boolean', description: 'flag' });
        expect(props['sw']).toEqual({ type: 'boolean', description: 'sw' });
        expect(schemas[0].function.parameters.required).toEqual(['flag', 'sw']);
    });

    it('string 参数生成 string 属性', () => {
        registerAction({
            id: 'test:str',
            label: '字符串测试',
            domain: 'scene',
            params: [{ name: 'note', type: 'string' }],
            execute: () => {},
        });
        expect(buildToolSchemas()[0].function.parameters.properties['note']).toEqual({
            type: 'string',
            description: 'note',
        });
    });
});

describe('buildToolCatalogText', () => {
    it('空注册表返回空串', () => {
        expect(buildToolCatalogText()).toBe('');
    });

    it('包含 header 和动作列表', () => {
        registerAction({
            id: 'test:action',
            label: '测试动作',
            domain: 'scene',
            params: [{ name: 'val', type: 'range', min: 0, max: 1 }],
            execute: () => {},
        });
        const text = buildToolCatalogText();
        expect(text).toContain('可用工具:');
        expect(text).toContain('test:action');
    });

    it('readonly 动作标记 [只读，自动执行]', () => {
        registerAction({
            id: 'test:ro',
            label: '只读',
            domain: 'diagnostic',
            params: [],
            readonly: true,
            execute: () => {},
        });
        expect(buildToolCatalogText()).toContain('[只读，自动执行]');
    });

    it('destructive 动作标记 [需确认]', () => {
        registerAction({
            id: 'test:dest',
            label: '破坏性',
            domain: 'settings',
            params: [],
            destructive: true,
            execute: () => {},
        });
        expect(buildToolCatalogText()).toContain('[需确认]');
    });

    it('uiOnly 动作不出现', () => {
        registerAction({
            id: 'test:ui',
            label: 'UI 操作',
            domain: 'settings',
            params: [],
            uiOnly: true,
            execute: () => {},
        });
        expect(buildToolCatalogText()).toBe('');
    });

    it('enum 参数显示枚举值', () => {
        registerAction({
            id: 'test:enum',
            label: '枚举',
            domain: 'scene',
            params: [{ name: 'mode', type: 'enum', enum: ['a', 'b', 'c'] }],
            execute: () => {},
        });
        const text = buildToolCatalogText();
        expect(text).toContain('mode(a|b|c)');
    });

    it('entity 参数显示为 (名称)', () => {
        registerAction({
            id: 'test:entity',
            label: '实体',
            domain: 'library',
            params: [{ name: 'name', type: 'entity' }],
            execute: () => {},
        });
        expect(buildToolCatalogText()).toContain('name(名称)');
    });

    it('非 enum/entity 参数显示为 name:type', () => {
        registerAction({
            id: 'test:plain',
            label: '普通参数',
            domain: 'scene',
            params: [
                { name: 'flag', type: 'boolean' },
                { name: 'note', type: 'string' },
            ],
            execute: () => {},
        });
        const text = buildToolCatalogText();
        expect(text).toContain('flag:boolean');
        expect(text).toContain('note:string');
    });

    it('enum 同义词显示为 k=v 形式', () => {
        registerAction({
            id: 'test:syn',
            label: '同义词',
            domain: 'scene',
            params: [{ name: 'mood', type: 'enum', enum: ['calm'], synonyms: { 平静: 'calm' } }],
            execute: () => {},
        });
        expect(buildToolCatalogText()).toContain('mood(calm; 平静=calm)');
    });
});
