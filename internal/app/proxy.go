package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"mikumikuar/internal/util"
)

// plazaInjectScript returns an HTML script element that intercepts download
// link clicks inside the proxied page and forwards them either to the parent
// window (embed mode, via postMessage — ADR-078) or to the local proxy
// endpoint (window mode, via fetch to /__plaza_dl__ — ADR-087 P0).
//
// In embed mode the parent is the Wails main window, which is a different
// origin than the proxy iframe, so postMessage targetOrigin MUST be "*" —
// using the proxy's own URL would make the browser silently drop the message.
// Safety relies on the listener verifying e.source (the iframe's
// contentWindow), not on targetOrigin.
//
// In window mode the page itself lives on the proxy origin (the WebView2
// navigates to http://127.0.0.1:PORT/), so fetch to /__plaza_dl__ is
// same-origin; CORS headers are still sent on the endpoint for safety.
//
// href may be relative (e.g. "/download/123.zip"); we absolutize it with
// new URL(href, document.baseURI) so the Go side receives a usable URL
// (ADR-087 audit fix). Note: a.href (DOM property) is already absolute, but
// the explicit new URL() documents intent and is a no-op for absolute input.
func plazaInjectScript(mode string) string {
	var forward string
	switch mode {
	case "window":
		forward = `fetch(location.origin+'/__plaza_dl__',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:absUrl,filename:absUrl.split('/').pop()||'download'})}).catch(function(){})`
	default: // "embed"
		forward = `parent.postMessage({type:'plaza-download-request',url:absUrl,filename:absUrl.split('/').pop()||'download'},'*')`
	}
	return fmt.Sprintf(`<script data-plaza="1">
(function(){
  function isDownloadLink(href){
    return /\.(pmx|vmd|zip|vpd)$/i.test(href);
  }
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(!a)return;
    var href=a.href;
    if(!href||!isDownloadLink(href))return;
    e.preventDefault();
    e.stopPropagation();
    var absUrl=new URL(href,document.baseURI).href;
    %s;
  },true);
})();
</script>`, forward)
}

// proxyServerKey is the fixed key under which the model-plaza reverse proxy is
// registered in a.httpServers, so it is cleaned up by the shared shutdown path
// and reused across calls (only one embedded site is proxied at a time).
const proxyServerKey = "model-plaza-proxy"

// proxySession holds the reverse proxy state including the cookie jar for
// relay. The jar is in-memory only and destroyed on StopProxy.
// mu protects concurrent access to jar from Director/ModifyResponse goroutines.
//
// mode is "embed" (iframe + postMessage) or "window" (WebView2 + fetch to
// /__plaza_dl__). It decides which variant of the download-intercept script
// is injected into HTML responses (ADR-087 P0).
//
// lastForwardedTarget tracks the upstream URL of the last proxied request.
// This is used by /__plaza_url__ to return the real site URL instead of the
// proxy URL (ADR-087 P1).
//
// obsolete marks the session as defunct (target changed). In-flight downloads
// should abort when obsolete=true to avoid orphaned partial files (ADR-087 P3).
type proxySession struct {
	jar                 *cookiejar.Jar
	mu                  sync.Mutex
	mode                string
	lastForwardedTarget string
	obsolete            bool
}

// getCookies returns cookies for the given URL, safe for concurrent use.
func (s *proxySession) getCookies(u *url.URL) []*http.Cookie {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.jar.Cookies(u)
}

// setCookies stores cookies for the given URL, safe for concurrent use.
func (s *proxySession) setCookies(u *url.URL, cookies []*http.Cookie) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jar.SetCookies(u, cookies)
}

// proxySessions stores per-proxyKey session state (cookie jar etc.).
// Keyed by the same key used in a.httpServers (proxyServerKey).
var proxySessions = map[string]*proxySession{}

// currentProxyTarget tracks the active proxy target URL so StartProxy can
// detect when the caller switches to a different site. The proxyServerKey
// is a fixed constant, so without this check the previous port would stay
// bound to the previous target and silently serve the wrong site after
// switching (ADR-075 fix).
var currentProxyTarget string

// plazaDownloadClient is a shared HTTP client for DownloadFromPlaza with an
// explicit timeout so a hung upstream cannot block the call indefinitely.
// Its Transport enforces the SSRF guard (plazaSSRFGuard), so downloads can
// never reach loopback / link-local / private / reserved addresses.
var plazaDownloadClient = &http.Client{Timeout: 120 * time.Second}

// maxPlazaHTMLBody caps how much of an upstream HTML response we buffer in
// memory to inject the download-intercept script (ModifyResponse). Larger
// bodies are passed through un-injected instead of being fully buffered.
var maxPlazaHTMLBody int64 = 64 << 20 // 64 MiB

// maxPlazaDownloadBytes caps the size of a single DownloadFromPlaza transfer so
// a hostile upstream cannot fill the disk. Exceeding it aborts and deletes the
// partially written file.
var maxPlazaDownloadBytes int64 = 1 << 30 // 1 GiB

// progressReader wraps an io.Reader to emit progress events during DownloadFromPlaza.
// It reports read bytes every 500ms (throttled) and emits a final completion event.
// If Content-Length is missing, percent is 0 and only bytes read are reported.
type progressReader struct {
	reader   io.Reader
	total    int64
	read     int64
	lastEmit time.Time
	fileName string
	app      *App
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	pr.read += int64(n)
	if pr.app.wailsApp != nil && time.Since(pr.lastEmit) > 500*time.Millisecond {
		var percent float64
		if pr.total > 0 {
			percent = float64(pr.read) / float64(pr.total) * 100
		}
		pr.app.wailsApp.Event.Emit("plaza:downloadProgress", map[string]any{
			"fileName": pr.fileName,
			"read":     pr.read,
			"total":    pr.total,
			"percent":  percent,
		})
		pr.lastEmit = time.Now()
	}
	return n, err
}

// emitDownloadComplete emits a plaza:downloadComplete event after a successful
// download. This is called in the deferred cleanup path of DownloadFromPlaza.
func (a *App) emitDownloadComplete(fileName string, size int64, filePath string) {
	if a.wailsApp != nil {
		a.wailsApp.Event.Emit("plaza:downloadComplete", map[string]any{
			"fileName": fileName,
			"size":     size,
			"filePath": filePath,
		})
	}
}

// init wires the SSRF-guarded transport into plazaDownloadClient while keeping
// the default TLS / idle-connection behaviour.
func init() {
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.DialContext = plazaSSRFGuard
	plazaDownloadClient.Transport = base
}

// isBlockedIP reports whether ip is loopback, link-local, private (RFC1918 /
// ULA), or unspecified — i.e. an address an SSRF attacker would aim at
// (127.0.0.1, 169.254.169.254, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7, …).
func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() || ip.IsUnspecified()
}

// plazaSSRFGuard is the DialContext for plazaDownloadClient. It resolves the
// host and refuses to connect to any blocked address, re-validating on every
// connection to defeat DNS-rebinding (the IP is checked at connect time, not
// once at URL-parse time).
func plazaSSRFGuard(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		// addr may already be host-only (no port); fall back to a default.
		host = addr
		port = "80"
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("plaza SSRF guard: DNS lookup failed for %q: %w", host, err)
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("plaza SSRF guard: no address for %q", host)
	}
	dialer := net.Dialer{}
	var lastErr error
	for _, a := range addrs {
		if isBlockedIP(a.IP) {
			return nil, fmt.Errorf("plaza SSRF guard: blocked address %s (%s)", host, a.IP)
		}
		conn, derr := dialer.DialContext(ctx, network, net.JoinHostPort(a.IP.String(), port))
		if derr == nil {
			return conn, nil
		}
		lastErr = derr
	}
	return nil, lastErr
}

// StartProxy starts a local reverse proxy that forwards to target and returns
// the local proxy base URL (e.g. "http://127.0.0.1:PORT/"). It strips
// X-Frame-Options and the CSP frame-ancestors directive so the target can be
// embedded inside an iframe, and rewrites same-host redirect Location headers
// to stay within the proxy.
//
// Cookie relay: the proxy maintains an in-memory cookie jar. Responses from
// the target that contain Set-Cookie headers are stored in the jar, and
// subsequent requests from the iframe have matching cookies injected. This
// enables login-gated sites to work inside the embedded iframe (ADR-077).
func (a *App) StartProxy(target, mode string) (string, error) {
	return util.SafeCall(func() (string, error) {
		a.httpSrvMu.Lock()
		defer a.httpSrvMu.Unlock()

		// [ADR-075 修复] 检测 target 是否变化：如果已有代理但目标不同，先停旧代理再重建。
		// 避免因 proxyServerKey 固定导致旧端口仍绑前一个 target、静默串站。
		if target != currentProxyTarget {
			if _, ok := a.httpServers[proxyServerKey]; ok {
				a.safeLogInfo("StartProxy: target changed from %q to %q — restarting", currentProxyTarget, target)
				// [ADR-087 P3] 标记旧 session 为废弃，使 in-flight 下载能感知并清理
				if oldSess, hasOld := proxySessions[proxyServerKey]; hasOld {
					oldSess.mu.Lock()
					oldSess.obsolete = true
					oldSess.mu.Unlock()
				}
				// 手动清理（不调 StopProxy 以避免死锁：已持有 httpSrvMu）
				info := a.httpServers[proxyServerKey]
				delete(a.httpServers, proxyServerKey)
				delete(proxySessions, proxyServerKey)
				a.httpSrvMu.Unlock()
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				_ = info.server.Shutdown(ctx)
				cancel()
				a.httpSrvMu.Lock()
			}
			currentProxyTarget = target
		} else if info, ok := a.httpServers[proxyServerKey]; ok {
			a.safeLogInfo("StartProxy: reuse port %d for %s", info.port, target)
			return fmt.Sprintf("http://127.0.0.1:%d/", info.port), nil
		}

		targetURL, err := url.Parse(target)
		if err != nil {
			return "", fmt.Errorf("invalid proxy target %q: %w", target, err)
		}
		if targetURL.Scheme == "" || targetURL.Host == "" {
			return "", fmt.Errorf("proxy target must be an absolute URL with scheme and host: %q", target)
		}

		jar, _ := cookiejar.New(nil)
		if mode == "" {
			mode = "embed"
		}
		sess := &proxySession{jar: jar, mode: mode}

		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return "", err
		}
		port := listener.Addr().(*net.TCPAddr).Port

		rp := httputil.NewSingleHostReverseProxy(targetURL)
		baseDirector := rp.Director
		rp.Director = func(req *http.Request) {
		baseDirector(req)
		// 关键：NewSingleHostReverseProxy 默认只改 req.URL.Host，不改 req.Host。
		// 若不重写，上游收到的 HTTP Host header 仍是 127.0.0.1:PORT，GitHub/Pixiv
		// 等按 Host 严格路由的站点会直接返回 404。必须同步 req.Host。
		req.Host = targetURL.Host
		// [ADR-087 P1/P3] 记录最后转发的目标 URL，供 /__plaza_url__ 查询真实站点地址。
		// 只更新顶级导航请求（Accept: text/html），避免子资源（CSS/JS/图片）覆盖。
		// req.URL 已被 baseDirector 修改为上游目标 URL（含路径），直接保存。
		if req.Header.Get("Accept") != "" && strings.Contains(req.Header.Get("Accept"), "text/html") {
			sess.mu.Lock()
			sess.lastForwardedTarget = req.URL.String()
			sess.mu.Unlock()
		}
		// 伪装为正常浏览器直连：清理暴露代理的头，补 UA/Referer，降低被反爬拦截概率。
		req.Header.Del("X-Forwarded-For")
		req.Header.Set("X-Forwarded-Host", targetURL.Host)
		if req.Header.Get("User-Agent") == "" {
			req.Header.Set("User-Agent",
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "+
					"(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
		}
		req.Header.Set("Referer", targetURL.Scheme+"://"+targetURL.Host+"/")
		// 避免 br/zstd 压缩导致的下游解析异常，只接受 gzip/identity。
		req.Header.Set("Accept-Encoding", "gzip")
		// [ADR-077] Cookie 中继：从 jar 中取出目标域的 Cookie 注入请求
		if cookies := sess.getCookies(targetURL); len(cookies) > 0 {
			req.Header.Set("Cookie", cookiesToString(cookies))
		}
	}
		rp.ModifyResponse = func(resp *http.Response) error {
			// [ADR-077] Cookie 中继：拦截 Set-Cookie 存入 jar
			if cookies := resp.Cookies(); len(cookies) > 0 {
				sess.setCookies(targetURL, cookies)
			}
			// Allow iframe embedding.
			resp.Header.Del("X-Frame-Options")
			if csp := resp.Header.Get("Content-Security-Policy"); csp != "" {
				kept := make([]string, 0, 4)
				for _, d := range strings.Split(csp, ";") {
					if strings.HasPrefix(strings.TrimSpace(d), "frame-ancestors") {
						continue
					}
					kept = append(kept, d)
				}
				if len(kept) == 0 {
					resp.Header.Del("Content-Security-Policy")
				} else {
					resp.Header.Set("Content-Security-Policy", strings.Join(kept, "; "))
				}
			}
			// [ADR-078] 注入下载拦截脚本到 HTML 响应
			if ct := resp.Header.Get("Content-Type"); strings.Contains(ct, "text/html") && resp.Body != nil {
				// [资源上限] 仅对已知且不超过上限的 HTML 注入脚本；超大响应直接
				// 透传不注入，避免 io.ReadAll 把整响应读进内存撑爆。
				if resp.ContentLength > maxPlazaHTMLBody {
					// [ADR-087 P4] 超上限：保持原始 resp.Body 不变，直接透传。
					a.safeLogInfo("StartProxy: HTML body too large (%d bytes), skip injection", resp.ContentLength)
				} else {
					body, err := io.ReadAll(io.LimitReader(resp.Body, maxPlazaHTMLBody))
					resp.Body.Close()
					if err == nil {
						html := string(body)
						injected := false
						script := plazaInjectScript(sess.mode)
						// 优先插入 </head> 前
						if idx := strings.LastIndex(strings.ToLower(html), "</head>"); idx != -1 {
							html = html[:idx] + script + html[idx:]
							injected = true
						} else if idx := strings.Index(strings.ToLower(html), "<body"); idx != -1 {
							// 其次插入 <body> 后
							end := idx
							for end < len(html) && html[end] != '>' {
								end++
							}
							if end < len(html) {
								html = html[:end+1] + script + html[end+1:]
								injected = true
							}
						}
						if injected {
							resp.Body = io.NopCloser(strings.NewReader(html))
							resp.ContentLength = int64(len(html))
							resp.Header.Del("Content-Length")
						} else {
							resp.Body = io.NopCloser(strings.NewReader(html))
						}
					}
				}
			}
			// Keep same-host redirects inside the proxy.
			if loc := resp.Header.Get("Location"); loc != "" {
				if u, e := url.Parse(loc); e == nil && u.Host == targetURL.Host {
					u.Scheme = "http"
					u.Host = resp.Request.Host
					resp.Header.Set("Location", u.String())
				}
			}
			return nil
		}
		rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
			a.safeLogError("StartProxy: proxy error for %s%s: %v", r.URL.Path, r.URL.RawQuery, e)
			http.Error(w, "proxy error: "+e.Error(), http.StatusBadGateway)
		}

		// [ADR-087 P0/P1] mux 包装：拦截 /__plaza_dl__（下载入库）和
		// /__plaza_url__（URL 追踪），其余路径走反向代理。仅 window 模式会
		// fetch 这些端点，但 mux 对 embed 模式无害。
		mux := http.NewServeMux()
		mux.HandleFunc("/__plaza_dl__", a.handlePlazaDownloadPost)
		mux.HandleFunc("/__plaza_url__", a.handlePlazaUrlPost)
		mux.Handle("/", rp)

		srv := &http.Server{
			Handler:      mux,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 0, // 代理流式页面/内嵌媒体时不应有写入超时（上游决定节奏）
			IdleTimeout:  120 * time.Second,
		}
		go func() {
			if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
				a.safeLogError("StartProxy: Serve error: %v", err)
			}
		}()

		a.httpServers[proxyServerKey] = &httpServerInfo{
			server:   srv,
			port:     port,
			dir:      proxyServerKey,
			listener: listener,
		}
		proxySessions[proxyServerKey] = sess
		a.safeLogInfo("StartProxy: target=%s port=%d", target, port)
		return fmt.Sprintf("http://127.0.0.1:%d/", port), nil
	})
}

// StopProxy shuts down the model-plaza reverse proxy started by StartProxy.
// It is idempotent: calling it when no proxy is running is a no-op.
// Also clears the cookie jar (ADR-077).
func (a *App) StopProxy() error {
	return util.SafeCallVoid(func() error {
		a.httpSrvMu.Lock()
		info, ok := a.httpServers[proxyServerKey]
		if !ok {
			a.httpSrvMu.Unlock()
			return nil
		}
		delete(a.httpServers, proxyServerKey)
		delete(proxySessions, proxyServerKey)
		currentProxyTarget = ""
		a.httpSrvMu.Unlock()

		a.safeLogInfo("StopProxy: stop port %d", info.port)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := info.server.Shutdown(ctx); err != nil {
			a.safeLogError("StopProxy: shutdown error: %v", err)
			return err
		}
		return nil
	})
}

// cookiesToString serializes a slice of http.Cookie into a "Cookie" header value.
func cookiesToString(cookies []*http.Cookie) string {
	parts := make([]string, 0, len(cookies))
	for _, c := range cookies {
		parts = append(parts, c.Name+"="+c.Value)
	}
	return strings.Join(parts, "; ")
}

// PlazaDownloadResult is the return type for DownloadFromPlaza.
type PlazaDownloadResult struct {
	FilePath string `json:"filePath"`
	Size     int64  `json:"size"`
	FileName string `json:"fileName"`
}

// DownloadFromPlaza downloads a file from the proxy target using the relayed
// cookies and saves it to the appropriate category directory under ResourceRoot.
// The file is classified by extension: .pmx → model/, .vmd → motion/,
// .zip → model/, .vpd → pose/. Returns the saved file path and size.
func (a *App) DownloadFromPlaza(fileURL string, fileName string) (*PlazaDownloadResult, error) {
	return util.SafeCall(func() (*PlazaDownloadResult, error) {
		if fileURL == "" {
			return nil, fmt.Errorf("empty download URL")
		}

		parsed, err := url.Parse(fileURL)
		if err != nil {
			return nil, fmt.Errorf("invalid URL %q: %w", fileURL, err)
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return nil, fmt.Errorf("download URL must be http(s): %q", fileURL)
		}

		// [SSRF 主防线] 仅允许下载当前已激活广场代理的同 host 资源。
		// 下载请求本就只应来自已代理的广场站（ADR-078 注入脚本 postMessage 同站链接）。
		a.httpSrvMu.Lock()
		pt := currentProxyTarget
		a.httpSrvMu.Unlock()
		if pt == "" {
			return nil, fmt.Errorf("no active plaza proxy; call StartProxy before downloading")
		}
		proxyTarget, perr := url.Parse(pt)
		if perr != nil {
			return nil, fmt.Errorf("internal: invalid proxy target %q: %w", pt, perr)
		}
		if !strings.EqualFold(parsed.Host, proxyTarget.Host) {
			return nil, fmt.Errorf("download host %q does not match active proxy target %q", parsed.Host, proxyTarget.Host)
		}

		// Build request with cookies from jar
		req, err := http.NewRequest("GET", fileURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "+
				"(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
		req.Header.Set("Referer", parsed.Scheme+"://"+parsed.Host+"/")

		// Inject cookies from the relay jar
		a.httpSrvMu.Lock()
		sess, hasSession := proxySessions[proxyServerKey]
		a.httpSrvMu.Unlock()
		if hasSession {
			if cookies := sess.getCookies(parsed); len(cookies) > 0 {
				req.Header.Set("Cookie", cookiesToString(cookies))
			}
		}

		resp, err := plazaDownloadClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("download failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("download returned status %d", resp.StatusCode)
		}

		// Determine target directory from extension
		cfg, err := a.GetConfig()
		if err != nil {
			return nil, fmt.Errorf("read config: %w", err)
		}
		root := cfg.ResourceRoot
		if root == "" {
			root = DefaultResourceRoot()
		}

		ext := lowerExt(fileName)
		var subdir string
		switch ext {
		case ".pmx", ".zip":
			subdir = "model"
		case ".vmd":
			subdir = "motion"
		case ".vpd":
			subdir = "pose"
		default:
			subdir = "model"
		}

		destDir := filepath.Join(root, subdir)
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			return nil, fmt.Errorf("create dir %s: %w", destDir, err)
		}

		// [ADR-078] 路径穿越防护：剥离目录成分，仅保留 base 名，拒绝越界文件名
		fileName = filepath.Base(fileName)
		if fileName == "" || fileName == "." || fileName == string(filepath.Separator) || strings.Contains(fileName, "..") {
			return nil, fmt.Errorf("invalid file name %q", fileName)
		}
		destPath := filepath.Join(destDir, fileName)
		f, err := os.Create(destPath)
		if err != nil {
			return nil, fmt.Errorf("create file %s: %w", destPath, err)
		}
		defer f.Close()

		// [ADR-087 P3] 检查 session 是否已废弃（target 变化）。若废弃则立即清理文件，
		// 避免 target-change 后残留部分下载文件。
		a.httpSrvMu.Lock()
		sessForCheck, hasSessionForCheck := proxySessions[proxyServerKey]
		a.httpSrvMu.Unlock()
		if hasSessionForCheck {
			sessForCheck.mu.Lock()
			obsolete := sessForCheck.obsolete
			sessForCheck.mu.Unlock()
			if obsolete {
				f.Close()
				os.Remove(destPath)
				return nil, fmt.Errorf("proxy session obsolete (target changed)")
			}
		}

		// [ADR-087 P1] 包装 resp.Body 以报告下载进度。Content-Length 可能缺失，
		// progressReader 会在 total=0 时将 percent 设为 0，仅报告已下载字节数。
		total := resp.ContentLength
		pr := &progressReader{
			reader:   resp.Body,
			total:    total,
			read:     0,
			lastEmit: time.Now(),
			fileName: fileName,
			app:      a,
		}

		// [资源上限] 限制单文件下载大小，防止恶意上游写满磁盘。
		n, err := io.Copy(f, io.LimitReader(pr, maxPlazaDownloadBytes))
		if err != nil {
			f.Close()
			os.Remove(destPath)
			return nil, fmt.Errorf("write file: %w", err)
		}
		// 确认未被 LimitReader 截断：再多读 1 字节，若仍有数据则已超限。
		peek := make([]byte, 1)
		if _, perr := pr.Read(peek); perr != io.EOF {
			f.Close()
			os.Remove(destPath)
			return nil, fmt.Errorf("download exceeds size limit (%d bytes)", maxPlazaDownloadBytes)
		}

		// Capture cookies from download response
		if hasSession {
			if cookies := resp.Cookies(); len(cookies) > 0 {
				sess.setCookies(parsed, cookies)
			}
		}

		a.safeLogInfo("DownloadFromPlaza: %s → %s (%d bytes)", fileName, destPath, n)
		a.emitDownloadComplete(fileName, n, destPath)
		return &PlazaDownloadResult{FilePath: destPath, Size: n, FileName: fileName}, nil
	})
}

// handlePlazaDownloadPost is the mux handler for POST /__plaza_dl__. It is the
// window-mode counterpart of the embed-mode postMessage listener: the
// download-intercept script (plazaInjectScript("window")) fetches this
// endpoint with {url, filename}, and this handler forwards them to
// DownloadFromPlaza which streams the file to disk via the SSRF-guarded,
// cookie-relaying download client (ADR-087 P0).
//
// CORS is permissive: the page itself lives on the proxy origin
// (http://127.0.0.1:PORT/) so the fetch is same-origin, but the headers are
// sent anyway for safety in case a future caller is cross-origin.
func (a *App) handlePlazaDownloadPost(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		URL      string `json:"url"`
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	result, err := a.DownloadFromPlaza(req.URL, req.Filename)
	if err != nil {
		a.safeLogError("handlePlazaDownloadPost: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

// handlePlazaUrlPost is the mux handler for POST /__plaza_url__. It is called
// by the window-mode injected script after navigation completes to report the
// document title. The handler combines it with the real upstream URL (tracked
// by proxySession.lastForwardedTarget) and emits a "plaza:urlChanged" event
// to the frontend (ADR-087 P1).
//
// This solves the "proxy URL pollution" problem: the page in the WebView2
// window loads http://127.0.0.1:PORT/..., so location.href returns the proxy
// URL, not the real site. By tracking the last forwarded target in the proxy
// Director and returning it here, the remote panel can display the correct URL.
func (a *App) handlePlazaUrlPost(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Title string `json:"title"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	a.httpSrvMu.Lock()
	sess, hasSession := proxySessions[proxyServerKey]
	a.httpSrvMu.Unlock()
	var realURL string
	if hasSession {
		sess.mu.Lock()
		realURL = sess.lastForwardedTarget
		sess.mu.Unlock()
	}
	if a.wailsApp != nil {
		a.wailsApp.Event.Emit("plaza:urlChanged", map[string]string{
			"url":   realURL,
			"title": req.Title,
		})
	}
	w.WriteHeader(http.StatusOK)
}
