package app

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
)

// ======== Thumbnail Cache ========

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// thumbKey builds a content-aware cache key for a model file.
// Uses path + mtime + size so the thumbnail auto-invalidates when
// the model file is modified (e.g. re-textured, re-exported).
// Falls back to path-only hash if stat fails (e.g. file gone).
func thumbKey(modelPath string) string {
	info, err := os.Stat(modelPath)
	if err != nil {
		return sha256Hex(modelPath)
	}
	return sha256Hex(modelPath + "|" + info.ModTime().Format("20060102-150405.000") + "|" + strconv.FormatInt(info.Size(), 10))
}

// SaveThumbnail saves a base64-encoded PNG thumbnail for the given model path.
func (a *App) SaveThumbnail(modelPath string, base64PNG string) error {
	thumbDir, err := thumbnailDir()
	if err != nil {
		return err
	}
	hash := thumbKey(modelPath)
	thumbPath := filepath.Join(thumbDir, hash+".png")
	data, err := base64.StdEncoding.DecodeString(base64PNG)
	if err != nil {
		return err
	}
	a.safeLogInfo("SaveThumbnail: %s → %s (%d bytes)", modelPath, thumbPath, len(data))
	return os.WriteFile(thumbPath, data, 0644)
}

// SaveScreenshot saves a base64-encoded PNG screenshot to the specified directory.
func (a *App) SaveScreenshot(dir string, filename string, base64PNG string) error {
	data, err := base64.StdEncoding.DecodeString(base64PNG)
	if err != nil {
		return err
	}
	path := filepath.Join(dir, filename)
	a.safeLogInfo("SaveScreenshot: %s (%d bytes)", path, len(data))
	return os.WriteFile(path, data, 0644)
}

// GetThumbnail returns a base64-encoded PNG thumbnail for the given model path.
func (a *App) GetThumbnail(modelPath string) (string, error) {
	thumbDir, err := thumbnailDir()
	if err != nil {
		return "", err
	}
	hash := thumbKey(modelPath)
	data, err := os.ReadFile(filepath.Join(thumbDir, hash+".png"))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// GetThumbnailBatch returns thumbnails for multiple model paths at once.
func (a *App) GetThumbnailBatch(paths []string) (map[string]string, error) {
	result := make(map[string]string)
	for _, p := range paths {
		if b64, err := a.GetThumbnail(p); err == nil {
			result[p] = b64
		}
	}
	return result, nil
}
