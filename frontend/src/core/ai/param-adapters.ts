import type { ParamDef } from '../action-registry';
import { translateGoError } from '../i18n/goerr';

export type AdapterResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

export function enumAdapter(def: ParamDef, raw: unknown): AdapterResult<string> {
    const val = String(raw);
    const allowed = def.enum ?? [];
    // [audit:round17 P3] 直接值匹配与同义词侧一致地大小写不敏感（'ORBIT' 匹配 'orbit'），
    // 返回 enum 定义原值保持规范大小写。
    const direct = allowed.find((a) => a.toLowerCase() === val.toLowerCase());
    if (direct !== undefined) {
        return { ok: true, value: direct };
    }
    const synonyms = def.synonyms ?? {};
    const mapped = synonyms[val.toLowerCase()];
    if (mapped && allowed.includes(mapped)) {
        return { ok: true, value: mapped };
    }
    return { ok: false, error: `"${val}" 不在可选范围 [${allowed.join(', ')}] 内` };
}

export function rangeAdapter(def: ParamDef, raw: unknown): AdapterResult<number> {
    // [audit:round17 P3] 严格化输入：Number(null)=0 / Number('')=0 / Number(true)=1 /
    // Number([])=0 等宽松转换会把非法输入静默当作 0 并执行动作；仅接受有限数字或
    // 非空数字字符串（'0.5' 仍支持）。
    let val: number;
    if (typeof raw === 'number') {
        val = raw;
    } else if (typeof raw === 'string' && raw.trim() !== '') {
        val = Number(raw);
    } else {
        return { ok: false, error: `"${raw}" 不是有效数值` };
    }
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

export function colorAdapter(
    _def: ParamDef,
    raw: unknown
): AdapterResult<[number, number, number]> {
    // [audit:round17 P3] RGB 数组校验值域 [0,1] + 有限数：拒绝越界/NaN 元素污染 Babylon 颜色
    if (
        Array.isArray(raw) &&
        raw.length === 3 &&
        raw.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
    ) {
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
        return { ok: false, error: translateGoError(err) };
    }
}

const ADAPTERS: Record<
    string,
    (def: ParamDef, raw: unknown) => AdapterResult | Promise<AdapterResult>
> = {
    enum: enumAdapter,
    color: colorAdapter,
    range: rangeAdapter,
    entity: entityAdapter,
    // string：直通适配器（原样透传字符串，不做实体解析/校验）。
    // 与 entity 的区别：entity 必须配 resolve 做模糊匹配，string 用于任意自由文本（如文件路径）。
    string: (_def, raw) => ({ ok: true, value: String(raw) }) as AdapterResult,
    // [fix:round18 P3] boolean/toggle 字符串黑名单解析：LLM 可能传 "false"/"0"/"off" 等
    // 字符串，直接 Boolean(raw) 会得 true（语义反转）。布尔字面量保持原语义。
    boolean: (_def, raw) => ({ ok: true, value: parseBoolean(raw) }) as AdapterResult,
    toggle: (_def, raw) => ({ ok: true, value: parseBoolean(raw) }) as AdapterResult,
};

/** [fix:round18 P3] 布尔值解析：字符串黑名单 → false；其余走 Boolean 语义。 */
function parseBoolean(raw: unknown): boolean {
    if (typeof raw === 'string') {
        const s = raw.trim().toLowerCase();
        if (s === '' || s === 'false' || s === '0' || s === 'off' || s === 'no' || s === 'null' || s === 'undefined') {
            return false;
        }
    }
    return Boolean(raw);
}

export function adaptParam(def: ParamDef, raw: unknown): AdapterResult | Promise<AdapterResult> {
    const adapter = ADAPTERS[def.type];
    if (!adapter) {
        return { ok: false, error: `不支持的参数类型: ${def.type}` };
    }
    return adapter(def, raw);
}
