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

// serveDir returns the root directory for isolated model directories.
// Uses platformPathMgr.CacheRoot() so Android gets a writable private cache dir
// instead of os.TempDir() which may not exist on all Android devices.
func serveRootDir() (string, error) {
	cacheRoot, err := platformPathMgr.CacheRoot()
	if err != nil {
		return "", fmt.Errorf("serveRootDir: cache root unavailable: %w", err)
	}
	return filepath.Join(cacheRoot, "MikuMikuAR", "serve"), nil
}

// isolateDir copies the PMX file and ALL its sibling files/subdirectories
// to a cache directory. Uses a hash of the source path to prevent collisions.
// logFn is optional; when non-nil, failures during sibling copy are logged.
func isolateDir(filePath string, logFn func(string, ...interface{})) (string, error) {
	srcDir := filepath.Dir(filePath)
	hash := sha256Hex(srcDir)[:12]
	serveRoot, err := serveRootDir()
	if err != nil {
		if logFn != nil {
			logFn("isolateDir: serve root unavailable (%v), falling back to source dir", err)
		}
		return srcDir, err
	}
	dstDir := filepath.Join(serveRoot, hash)

	// Remove previous stale copy
	os.RemoveAll(dstDir)

	// Copy the PMX/VMD file itself
	baseName := filepath.Base(filePath)
	if err := copyFile(filePath, filepath.Join(dstDir, baseName)); err != nil {
		if logFn != nil {
			if isAndroid {
				// On Android, copy failures are usually permission issues;
				// probe the source path to aid diagnosis.
				srcInfo, statErr := os.Stat(filePath)
				srcDirInfo, dirStatErr := os.Stat(srcDir)
				logFn("isolateDir: copyFile(%s) failed: %v [android: srcStat=%v srcDirStat=%v srcIsDir=%v srcSize=%d dirIsDir=%v dirSize=%d], falling back to original dir",
					filePath, err, statErr, dirStatErr,
					srcInfo != nil && srcInfo.IsDir(),
					func() int64 { if srcInfo != nil { return srcInfo.Size() }; return 0 }(),
					srcDirInfo != nil && srcDirInfo.IsDir(),
					func() int64 { if srcDirInfo != nil { return srcDirInfo.Size() }; return 0 }(),
				)
			} else {
				logFn("isolateDir: copyFile(%s) failed: %v, falling back to original dir", filePath, err)
			}
		}
		return srcDir, err // fall back to original if copy fails
	}

	// Copy ALL sibling files and subdirectories (not just dirs — many models
	// have textures like face.bmp sitting next to the .pmx file)
	entries, err := fileAccessor.ReadDir(srcDir)
	if err != nil {
		if logFn != nil && isAndroid {
			logFn("isolateDir: ReadDir(%s) failed: %v [android: sibling scan skipped, only main file served]", srcDir, err)
		}
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
	in, err := fileAccessor.Open(src)
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
	return fileAccessor.WalkDir(src, func(path string, d os.DirEntry, err error) error {
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
		if err := copyFile(path, target); err != nil && logFn != nil {
			logFn("copyDir: copy error %s -> %s: %v", path, target, err)
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
	roots := make([]string, 0, 2+len(cfg.ExternalPaths))
	if cfg.ResourceRoot != "" {
		roots = append(roots, cfg.ResourceRoot)
	}
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
	return util.SafeCall(func() (string, error) {
		return a.isolateModelDirUnsafe(filePath)
	})
}

func (a *App) isolateModelDirUnsafe(filePath string) (string, error) {
	if a.isSafePath(filePath) {
		return filepath.Dir(filePath), nil
	}
	return isolateDir(filePath, a.safeLogError)
}
