package app

import (
	"context"
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
	"time"
)

// plazaInjectScript is injected into HTML responses to intercept download links
// for .pmx/.vmd/.zip/.vpd files and forward them to the parent window (ADR-078).
const plazaInjectScript = `<script data-plaza="1">
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
    parent.postMessage({type:'plaza-download-request',url:href,filename:href.split('/').pop()||'download'},'*');
  },true);
})();
</script>`

// proxyServerKey is the fixed key under which the model-plaza reverse proxy is
// registered in a.httpServers, so it is cleaned up by the shared shutdown path
// and reused across calls (only one embedded site is proxied at a time).
const proxyServerKey = "model-plaza-proxy"

// proxySession holds the reverse proxy state including the cookie jar for
// relay. The jar is in-memory only and destroyed on StopProxy.
type proxySession struct {
	jar *cookiejar.Jar
}

// proxySessions stores per-proxyKey session state (cookie jar etc.).
// Keyed by the same key used in a.httpServers (proxyServerKey).
var proxySessions = map[string]*proxySession{}

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
func (a *App) StartProxy(target string) (string, error) {
	a.httpSrvMu.Lock()
	defer a.httpSrvMu.Unlock()

	if info, ok := a.httpServers[proxyServerKey]; ok {
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
		// 伪装成正常浏览器直连：清理暴露代理的头，补 UA/Referer，降低被反爬拦截概率。
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
		if cookies := jar.Cookies(targetURL); len(cookies) > 0 {
			req.Header.Set("Cookie", cookiesToString(cookies))
		}
	}
	rp.ModifyResponse = func(resp *http.Response) error {
		// [ADR-077] Cookie 中继：拦截 Set-Cookie 存入 jar
		if cookies := resp.Cookies(); len(cookies) > 0 {
			jar.SetCookies(targetURL, cookies)
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
			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err == nil {
				html := string(body)
				injected := false
				// 优先插入 </head> 前
				if idx := strings.LastIndex(strings.ToLower(html), "</head>"); idx != -1 {
					html = html[:idx] + plazaInjectScript + html[idx:]
					injected = true
				} else if idx := strings.Index(strings.ToLower(html), "<body"); idx != -1 {
					// 其次插入 <body> 后
					end := idx
					for end < len(html) && html[end] != '>' {
						end++
					}
					if end < len(html) {
						html = html[:end+1] + plazaInjectScript + html[end+1:]
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

	srv := &http.Server{Handler: rp}
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
	proxySessions[proxyServerKey] = &proxySession{jar: jar}
	a.safeLogInfo("StartProxy: target=%s port=%d", target, port)
	return fmt.Sprintf("http://127.0.0.1:%d/", port), nil
}

// StopProxy shuts down the model-plaza reverse proxy started by StartProxy.
// It is idempotent: calling it when no proxy is running is a no-op.
// Also clears the cookie jar (ADR-077).
func (a *App) StopProxy() error {
	a.httpSrvMu.Lock()
	info, ok := a.httpServers[proxyServerKey]
	if !ok {
		a.httpSrvMu.Unlock()
		return nil
	}
	delete(a.httpServers, proxyServerKey)
	delete(proxySessions, proxyServerKey)
	a.httpSrvMu.Unlock()

	a.safeLogInfo("StopProxy: stop port %d", info.port)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := info.server.Shutdown(ctx); err != nil {
		a.safeLogError("StopProxy: shutdown error: %v", err)
		return err
	}
	return nil
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
	if fileURL == "" {
		return nil, fmt.Errorf("empty download URL")
	}

	parsed, err := url.Parse(fileURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL %q: %w", fileURL, err)
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
	if hasSession && sess.jar != nil {
		if cookies := sess.jar.Cookies(parsed); len(cookies) > 0 {
			req.Header.Set("Cookie", cookiesToString(cookies))
		}
	}

	resp, err := http.DefaultClient.Do(req)
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

	destPath := filepath.Join(destDir, fileName)
	f, err := os.Create(destPath)
	if err != nil {
		return nil, fmt.Errorf("create file %s: %w", destPath, err)
	}
	defer f.Close()

	n, err := io.Copy(f, resp.Body)
	if err != nil {
		os.Remove(destPath)
		return nil, fmt.Errorf("write file: %w", err)
	}

	// Capture cookies from download response
	if hasSession && sess.jar != nil {
		if cookies := resp.Cookies(); len(cookies) > 0 {
			sess.jar.SetCookies(parsed, cookies)
		}
	}

	a.safeLogInfo("DownloadFromPlaza: %s → %s (%d bytes)", fileName, destPath, n)
	return &PlazaDownloadResult{FilePath: destPath, Size: n, FileName: fileName}, nil
}
