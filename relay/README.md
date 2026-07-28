# MikuMikuAR AI Relay 代理

纯静态站点（GitHub Pages `eghrhegpe.github.io`）无法直连商汤 `token.sensenova.cn` 等**不返回 CORS 头**的大模型 API——浏览器会拦截跨域请求（preflight 失败 / `ERR_FAILED`）。

本目录是一个 **Cloudflare Worker 同源转发层**：补齐 CORS 头、正确应答 OPTIONS 预检、流式（SSE）透传。前端把 AI `endpoint` 指向本 Worker 的地址即可，**API key 仍由前端透传**，Worker 不持有任何凭据。

> 桌面端（Wails WebView2）走原生请求无同源策略，可直连商汤，**无需本 relay**。

## 部署

```bash
cd relay
npm i -g wrangler          # 或 npx wrangler
wrangler login             # 浏览器授权 Cloudflare 账号
wrangler deploy            # 上线，产出形如 https://mikumikuar-ai-relay.<子域>.workers.dev
```

部署前请在 `wrangler.toml` 里确认两处变量：
- `DEFAULT_TARGET`：默认转发目标（前端未带 `X-Target-Url` 头时用）。
- `ALLOWED_ORIGINS`：允许的前端来源，逗号分隔。**上线后务必收紧为你的站点**，杜绝被当作开放代理滥用。

安全约束：目标**不做厂商白名单**，用户可在前端自由填任意第三方 OpenAI 兼容 API（只要是合法 http(s) URL）。防滥用完全靠 `ALLOWED_ORIGINS` 锁死来源——只有你自己站点的页面能用本 Worker，别人拿去转发其他目标也过不了 Origin 校验。

## 前端接入（无需改代码）

在 AI 诊断/设置面板里把 `endpoint` 改成 Worker 地址：

```
https://mikumikuar-ai-relay.<你的子域>.workers.dev
```

- key 照常填在设置里，前端 `browser-adapter` 会自动带 `Authorization` 头，Worker 原样转发。
- 若要一个 Worker 对接多个 provider，可让前端额外带 `X-Target-Url` 头指定真实目标（任意合法 http(s) URL）；否则走 `DEFAULT_TARGET`。

## 本地调试

```bash
cd relay
wrangler dev               # 默认 http://localhost:8787
```

把前端 endpoint 临时指向 `http://localhost:8787` 即可联调。
