package app

import (
	"mikumikuar/internal/thumbnail"
)

// ======== Thumbnail Cache ========

// getThumbnailRoot returns the resource root path for relative cache key computation.
func (a *App) getThumbnailRoot() string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.ResourceRoot == "" {
		return ""
	}
	return cfg.ResourceRoot
}

// SaveThumbnail saves a base64-encoded PNG thumbnail for the given model path.
func (a *App) SaveThumbnail(modelPath string, base64PNG string) error {
	thumbDir, err := thumbnailDir()
	if err != nil {
		return err
	}
	a.safeLogInfo("SaveThumbnail: %s (%d bytes)", modelPath, len(base64PNG))
	return thumbnail.Save(thumbDir, modelPath, a.getThumbnailRoot(), base64PNG)
}

// SaveScreenshot saves a base64-encoded PNG screenshot to the specified directory.
func (a *App) SaveScreenshot(dir string, filename string, base64PNG string) error {
	a.safeLogInfo("SaveScreenshot: %s/%s (%d bytes)", dir, filename, len(base64PNG))
	return thumbnail.SaveScreenshot(dir, filename, base64PNG)
}

// GetThumbnail returns a base64-encoded PNG thumbnail for the given model path.
func (a *App) GetThumbnail(modelPath string) (string, error) {
	thumbDir, err := thumbnailDir()
	if err != nil {
		return "", err
	}
	return thumbnail.Get(thumbDir, modelPath, a.getThumbnailRoot())
}

// GetThumbnailBatch returns thumbnails for multiple model paths at once.
func (a *App) GetThumbnailBatch(paths []string) (map[string]string, error) {
	thumbDir, err := thumbnailDir()
	if err != nil {
		return nil, err
	}
	return thumbnail.GetBatch(thumbDir, paths, a.getThumbnailRoot())
}
