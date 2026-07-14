package app

import (
	"io"
	"io/fs"
	"os"
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
