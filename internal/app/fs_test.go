package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
