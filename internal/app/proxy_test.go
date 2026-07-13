package app

import (
	"context"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCookiesToString(t *testing.T) {
	cookies := []*http.Cookie{
		{Name: "session", Value: "abc123"},
		{Name: "lang", Value: "zh-CN"},
	}
	got := cookiesToString(cookies)
	want := "session=abc123; lang=zh-CN"
	if got != want {
		t.Errorf("cookiesToString() = %q, want %q", got, want)
	}
}

func TestCookiesToString_Empty(t *testing.T) {
	got := cookiesToString(nil)
	if got != "" {
		t.Errorf("cookiesToString(nil) = %q, want empty", got)
	}
}

func TestCookieRelay_SetCookieCaptured(t *testing.T) {
	// Start a test target server that sets a cookie and echoes it back.
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login":
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "tok123", Path: "/"})
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("logged in"))
		case "/check":
			c, err := r.Cookie("session")
			if err != nil || c.Value != "tok123" {
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte("no session"))
				return
			}
			w.Write([]byte("authenticated"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer target.Close()

	// Simulate what StartProxy does: create a jar, set cookies from response,
	// then read them back for a subsequent request.
	jar, _ := cookiejar.New(nil)
	targetURL, _ := url.Parse(target.URL)

	// 1. Hit /login, capture Set-Cookie
	resp, err := http.Get(target.URL + "/login")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if cookies := resp.Cookies(); len(cookies) > 0 {
		jar.SetCookies(targetURL, cookies)
	}

	// 2. Verify jar has the cookie
	stored := jar.Cookies(targetURL)
	if len(stored) != 1 || stored[0].Name != "session" || stored[0].Value != "tok123" {
		t.Fatalf("jar.Cookies() = %v, want [session=tok123]", stored)
	}

	// 3. Build a request with cookies from jar
	req, _ := http.NewRequest("GET", target.URL+"/check", nil)
	if cookies := jar.Cookies(targetURL); len(cookies) > 0 {
		req.Header.Set("Cookie", cookiesToString(cookies))
	}

	// 4. Send request and verify authentication works
	resp2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Errorf("GET /check with relayed cookie: status %d, want 200", resp2.StatusCode)
	}
}

func TestStopProxy_ClearsSession(t *testing.T) {
	a := NewApp("test", "", "")
	// No proxy running — StopProxy should be a no-op.
	if err := a.StopProxy(); err != nil {
		t.Errorf("StopProxy() on empty = %v", err)
	}
	if _, ok := proxySessions[proxyServerKey]; ok {
		t.Error("proxySessions should not have entry after StopProxy with no running proxy")
	}
}

func TestPlazaInjectScript_InHTML(t *testing.T) {
	html := `<html><head><title>test</title></head><body><a href="/page">link</a></body></html>`
	// Simulate what ModifyResponse does: inject script before </head>
	idx := strings.LastIndex(strings.ToLower(html), "</head>")
	if idx == -1 {
		t.Fatal("expected </head> in test HTML")
	}
	injected := html[:idx] + plazaInjectScript("http://example.com") + html[idx:]
	if !strings.Contains(injected, `data-plaza="1"`) {
		t.Error("injected HTML should contain plaza script marker")
	}
	if !strings.Contains(injected, "plaza-download-request") {
		t.Error("injected HTML should contain download intercept handler")
	}
}

func TestPlazaInjectScript_NoHead(t *testing.T) {
	html := `<html><body><p>no head tag</p></body></html>`
	// Should fall back to injecting after <body...>
	idx := strings.Index(strings.ToLower(html), "<body")
	if idx == -1 {
		t.Fatal("expected <body> in test HTML")
	}
	end := idx
	for end < len(html) && html[end] != '>' {
		end++
	}
	injected := html[:end+1] + plazaInjectScript("http://example.com") + html[end+1:]
	if !strings.Contains(injected, `data-plaza="1"`) {
		t.Error("fallback injection should still contain plaza script")
	}
}

func TestDownloadFromPlaza(t *testing.T) {
	// Mock target server with a file endpoint
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/model/test.pmx" {
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Write([]byte("fake-pmx-content"))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer target.Close()

	// Set up a temp directory as resource root
	tmpDir := t.TempDir()
	a := NewApp("test", "", "")
	a.updateConfig(func(cfg *Config) {
		cfg.ResourceRoot = tmpDir
	}, false)

	// Simulate an active plaza proxy to the test target host. The SSRF dial
	// guard normally blocks loopback (127.0.0.1), so swap in a plain client.
	currentProxyTarget = target.URL
	origClient := plazaDownloadClient
	plazaDownloadClient = &http.Client{Timeout: 120 * time.Second}
	defer func() {
		plazaDownloadClient = origClient
		currentProxyTarget = ""
	}()

	result, err := a.DownloadFromPlaza(target.URL+"/model/test.pmx", "test.pmx")
	if err != nil {
		t.Fatalf("DownloadFromPlaza() error: %v", err)
	}
	if result.FileName != "test.pmx" {
		t.Errorf("FileName = %q, want %q", result.FileName, "test.pmx")
	}
	if result.Size != 16 {
		t.Errorf("Size = %d, want 16", result.Size)
	}
	// .pmx should go to model/ subdir
	wantDir := filepath.Join(tmpDir, "model")
	if !strings.HasPrefix(result.FilePath, wantDir) {
		t.Errorf("FilePath = %q, should be under %s", result.FilePath, wantDir)
	}
}

// TestDownloadFromPlaza_NoActiveProxyRejected verifies the SSRF primary
// defense: downloads are only allowed while a plaza proxy is active.
func TestDownloadFromPlaza_NoActiveProxyRejected(t *testing.T) {
	a := NewApp("test", "", "")
	if _, err := a.DownloadFromPlaza("http://example.com/x.pmx", "x.pmx"); err == nil {
		t.Fatal("expected error when no active plaza proxy session")
	}
}

// TestDownloadFromPlaza_CrossHostRejected verifies that a download whose host
// differs from the active proxy target is rejected before any network call
// (covers loopback / link-local / private targets reachable via host mismatch).
func TestDownloadFromPlaza_CrossHostRejected(t *testing.T) {
	a := NewApp("test", "", "")
	currentProxyTarget = "http://plaza.example.com"
	defer func() { currentProxyTarget = "" }()
	if _, err := a.DownloadFromPlaza("http://169.254.169.254/latest/meta-data/", "x.pmx"); err == nil {
		t.Fatal("expected SSRF host-mismatch rejection for link-local address")
	}
	if _, err := a.DownloadFromPlaza("ftp://plaza.example.com/x.pmx", "x.pmx"); err == nil {
		t.Fatal("expected rejection for non-http(s) scheme")
	}
}

// TestIsBlockedIP exercises the address classifier used by the SSRF dial guard.
func TestIsBlockedIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "10.0.0.1", "172.16.0.1", "172.31.255.255",
		"192.168.1.1", "169.254.169.254", "::1", "fc00::1", "0.0.0.0",
	}
	for _, s := range blocked {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("failed to parse %q", s)
		}
		if !isBlockedIP(ip) {
			t.Errorf("isBlockedIP(%s) = false, want true", s)
		}
	}
	allowed := []string{
		"93.184.216.34", "1.1.1.1", "2606:2800:220:1:248:1893:25c8:1946",
	}
	for _, s := range allowed {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Fatalf("failed to parse %q", s)
		}
		if isBlockedIP(ip) {
			t.Errorf("isBlockedIP(%s) = true, want false", s)
		}
	}
}

// TestPlazaSSRFGuard_BlocksPrivate confirms the dial guard refuses to connect
// to loopback / link-local / private addresses (DNS-rebinding safe).
func TestPlazaSSRFGuard_BlocksPrivate(t *testing.T) {
	for _, addr := range []string{
		"127.0.0.1:80", "169.254.169.254:80", "10.0.0.1:80",
		"192.168.1.1:80", "[::1]:80", "[fc00::1]:80",
	} {
		_, err := plazaSSRFGuard(context.Background(), "tcp", addr)
		if err == nil || !strings.Contains(err.Error(), "blocked") {
			t.Errorf("plazaSSRFGuard(%q) = %v, want a 'blocked' error", addr, err)
		}
	}
}

// TestDownloadFromPlaza_SizeLimit verifies a download exceeding the cap is
// aborted and the partial file is cleaned up.
func TestDownloadFromPlaza_SizeLimit(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		buf := make([]byte, 4096)
		for i := 0; i < 300; i++ { // ~1.2 MiB
			if _, err := w.Write(buf); err != nil {
				return
			}
		}
	}))
	defer target.Close()

	tmpDir := t.TempDir()
	a := NewApp("test", "", "")
	a.updateConfig(func(cfg *Config) { cfg.ResourceRoot = tmpDir }, false)

	currentProxyTarget = target.URL
	origClient := plazaDownloadClient
	plazaDownloadClient = &http.Client{Timeout: 120 * time.Second}
	origCap := maxPlazaDownloadBytes
	maxPlazaDownloadBytes = 4096
	defer func() {
		plazaDownloadClient = origClient
		currentProxyTarget = ""
		maxPlazaDownloadBytes = origCap
	}()

	if _, err := a.DownloadFromPlaza(target.URL+"/big.pmx", "big.pmx"); err == nil {
		t.Fatal("expected size-limit error")
	}
	if _, err := os.Stat(filepath.Join(tmpDir, "model", "big.pmx")); !os.IsNotExist(err) {
		t.Error("partial download file should have been removed")
	}
}

// TestPlazaBindings_NoPanic confirms the four plaza bindings are wrapped with
// util.SafeCall / SafeCallVoid: invalid input yields an error, never a panic.
func TestPlazaBindings_NoPanic(t *testing.T) {
	a := NewApp("test", "", "")
	if _, err := a.StartProxy(""); err == nil {
		t.Error("StartProxy(\"\") should return an error")
	}
	if err := a.StopProxy(); err != nil {
		t.Errorf("StopProxy() with no running proxy should be nil, got %v", err)
	}
	if err := a.NavigatePlazaWindow(""); err == nil {
		t.Error("NavigatePlazaWindow(\"\") should return an error")
	}
}
