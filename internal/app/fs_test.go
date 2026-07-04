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

// ======== serveRootDir + isolateDir (Phase A verification) ========

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

func TestIsolateDir_CopiesToCacheServe(t *testing.T) {
	// Setup: a fake model directory with a PMX + textures
	src := t.TempDir()
	pmxData := []byte("fake-pmx-data")
	texData := []byte("fake-texture-data")
	if err := os.WriteFile(filepath.Join(src, "model.pmx"), pmxData, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "tex.png"), texData, 0644); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(src, "textures")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "face.bmp"), []byte("face-data"), 0644); err != nil {
		t.Fatal(err)
	}

	isolated, err := isolateDir(filepath.Join(src, "model.pmx"), nil)
	if err != nil {
		t.Fatalf("isolateDir() error: %v", err)
	}

	// Verify it's under the serve root
	cacheRoot, _ := platformPathMgr.CacheRoot()
	serveRoot := filepath.Join(cacheRoot, "MikuMikuAR", "serve")
	if !startsWith(isolated, serveRoot) {
		t.Errorf("isolated dir = %q, want under %q", isolated, serveRoot)
	}

	// Verify files were copied
	for name, want := range map[string]string{
		"model.pmx":          "fake-pmx-data",
		"tex.png":            "fake-texture-data",
		"textures/face.bmp":  "face-data",
	} {
		got, err := os.ReadFile(filepath.Join(isolated, name))
		if err != nil {
			t.Errorf("missing file %q: %v", name, err)
			continue
		}
		if string(got) != want {
			t.Errorf("file %q content = %q, want %q", name, got, want)
		}
	}
}

func TestIsolateDir_DeterministicHash(t *testing.T) {
	src := t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "m.pmx"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	a, err := isolateDir(filepath.Join(src, "m.pmx"), nil)
	if err != nil {
		t.Fatal(err)
	}
	b, err := isolateDir(filepath.Join(src, "m.pmx"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("same source dir gave different isolated dirs:\n  a=%s\n  b=%s", a, b)
	}
}

func TestIsolateDir_DifferentSourcesDifferentDirs(t *testing.T) {
	src1 := t.TempDir()
	src2 := t.TempDir()
	if err := os.WriteFile(filepath.Join(src1, "m.pmx"), []byte("1"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src2, "m.pmx"), []byte("2"), 0644); err != nil {
		t.Fatal(err)
	}

	a, _ := isolateDir(filepath.Join(src1, "m.pmx"), nil)
	b, _ := isolateDir(filepath.Join(src2, "m.pmx"), nil)
	if a == b {
		t.Errorf("different source dirs gave same isolated dir: %s", a)
	}
}

func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
