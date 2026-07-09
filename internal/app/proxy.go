package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// proxyServerKey is the fixed key under which the model-plaza reverse proxy is
// registered in a.httpServers, so it is cleaned up by the shared shutdown path
// and reused across calls (only one embedded site is proxied at a time).
const proxyServerKey = "model-plaza-proxy"

// StartProxy starts a local reverse proxy that forwards to target and returns
// the local proxy base URL (e.g. "http://127.0.0.1:PORT/"). It strips
// X-Frame-Options and the CSP frame-ancestors directive so the target can be
// embedded inside an iframe, and rewrites same-host redirect Location headers
// to stay within the proxy.
//
// Intended for read-only browsing of login-free model resource sites;
// login-gated SPA sites should use the external-browser path instead
// (see ADR-075). See also ysm-model-manager's creative-workshop proxy.
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

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	port := listener.Addr().(*net.TCPAddr).Port

	rp := httputil.NewSingleHostReverseProxy(targetURL)
	baseDirector := rp.Director
	rp.Director = func(req *http.Request) {
		baseDirector(req)
		req.Header.Del("X-Forwarded-For")
		req.Header.Set("X-Forwarded-Host", targetURL.Host)
	}
	rp.ModifyResponse = func(resp *http.Response) error {
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
	a.safeLogInfo("StartProxy: target=%s port=%d", target, port)
	return fmt.Sprintf("http://127.0.0.1:%d/", port), nil
}

// StopProxy shuts down the model-plaza reverse proxy started by StartProxy.
// It is idempotent: calling it when no proxy is running is a no-op.
func (a *App) StopProxy() error {
	a.httpSrvMu.Lock()
	info, ok := a.httpServers[proxyServerKey]
	if !ok {
		a.httpSrvMu.Unlock()
		return nil
	}
	delete(a.httpServers, proxyServerKey)
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
