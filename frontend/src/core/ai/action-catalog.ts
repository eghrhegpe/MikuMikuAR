import { listActions } from '../action-registry';
import type { ParamDef } from '../action-registry';
import { t } from '../i18n/t';

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
        case 'enum': {
            const synonymNote = def.synonyms
                ? `；同义词: ${Object.entries(def.synonyms)
                      .map(([k, v]) => `${k}→${v}`)
                      .join(', ')}`
                : '';
            return {
                type: 'string',
                enum: [...(def.enum ?? [])],
                description: `${def.name}${synonymNote}`,
            };
        }
        case 'color':
            return { type: 'string', description: `${def.name} — hex #rrggbb` };
        case 'range':
            return { type: 'number', minimum: def.min, maximum: def.max, description: def.name };
        case 'entity':
            return {
                type: 'string',
                description: `${def.name} — 实体名称（先用只读工具查看可用值）`,
            };
        case 'boolean':
            return { type: 'boolean', description: def.name };
        case 'toggle':
            return { type: 'boolean', description: def.name };
        case 'string':
            return { type: 'string', description: def.name };
    }
}

export function buildToolSchemas(): ToolSchema[] {
    const actions = listActions().filter((a) => !a.uiOnly);
    return actions.map((a) => {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const p of a.params) {
            properties[p.name] = paramToJsonSchema(p);
            if (!p.optional) {
                required.push(p.name);
            }
        }
        return {
            type: 'function' as const,
            function: {
                name: a.id,
                // [doc:adr-155] label 可为 i18n key，过 t() 得到当前 UI 语言文本（LLM 描述随语言切换）。
                description: t(a.label),
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
    const actions = listActions().filter((a) => !a.uiOnly);
    if (actions.length === 0) {
        return '';
    }
    const lines: string[] = [t('ai.system.catalogHeader')];
    for (const a of actions) {
        const paramsDesc = a.params.map((p) => {
            if (p.type === 'enum') {
                const synonyms = p.synonyms
                    ? '; ' +
                      Object.entries(p.synonyms)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(', ')
                    : '';
                return `${p.name}(${(p.enum ?? []).join('|')}${synonyms})`;
            }
            if (p.type === 'entity') {
                return `${p.name}(名称)`;
            }
            return `${p.name}:${p.type}`;
        });
        const suffix = a.readonly ? ' [只读，自动执行]' : a.destructive ? ' [需确认]' : '';
        lines.push(`- ${a.id}: ${paramsDesc.length ? paramsDesc.join(', ') : '无参'}${suffix}`);
    }
    return lines.join('\n');
}
