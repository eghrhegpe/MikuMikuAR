package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"mikumikuar/internal/util"
)

// ======== Safe Serving (Privacy Isolation) ========

// serveRootDir returns the root directory for isolated model directories (legacy).
// Kept for cleanup of existing data; no new copies are created.
func serveRootDir() (string, error) {
	cacheRoot, err := platformPathMgr.CacheRoot()
	if err != nil {
		return "", fmt.Errorf("serveRootDir: cache root unavailable: %w", err)
	}
	return filepath.Join(cacheRoot, "MikuMikuAR", "serve"), nil
}

// isSafePath checks whether a file path is inside any of the trusted directories
// (library root + external paths). Uses "/"-boundary-aware prefix matching to
// prevent path traversal (e.g. C:/ModelsSecret not matching C:/Models).
func (a *App) isSafePath(filePath string) bool {
	slash := filepath.ToSlash(filePath)

	for _, root := range a.trustedRoots() {
		rootSlash := strings.TrimRight(filepath.ToSlash(root), "/") + "/"
		if strings.HasPrefix(slash, rootSlash) {
			return true
		}
	}
	return false
}

// trustedRoots returns all directory paths that are safe to serve from.
func (a *App) trustedRoots() []string {
	cfg, err := a.GetConfig()
	if err != nil {
		return nil
	}
	var roots []string
	if cfg.ResourceRoot != "" {
		roots = append(roots, cfg.ResourceRoot)
	}
	if cfg.LibraryRoot != "" {
		roots = append(roots, cfg.LibraryRoot)
	}
	return roots
}

// IsolateModelDir ensures the model file is served from a safe directory.
// [doc:architecture] IsolateModelDir — 安全隔离
// 规范文档: docs/architecture.md §数据通道（HTTP 文件服务）
//
// Previously this function copied external files to a temp cache directory.
// Now it simply returns the original directory — the HTTP file server binds
// to 127.0.0.1 (localhost only) and uses http.Dir which prevents path
// traversal, making the copy unnecessary. This eliminates 600MB+ of
// redundant cached copies (see ADR-005).
//
// On Android, file:// is disabled and all model assets are served via the
// same 127.0.0.1 HTTP server, so the same simplification applies.
func (a *App) IsolateModelDir(filePath string) (string, error) {
	return util.SafeCall(func() (string, error) {
		return filepath.Dir(filePath), nil
	})
}

// copyFile copies a single file from src to dst, creating parent directories as needed.
// Used by watch.go for ImportLocalFile.
func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
