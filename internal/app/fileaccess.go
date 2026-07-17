package app

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// FileAccessor abstracts read-only file system operations across platforms.
//
// Desktop: thin wrapper over the os package, zero behavior difference.
// Android: hybrid — os for private/sdcard paths, SAF bridge for content://
// URIs (Phase C). Until SAF lands, the Android implementation also uses the
// os package directly; the abstraction exists so call sites don't need to
// change again when SAF arrives.
//
// Write operations (Create/MkdirAll/Remove) are intentionally NOT abstracted:
// all writes happen in the app's private directory where os.* always works.
type FileAccessor interface {
	// Stat returns FileInfo for the given path.
	Stat(path string) (os.FileInfo, error)

	// Open opens a file for reading.
	Open(path string) (io.ReadCloser, error)

	// ReadDir reads a directory's entries.
	ReadDir(path string) ([]os.DirEntry, error)

	// WalkDir recursively walks a directory tree.
	WalkDir(root string, fn fs.WalkDirFunc) error

	// Abs returns an absolute representation of the path.
	Abs(path string) (string, error)
}

// fileAccessor is the package-level singleton initialized by build-tagged
// platform implementations. Call sites should use this instead of os.* so
// that SAF (Phase C) can be injected transparently.
var fileAccessor FileAccessor

// isContentUri reports whether path is an Android SAF content:// URI.
// Used by Android's hybrid implementation to route to the SAF bridge.
func isContentUri(path string) bool {
	return len(path) >= 9 && path[:9] == "content:/"
}

// ReadTextFile reads the entire contents of the file at path and returns it
// as a string. It is the Go-side counterpart of Wails v2's
// runtime.ReadTextFile, which was removed in v3; the frontend uses it to load
// user-managed text files such as the custom plaza sites list
// (plaza_sites.json). Returns an error if the file cannot be read (e.g. does
// not exist), letting the caller fall back gracefully.
func (a *App) ReadTextFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ReadFileBytes reads the entire contents of the file at path and returns it
// as a byte slice. Wails v3 automatically maps []byte to Uint8Array on the
// frontend side. This is the binary counterpart of ReadTextFile, used by the
// Phase 1 ArrayBuffer migration (ADR-124) to replace HTTP file server reads
// for PMX/VMD/audio files.
func (a *App) ReadFileBytes(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return data, nil
}

// ListDir returns the list of file names (not directories) in the given
// directory. Used by Phase 2 (ADR-124) to enumerate texture files alongside
// a PMX model for building IArrayBufferFile[] referenceFiles.
func (a *App) ListDir(dirPath string) ([]string, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names, nil
}

// FileInfo represents a file entry with its relative path from the root.
type FileInfo struct {
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
}

// ListDirRecursive recursively walks dirPath and returns all non-directory
// entries with their relative paths from dirPath. Used by Phase 2 (ADR-124)
// to collect texture files in subdirectories for babylon-mmd referenceFiles.
func (a *App) ListDirRecursive(dirPath string) ([]FileInfo, error) {
	var files []FileInfo
	err := filepath.WalkDir(dirPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // skip inaccessible entries
		}
		if d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(dirPath, path)
		files = append(files, FileInfo{
			Name:         d.Name(),
			RelativePath: filepath.ToSlash(rel), // normalize to forward slash for web
		})
		return nil
	})
	return files, err
}

// FileExists reports whether the named file exists and is accessible.
// Used by outfit texture probing — much cheaper than ReadFileBytes for
// existence checks on potentially large texture files.
func (a *App) FileExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}
