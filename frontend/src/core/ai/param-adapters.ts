import type { ParamDef } from '../action-registry';

export type AdapterResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

export function enumAdapter(def: ParamDef, raw: unknown): AdapterResult<string> {
  const val = String(raw);
  const allowed = def.enum ?? [];
  if (allowed.includes(val)) {
    return { ok: true, value: val };
  }
  const synonyms = def.synonyms ?? {};
  const mapped = synonyms[val.toLowerCase()];
  if (mapped && allowed.includes(mapped)) {
    return { ok: true, value: mapped };
  }
  return { ok: false, error: `"${val}" 不在可选范围 [${allowed.join(', ')}] 内` };
}

export function rangeAdapter(def: ParamDef, raw: unknown): AdapterResult<number> {
  const val = Number(raw);
  if (!isFinite(val)) {
    return { ok: false, error: `"${raw}" 不是有效数值` };
  }
  const min = def.min ?? -Infinity;
  const max = def.max ?? Infinity;
  if (val < min || val > max) {
    return { ok: false, error: `${val} 超出范围 [${min}, ${max}]` };
  }
  return { ok: true, value: val };
}

export function colorAdapter(_def: ParamDef, raw: unknown): AdapterResult<[number, number, number]> {
  if (Array.isArray(raw) && raw.length === 3 && raw.every((v) => typeof v === 'number')) {
    return { ok: true, value: [raw[0], raw[1], raw[2]] };
  }
  const str = String(raw);
  const match = str.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    return { ok: false, error: `"${str}" 不是有效 hex 颜色 (#rrggbb)` };
  }
  const hex = match[1];
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return { ok: true, value: [r, g, b] };
}

export async function entityAdapter<T>(def: ParamDef, raw: unknown): Promise<AdapterResult<T>> {
  const name = String(raw).trim();
  if (!name) {
    return { ok: false, error: '实体名称为空' };
  }
  if (!def.resolve) {
    return { ok: false, error: '该参数类型不支持运行时解析' };
  }
  try {
    const resolved = await def.resolve(name);
    if (resolved == null) {
      return { ok: false, error: `未找到名称匹配"${name}"的实体` };
    }
    return { ok: true, value: resolved as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const ADAPTERS: Record<string, (def: ParamDef, raw: unknown) => AdapterResult | Promise<AdapterResult>> = {
  enum: enumAdapter,
  color: colorAdapter,
  range: rangeAdapter,
  entity: entityAdapter,
  boolean: (_def, raw) => ({ ok: true, value: Boolean(raw) } as AdapterResult),
  toggle: (_def, raw) => ({ ok: true, value: Boolean(raw) } as AdapterResult),
};

export function adaptParam(def: ParamDef, raw: unknown): AdapterResult | Promise<AdapterResult> {
  const adapter = ADAPTERS[def.type];
  if (!adapter) {
    return { ok: false, error: `不支持的参数类型: ${def.type}` };
  }
  return adapter(def, raw);
}
