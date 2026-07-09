package app

import (
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
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
	injected := html[:idx] + plazaInjectScript + html[idx:]
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
	injected := html[:end+1] + plazaInjectScript + html[end+1:]
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

func TestExtractPlazaPage_NoRules(t *testing.T) {
	a := NewApp("test", "", "")
	// unknown site should return empty items, no error
	result, err := a.ExtractPlazaPage("https://example.com/page")
	if err != nil {
		t.Fatalf("ExtractPlazaPage() error: %v", err)
	}
	if len(result.Items) != 0 {
		t.Errorf("expected 0 items for unknown site, got %d", len(result.Items))
	}
}

func TestExtractPlazaPage_EmptyURL(t *testing.T) {
	a := NewApp("test", "", "")
	_, err := a.ExtractPlazaPage("")
	if err == nil {
		t.Error("expected error for empty URL")
	}
}

func TestExtractPlazaPage_GitHub(t *testing.T) {
	// Mock GitHub-like page
	html := `<html><head><title>test-user/test-repo</title></head><body>` +
		`<a class="js-navigation-open" href="/test-user/test-repo/blob/main/model.pmx">model.pmx</a>` +
		`<a class="js-navigation-open" href="/test-user/test-repo/blob/main/readme.md">readme.md</a>` +
		`</body></html>`

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(html))
	}))
	defer target.Close()

	a := NewApp("test", "", "")
	result, err := a.ExtractPlazaPage(target.URL)
	if err != nil {
		t.Fatalf("ExtractPlazaPage() error: %v", err)
	}
	// Mock server host (127.0.0.1) won't match github.com rule,
	// so result should be empty — that's expected behavior.
	// We test the extraction logic directly below.
	_ = result

	// Test extractItems directly with GitHub rule
	base, _ := url.Parse("https://github.com/test-user/test-repo")
	rule := findRule("github.com")
	if rule == nil {
		t.Fatal("findRule(github.com) returned nil")
	}
	var extracted PlazaExtractResult
	extractItems(html, rule, base, &extracted)

	if extracted.Title != "test-user/test-repo" {
		t.Errorf("Title = %q, want %q", extracted.Title, "test-user/test-repo")
	}
	if len(extracted.Items) < 1 {
		t.Fatalf("expected at least 1 item, got %d", len(extracted.Items))
	}
	found := false
	for _, item := range extracted.Items {
		if strings.Contains(item.URL, "model.pmx") {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected to find model.pmx link in extracted items")
	}
}

func TestFindRule(t *testing.T) {
	tests := []struct {
		host   string
		expect bool
	}{
		{"pixiv.net", true},
		{"www.pixiv.net", true},
		{"booth.pm", true},
		{"github.com", true},
		{"www.aplaybox.com", true},
		{"unknown.com", false},
	}
	for _, tt := range tests {
		r := findRule(tt.host)
		if (r != nil) != tt.expect {
			t.Errorf("findRule(%q) = %v, want match=%v", tt.host, r != nil, tt.expect)
		}
	}
}
