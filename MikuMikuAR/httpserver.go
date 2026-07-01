package main

import (
	"os"
	"path/filepath"
	"strings"

	"io"
)

// ======== Safe Serving (Privacy Isolation) ========

// isolateDir copies the PMX file and ALL its sibling files/subdirectories
// to a temp directory. Uses a hash of the source path to prevent collisions.
// logFn is optional; when non-nil, failures during sibling copy are logged.
func isolateDir(filePath string, logFn func(string, ...interface{})) (string, error) {
	srcDir := filepath.Dir(filePath)
	hash := sha256Hex(srcDir)[:12]
	dstDir := filepath.Join(os.TempDir(), "MikuMikuAR", "serve", hash)

	// Remove previous stale copy
	os.RemoveAll(dstDir)

	// Copy the PMX/VMD file itself
	baseName := filepath.Base(filePath)
	if err := copyFile(filePath, filepath.Join(dstDir, baseName)); err != nil {
		if logFn != nil {
			logFn("isolateDir: copyFile(%s) failed: %v, falling back to original dir", filePath, err)
		}
		return srcDir, err // fall back to original if copy fails
	}

	// Copy ALL sibling files and subdirectories (not just dirs — many models
	// have textures like face.bmp sitting next to the .pmx file)
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return dstDir, nil
	}
	for _, e := range entries {
		src := filepath.Join(srcDir, e.Name())
		dst := filepath.Join(dstDir, e.Name())
		if e.IsDir() {
			copyDir(src, dst, logFn)
		} else if e.Name() != baseName {
			if err := copyFile(src, dst); err != nil && logFn != nil {
				logFn("isolateDir: copyFile sibling %s failed: %v", src, err)
			}
		}
	}
	return dstDir, nil
}

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

func copyDir(src, dst string, logFn func(string, ...interface{})) error {
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if logFn != nil {
				logFn("copyDir: walk error at %s: %v", path, err)
			}
			return nil
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			if logFn != nil {
				logFn("copyDir: read error %s: %v", path, err)
			}
			return nil
		}
		if err := os.WriteFile(target, data, 0644); err != nil {
			if logFn != nil {
				logFn("copyDir: write error %s -> %s: %v", path, target, err)
			}
			return nil
		}
		return nil
	})
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
	cfg, _ := a.GetConfig()
	roots := make([]string, 0, 1+len(cfg.ExternalPaths))
	if cfg.LibraryRoot != "" {
		roots = append(roots, cfg.LibraryRoot)
	}
	for _, ep := range cfg.ExternalPaths {
		if ep.Path != "" {
			roots = append(roots, ep.Path)
		}
	}
	return roots
}

// IsolateModelDir ensures the model file is served from a safe directory.
// [doc:architecture] IsolateModelDir — 安全隔离：信任目录返回原目录，外部文件复制到 temp
// 规范文档: docs/architecture.md §数据通道（HTTP 文件服务）
// For files inside trusted roots, returns the original directory unchanged.
// For external files, copies PMX + all siblings to a temp directory.
func (a *App) IsolateModelDir(filePath string) (string, error) {
	return safeCall(func() (string, error) {
		return a.isolateModelDirUnsafe(filePath)
	})
}

func (a *App) isolateModelDirUnsafe(filePath string) (string, error) {
	if a.isSafePath(filePath) {
		return filepath.Dir(filePath), nil
	}
	return isolateDir(filePath, a.safeLogError)
}
