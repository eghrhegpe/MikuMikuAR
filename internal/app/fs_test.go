package app

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ======== basenameFallbackFS ========

func TestBasenameFallbackFS_NormalFile(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "tex.png"), []byte("png-data"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	req := httptest.NewRequest("GET", "/tex.png", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.String() != "png-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "png-data")
	}
}

func TestBasenameFallbackFS_SubdirFile(t *testing.T) {
	tmp := t.TempDir()
	sub := filepath.Join(tmp, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "a.png"), []byte("sub-data"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	req := httptest.NewRequest("GET", "/sub/a.png", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.String() != "sub-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "sub-data")
	}
}

func TestBasenameFallbackFS_FallbackHit(t *testing.T) {
	tmp := t.TempDir()
	// File lives in a deep directory
	deep := filepath.Join(tmp, "deep", "path")
	if err := os.MkdirAll(deep, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deep, "texture.png"), []byte("fallback-data"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	// Request by basename only, not full path
	req := httptest.NewRequest("GET", "/texture.png", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for fallback hit", rec.Code)
	}
	if rec.Body.String() != "fallback-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "fallback-data")
	}
}

func TestBasenameFallbackFS_CaseInsensitiveFallback(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "Tex.PNG"), []byte("case-data"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	req := httptest.NewRequest("GET", "/tex.png", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for case-insensitive fallback", rec.Code)
	}
	if rec.Body.String() != "case-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "case-data")
	}
}

func TestBasenameFallbackFS_ChineseFilename(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "贴图.png"), []byte("cn-data"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	// URL-encoded Chinese: %E8%B4%B4%E5%9B%BE.png
	req := httptest.NewRequest("GET", "/%E8%B4%B4%E5%9B%BE.png", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for Chinese filename fallback", rec.Code)
	}
	if rec.Body.String() != "cn-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "cn-data")
	}
}

func TestBasenameFallbackFS_FallbackMiss(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "a.png"), []byte("exists"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	req := httptest.NewRequest("GET", "/missing.png", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for missing basename", rec.Code)
	}
}

func TestBasenameFallbackFS_EmptyDir(t *testing.T) {
	tmp := t.TempDir()

	handler := basenameFallbackFS(tmp, nil)
	req := httptest.NewRequest("GET", "/anything", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for empty dir", rec.Code)
	}
}

func TestBasenameFallbackFS_NonExistentRoot(t *testing.T) {
	// Should not panic; just serve 404s
	handler := basenameFallbackFS("/nonexistent/path", nil)
	req := httptest.NewRequest("GET", "/test.png", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	// Any status is acceptable as long as it doesn't panic
	_ = rec.Code
}

// ======== serveRootDir (Phase A verification) ========

func TestServeRootDir_UsesCacheRoot(t *testing.T) {
	dir, err := serveRootDir()
	if err != nil {
		t.Fatalf("serveRootDir() error: %v", err)
	}
	cacheRoot, _ := platformPathMgr.CacheRoot()
	expectedPrefix := filepath.Join(cacheRoot, "MikuMikuAR", "serve")
	if !startsWith(dir, expectedPrefix) {
		t.Errorf("serveRootDir() = %q, want under %q", dir, expectedPrefix)
	}
}

// ======== ?f= base64url query parameter (ADR-057) ========

func TestBasenameFallbackFS_QueryParamBase64(t *testing.T) {
	tmp := t.TempDir()
	sub := filepath.Join(tmp, "textures")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "face.png"), []byte("face-data"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	// "textures/face.png" base64url encoded = "dGV4dHVyZXMvZmFjZS5wbmc="
	enc := base64.RawURLEncoding.EncodeToString([]byte("textures/face.png"))
	req := httptest.NewRequest("GET", "/?f="+enc, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for ?f= hit", rec.Code)
	}
	if rec.Body.String() != "face-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "face-data")
	}
}

func TestBasenameFallbackFS_QueryParamBasename(t *testing.T) {
	tmp := t.TempDir()
	deep := filepath.Join(tmp, "a", "b")
	if err := os.MkdirAll(deep, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(deep, "skin.png"), []byte("skin-data"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	// ?f= with only basename (no subdir) should still find via index
	enc := base64.RawURLEncoding.EncodeToString([]byte("skin.png"))
	req := httptest.NewRequest("GET", "/?f="+enc, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for ?f= basename hit", rec.Code)
	}
	if rec.Body.String() != "skin-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "skin-data")
	}
}

func TestBasenameFallbackFS_QueryParamNotFound(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "a.png"), []byte("a"), 0644); err != nil {
		t.Fatal(err)
	}

	handler := basenameFallbackFS(tmp, nil)
	enc := base64.RawURLEncoding.EncodeToString([]byte("missing.png"))
	req := httptest.NewRequest("GET", "/?f="+enc, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for ?f= miss", rec.Code)
	}
}

func TestBasenameFallbackFS_QueryParamPathTraversal(t *testing.T) {
	tmp := t.TempDir()
	handler := basenameFallbackFS(tmp, nil)

	// Path traversal attempt via ?f=
	evil := base64.RawURLEncoding.EncodeToString([]byte("../etc/passwd"))
	req := httptest.NewRequest("GET", "/?f="+evil, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for path traversal attempt", rec.Code)
	}
}

// ======== corruptIndex (ADR-058: Shift-JIS/GBK mis-decoding fallback) ========

func TestBasenameFallbackFS_CorruptIndexShiftJIS(t *testing.T) {
	tmp := t.TempDir()
	// Write a file whose Shift-JIS encoding, when mis-decoded as UTF-8,
	// produces a different string containing U+FFFD replacement chars.
	// "あいうえお" (Japanese kana) Shift-JIS bytes mis-decoded as UTF-8
	// will produce strings with U+FFFD.
	// "あいうえお" (Japanese hiragana) are all in Shift-JIS repertoire.
	// When encoded to Shift-JIS bytes then mis-decoded as UTF-8, each
	// hiragana becomes a different multibyte sequence containing U+FFFD.
	filename := "あいうえお.png"
	if err := os.WriteFile(filepath.Join(tmp, filename), []byte("tex-data"), 0644); err != nil {
		t.Fatal(err)
	}

	var logBuf strings.Builder
	logFn := func(format string, args ...interface{}) {
		logBuf.WriteString(fmt.Sprintf(format, args...))
	}

	handler := basenameFallbackFS(tmp, logFn)
	// Request using the corrupt form (Shift-JIS mis-decoded as UTF-8)
	corruptName := toCorruptStringShiftJIS(filename)
	req := httptest.NewRequest("GET", "/"+corruptName, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for corrupt index hit", rec.Code)
	}
	if rec.Body.String() != "tex-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "tex-data")
	}
	if !strings.Contains(logBuf.String(), "corrupt match") {
		t.Errorf("expected corrupt match log, got: %s", logBuf.String())
	}
}

func TestBasenameFallbackFS_CorruptIndexGBK(t *testing.T) {
	tmp := t.TempDir()
	// A filename that produces GBK-corrupt fallback
	filename := "测试纹理.png"
	if err := os.WriteFile(filepath.Join(tmp, filename), []byte("gbk-data"), 0644); err != nil {
		t.Fatal(err)
	}

	var logBuf strings.Builder
	logFn := func(format string, args ...interface{}) {
		logBuf.WriteString(fmt.Sprintf(format, args...))
	}

	handler := basenameFallbackFS(tmp, logFn)
	corruptName := toCorruptStringGBK(filename)
	req := httptest.NewRequest("GET", "/"+corruptName, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 for GBK corrupt index hit", rec.Code)
	}
	if rec.Body.String() != "gbk-data" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "gbk-data")
	}
}

// ======== corruptIndex collision warning ========

func TestBasenameFallbackFS_CorruptIndexCollisionWarning(t *testing.T) {
	tmp := t.TempDir()
	// Two distinct filenames that produce the SAME corrupt string.
	// This should trigger a warning log.
	// Using Japanese characters that encode differently in Shift-JIS
	// but both produce the same corrupt (U+FFFD-laden) string.
	// The first file added wins; the second should log a warning.
	file1 := "あ.png"
	file2 := "ア.png"
	if err := os.WriteFile(filepath.Join(tmp, file1), []byte("file1"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, file2), []byte("file2"), 0644); err != nil {
		t.Fatal(err)
	}

	var logBuf strings.Builder
	logFn := func(format string, args ...interface{}) {
		logBuf.WriteString(fmt.Sprintf(format, args...))
	}

	// The corruptIndex should contain an entry for both filenames but the second
	// collision should produce a warning. We check by requesting the corrupt form
	// of file2 - if it matched file1, we know the collision was resolved
	// silently (old behavior). With the fix, file2 should still resolve to file1
	// but a warning should be logged.
	_ = basenameFallbackFS(tmp, logFn)
	logOutput := logBuf.String()
	// The indexing log should mention corrupt entries
	if !strings.Contains(logOutput, "corrupt entries") {
		t.Errorf("expected index log to mention corrupt entries, got: %s", logOutput)
	}
	// The collision warning must be logged (あ vs ア produce the same GBK corrupt string)
	if !strings.Contains(logOutput, "corruptIndex collision") {
		t.Errorf("expected 'corruptIndex collision' warning, got: %s", logOutput)
	}
}

// Note: since both files might map to different corrupt strings,
// we just verify the indexing doesn't panic and produces logs.

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
