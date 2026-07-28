// MikuMikuAR — AI 同源 relay 代理（Cloudflare Worker）
//
// 用途：GitHub Pages 等纯静态站点无法直连商汤/OpenAI 等不返回 CORS 头的 API。
// 本 Worker 作为同源转发层：补齐 CORS 头 + 正确应答 OPTIONS 预检 + 流式透传。
//
// key 策略：前端透传。前端在 Authorization 头里带自己的 key，Worker 原样转发，
// 自身不持有任何凭据（见 ADR / AGENTS 决策：Key 由前端透传）。
//
// 目标端点约定（二选一，优先级从高到低）：
//   1) 请求头 `X-Target-Url`：完整目标 URL（前端可动态切换 provider）
//   2) 环境变量 `DEFAULT_TARGET`：wrangler.toml 里配置的默认目标
//
// 允许的源（防滥用）：环境变量 `ALLOWED_ORIGINS`，逗号分隔；缺省为 '*'（宽松，仅建议开发期）。
//
// 目标不做厂商白名单：用户可在前端自由填任意第三方 OpenAI 兼容 API。
// 防滥用完全交给 `ALLOWED_ORIGINS`——只有来自本站点的页面能用本 Worker，
// 别人拿去转发其他目标也无意义（其页面 Origin 过不了校验）。

/** 目标 URL 合法性校验：仅要求是合法的 http(s) URL；不限制域名。 */
function isAllowedTarget(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}

/** 计算允许的 Origin：命中白名单回显该 Origin，否则回退第一个/`*`。 */
function resolveAllowOrigin(reqOrigin, env) {
    const raw = (env.ALLOWED_ORIGINS || '*').trim();
    if (raw === '*') {
        return '*';
    }
    const list = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (reqOrigin && list.includes(reqOrigin)) {
        return reqOrigin;
    }
    return list[0] || '*';
}

/** 统一的 CORS 响应头。 */
function corsHeaders(reqOrigin, env, reqHeaders) {
    const allowOrigin = resolveAllowOrigin(reqOrigin, env);
    const headers = {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        // 回显预检请求声明的头，兜底常用头
        'Access-Control-Allow-Headers':
            reqHeaders || 'Authorization, Content-Type, X-Target-Url',
        'Access-Control-Max-Age': '86400',
    };
    // 非 '*' 才可带凭据；'*' 时浏览器禁止 credentials
    if (allowOrigin !== '*') {
        headers['Vary'] = 'Origin';
    }
    return headers;
}

export default {
    async fetch(request, env) {
        const reqOrigin = request.headers.get('Origin') || '';

        // 预检：必须返回 2xx，否则主请求被浏览器掐断
        if (request.method === 'OPTIONS') {
            const acrh = request.headers.get('Access-Control-Request-Headers') || '';
            return new Response(null, {
                status: 204,
                headers: corsHeaders(reqOrigin, env, acrh),
            });
        }

        // 解析目标 URL
        const target = request.headers.get('X-Target-Url') || env.DEFAULT_TARGET || '';
        if (!target) {
            return json(
                { error: 'relay: 未指定目标端点（X-Target-Url 头或 DEFAULT_TARGET 环境变量）' },
                502,
                reqOrigin,
                env,
            );
        }
        if (!isAllowedTarget(target)) {
            return json(
                { error: `relay: 目标不是合法的 http(s) URL: ${target}` },
                400,
                reqOrigin,
                env,
            );
        }

        // 透传上游请求：保留 method / body / Authorization / Content-Type
        const upstreamHeaders = new Headers();
        const auth = request.headers.get('Authorization');
        const contentType = request.headers.get('Content-Type');
        if (auth) {
            upstreamHeaders.set('Authorization', auth);
        }
        if (contentType) {
            upstreamHeaders.set('Content-Type', contentType);
        }
        upstreamHeaders.set('Accept', request.headers.get('Accept') || 'application/json');

        let upstream;
        try {
            upstream = await fetch(target, {
                method: request.method,
                headers: upstreamHeaders,
                body: request.method === 'GET' ? undefined : request.body,
            });
        } catch (err) {
            return json(
                { error: `relay: 上游请求失败: ${err && err.message ? err.message : String(err)}` },
                502,
                reqOrigin,
                env,
            );
        }

        // 透传上游响应体（含 SSE 流），叠加 CORS 头
        const respHeaders = new Headers(upstream.headers);
        const cors = corsHeaders(reqOrigin, env);
        for (const [k, v] of Object.entries(cors)) {
            respHeaders.set(k, v);
        }
        return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: respHeaders,
        });
    },
};

/** 构造带 CORS 头的 JSON 错误响应。 */
function json(obj, status, reqOrigin, env) {
    const headers = corsHeaders(reqOrigin, env);
    headers['Content-Type'] = 'application/json';
    return new Response(JSON.stringify(obj), { status, headers });
}
