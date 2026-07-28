import { listActions } from '../action-registry';
import type { ParamDef } from '../action-registry';

export interface ToolFunction {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required: string[];
    };
}

export interface ToolSchema {
    type: 'function';
    function: ToolFunction;
}

function paramToJsonSchema(def: ParamDef): Record<string, unknown> {
    switch (def.type) {
        case 'enum':
            return { type: 'string', enum: [...(def.enum ?? [])], description: def.name };
        case 'color':
            return { type: 'string', description: `${def.name} — hex #rrggbb` };
        case 'range':
            return { type: 'number', minimum: def.min, maximum: def.max, description: def.name };
        case 'entity':
            return { type: 'string', description: `${def.name} — 实体名称` };
        case 'boolean':
            return { type: 'boolean', description: def.name };
        case 'toggle':
            return { type: 'boolean', description: def.name };
    }
}

export function buildToolSchemas(): ToolSchema[] {
    const actions = listActions();
    return actions.map((a) => {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const p of a.params) {
            properties[p.name] = paramToJsonSchema(p);
            required.push(p.name);
        }
        return {
            type: 'function' as const,
            function: {
                name: a.id,
                description: a.label,
                parameters: {
                    type: 'object',
                    properties,
                    required,
                },
            },
        };
    });
}

export function buildToolCatalogText(): string {
    const actions = listActions();
    if (actions.length === 0) {
        return '';
    }
    const lines: string[] = ['可用工具（仅以下操作支持）：'];
    for (const a of actions) {
        const paramsDesc = a.params.map((p) => {
            const typeHint = p.type === 'enum' ? `(${(p.enum ?? []).join('|')})` : `:${p.type}`;
            return `${p.name}${typeHint}`;
        });
        lines.push(`- ${a.id}: ${paramsDesc.length ? paramsDesc.join(', ') : '无参'}`);
    }
    return lines.join('\n');
}
