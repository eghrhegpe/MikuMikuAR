//go:build android

package app

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// androidFileAccessor is a hybrid implementation:
//   - filesystem paths → os package (works for /data/data/... and /sdcard/...
//     provided MANAGE_EXTERNAL_STORAGE is granted)
//   - content:// URIs → ErrContentUriNotSupported (defensive guard)
//
// Wails v3 (alpha2.105+) natively handles SAF file selection via
// Dialog.OpenFile(), which copies selected files to the cache directory
// and returns real filesystem paths. Therefore content:// URIs should
// never reach this accessor in normal operation. The guard is retained
// as a safety net for any code path that might bypass the Wails dialog.
type androidFileAccessor struct{}

func newFileAccessor() FileAccessor { return &androidFileAccessor{} }

// ErrContentUriNotSupported is returned by Android's FileAccessor when a
// content:// URI is passed but the SAF bridge hasn't been wired up yet.
var ErrContentUriNotSupported = fmt.Errorf("content:// URI not supported until SAF bridge (Phase C)")

func (a *androidFileAccessor) Stat(path string) (os.FileInfo, error) {
	if isContentUri(path) {
		return nil, ErrContentUriNotSupported
	}
	return os.Stat(path)
}

func (a *androidFileAccessor) Open(path string) (io.ReadCloser, error) {
	if isContentUri(path) {
		return nil, ErrContentUriNotSupported
	}
	return os.Open(path)
}

func (a *androidFileAccessor) ReadDir(path string) ([]os.DirEntry, error) {
	if isContentUri(path) {
		return nil, ErrContentUriNotSupported
	}
	return os.ReadDir(path)
}

func (a *androidFileAccessor) WalkDir(root string, fn fs.WalkDirFunc) error {
	if isContentUri(root) {
		return ErrContentUriNotSupported
	}
	return filepath.WalkDir(root, fn)
}

func (a *androidFileAccessor) Abs(path string) (string, error) {
	if isContentUri(path) {
		return path, nil // content:// URIs are already absolute
	}
	return filepath.Abs(path)
}

func init() {
	fileAccessor = newFileAccessor()
}
