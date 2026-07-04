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
//   - content:// URIs → SAF bridge (Phase C, returns ErrContentUriNotSupported for now)
//   - filesystem paths → os package (works for /data/data/... and /sdcard/...
//     provided MANAGE_EXTERNAL_STORAGE is granted)
//
// When Phase C lands, the content:// branch will delegate to a SAF bridge
// that calls ContentResolver via JNI. Call sites won't need to change.
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
