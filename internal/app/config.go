package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"mikumikuar/internal/util"
)

// currentConfigVersion is the latest config schema version.
// Increment when adding breaking config changes; add migration logic in finaliseConfig.
const currentConfigVersion = 1

// getConfigUnsafe reads config from the two-tier storage (bootstrap → setting/)
// without locking. Callers must hold configMu (RLock or Lock).
func (a *App) getConfigUnsafe() (*Config, error) {
	// cachedCfg is only written by writeConfig (under Lock), so reading it
	// under RLock (from GetConfig) or Lock (from updateConfig) is safe.
	if a.cachedCfg != nil {
		return a.cachedCfg, nil
	}

	// Phase 1: read bootstrap config from internal storage (configDir).
	// This gives us ResourceRoot so we can locate the setting/ directory.
	dir, err := configDir()
	if err != nil {
		return &Config{}, nil
	}
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil && !os.IsNotExist(err) {
		a.safeLogError("getConfigUnsafe: read error %v", err)
	}

	// Phase 2: if bootstrap has a ResourceRoot, also check setting/ for a
	// potentially newer copy written by writeConfig.
	if data != nil {
		var bootstrap Config
		if uErr := json.Unmarshal(data, &bootstrap); uErr == nil {
			a.finaliseConfig(&bootstrap)
			if bootstrap.ResourceRoot != "" {
				sd, sErr := settingDir(&bootstrap)
				if sErr == nil {
					settingData, rErr := os.ReadFile(filepath.Join(sd, "config.json"))
					if rErr == nil {
						var settingCfg Config
						if uErr := json.Unmarshal(settingData, &settingCfg); uErr == nil {
							a.finaliseConfig(&settingCfg)
							return &settingCfg, nil
						}
					}
				}
			}
			// No ResourceRoot or settingDir failed — use bootstrap as-is.
			return &bootstrap, nil
		}
	}

	// Phase 3: no valid config anywhere — return empty defaults.
	return &Config{}, nil
}

// GetConfig reads the persisted config from disk with a read lock,
// ensuring safe concurrent access with write operations.
func (a *App) GetConfig() (*Config, error) {
	a.configMu.RLock()
	defer a.configMu.RUnlock()
	return a.getConfigUnsafe()
}

// finaliseConfig runs migrations and ensure-dirs after loading a config.
func (a *App) finaliseConfig(cfg *Config) {
	// --- Migrations ---
	// v0 → v1: migrate library_root → resource_root
	if cfg.LibraryRoot != "" && cfg.ResourceRoot == "" {
		cfg.ResourceRoot = cfg.LibraryRoot
		cfg.LibraryRoot = ""
	}
	// Future migrations: if cfg.ConfigVersion < 2 { ... }

	// Stamp current version
	cfg.ConfigVersion = currentConfigVersion

	// Android: apply storage mode if set, default to "private"
	if runtime.GOOS == "android" {
		if cfg.StorageMode == "" {
			cfg.StorageMode = "private"
		}
		// If resource root is empty or matches the old default, sync with storage mode
		oldDefault := "/sdcard/MMD"
		privateDir := platformPathMgr.PrivateResourceRoot()
		sharedDir := platformPathMgr.SharedResourceRoot()
		if cfg.ResourceRoot == "" || cfg.ResourceRoot == oldDefault ||
			cfg.ResourceRoot == privateDir || cfg.ResourceRoot == sharedDir {
			switch cfg.StorageMode {
			case "shared":
				cfg.ResourceRoot = sharedDir
			default:
				cfg.ResourceRoot = privateDir
			}
		}
	}

	// Ensure resource directories exist
	a.ensureResourceDirs(cfg)
}

// updateConfig loads the config, runs a mutation under configMu, then persists.
// If rescan is true, it also re-scans the model index.
func (a *App) updateConfig(mutate func(*Config), rescan bool) error {
	a.configMu.Lock()
	defer a.configMu.Unlock()
	cfg, err := a.getConfigUnsafe()
	if err != nil {
		cfg = &Config{}
	}
	mutate(cfg)
	if rescan {
		a.safeLogInfo("[config-persist] updateConfig: rescan=true")
		return a.writeConfigAndRescan(cfg)
	}
	a.safeLogInfo("[config-persist] updateConfig: rescan=false")
	return a.writeConfig(cfg)
}

// SetResourceRoot persists the resource root path, initialises all category
// override paths to their default subdirectories, and triggers a rescan+reindex.
func (a *App) SetResourceRoot(root string) error {
	return a.updateConfig(func(cfg *Config) {
		cfg.ResourceRoot = root
		cfg.LibraryRoot = "" // clear old field
		// Atomically set default override paths for all categories
		if cfg.OverridePaths.PMX == "" {
			cfg.OverridePaths.PMX = filepath.Join(root, "PMX")
		}
		if cfg.OverridePaths.VMD == "" {
			cfg.OverridePaths.VMD = filepath.Join(root, "VMD")
		}
		if cfg.OverridePaths.Stage == "" {
			cfg.OverridePaths.Stage = filepath.Join(root, "stage")
		}
		if cfg.OverridePaths.Environment == "" {
			cfg.OverridePaths.Environment = filepath.Join(root, "environment")
		}
		if cfg.OverridePaths.MDDress == "" {
			cfg.OverridePaths.MDDress = filepath.Join(root, "MD-dress")
		}
		if cfg.OverridePaths.Setting == "" {
			cfg.OverridePaths.Setting = filepath.Join(root, "setting")
		}
		if cfg.OverridePaths.Audio == "" {
			cfg.OverridePaths.Audio = filepath.Join(root, "audio")
		}
		if cfg.OverridePaths.Prop == "" {
			cfg.OverridePaths.Prop = filepath.Join(root, "prop")
		}
	}, true)
}

// SetOverridePath sets an override path for a category and triggers a rescan.
func (a *App) SetOverridePath(category string, path string) error {
	return a.updateConfig(func(cfg *Config) {
		switch category {
		case "pmx":
			cfg.OverridePaths.PMX = path
		case "vmd":
			cfg.OverridePaths.VMD = path
		case "audio":
			cfg.OverridePaths.Audio = path
		case "prop":
			cfg.OverridePaths.Prop = path
		case "stage":
			cfg.OverridePaths.Stage = path
		case "environment":
			cfg.OverridePaths.Environment = path
		case "md_dress":
			cfg.OverridePaths.MDDress = path
		case "setting":
			cfg.OverridePaths.Setting = path
		}
	}, true)
}

// SetStorageMode switches the resource root between private and shared directories.
// Android only: "private" → app-specific dir, "shared" → /sdcard/MMD (needs MANAGE_EXTERNAL_STORAGE).
// On desktop this is a no-op.
func (a *App) SetStorageMode(mode string) error {
	if runtime.GOOS != "android" {
		return nil
	}
	if mode != "private" && mode != "shared" {
		return fmt.Errorf("invalid storage mode: %s", mode)
	}
	return a.updateConfig(func(cfg *Config) {
		cfg.StorageMode = mode
		switch mode {
		case "shared":
			cfg.ResourceRoot = platformPathMgr.SharedResourceRoot()
		default:
			cfg.ResourceRoot = platformPathMgr.PrivateResourceRoot()
		}
		cfg.OverridePaths = OverridePaths{} // reset overrides to re-derive from new root
	}, true)
}

// GetStorageMode returns the current storage mode ("private" or "shared").
// On desktop always returns "shared".
func (a *App) GetStorageMode() (string, error) {
	if runtime.GOOS != "android" {
		return "shared", nil
	}
	cfg, err := a.GetConfig()
	if err != nil {
		return "private", util.WrapErrorf("GetStorageMode", "get config", err)
	}
	if cfg.StorageMode == "" {
		return "private", nil
	}
	return cfg.StorageMode, nil
}

// SetBlenderPath saves the Blender executable path to config.
func (a *App) SetBlenderPath(path string) error {
	return a.updateConfig(func(cfg *Config) { cfg.BlenderPath = path }, false)
}

// SetDisplayNamePriority persists the display name priority setting.
func (a *App) SetDisplayNamePriority(priority string) error {
	return a.updateConfig(func(cfg *Config) { cfg.DisplayNamePriority = priority }, false)
}

// SetUIScale persists the UI scale factor.
func (a *App) SetUIScale(scale float64) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.Scale = scale }, false)
}

// SetUIPopupWidth persists the popup width.
func (a *App) SetUIPopupWidth(width int) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.PopupWidth = width }, false)
}

// SetUIAccent persists the accent color hex.
func (a *App) SetUIAccent(hex string) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.Accent = hex }, false)
}

// SetUIFontFamily persists the font family key ("system"|"noto"|"yahei").
func (a *App) SetUIFontFamily(key string) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.FontFamily = key }, false)
}

// SetUIAnimations enables or disables menu slide animations.
func (a *App) SetUIAnimations(on bool) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.Animations = on }, false)
}

// SetUIBlurBg enables or disables background blur on overlays.
func (a *App) SetUIBlurBg(on bool) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.BlurBg = on }, false)
}

// SetUIAutoUpdate persists whether to auto-check for updates on startup.
func (a *App) SetUIAutoUpdate(on bool) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.AutoUpdateEnabled = on }, false)
}

// SetPerformanceMode persists the performance mode setting.
func (a *App) SetPerformanceMode(mode string) error {
	return a.updateConfig(func(cfg *Config) { cfg.UIState.PerformanceMode = mode }, false)
}

// SetEnvState persists the environment state (sky, ground, particles, fog, etc.).
// Uses JSON-based merge (not full-replace) so that callers passing only a subset
// of fields do not wipe the other persisted env state fields.
func (a *App) SetEnvState(env EnvState) error {
	a.safeLogInfo("[env-persist] SetEnvState: skyMode=%s groundVisible=%v waterEnabled=%v",
		env.SkyMode, env.GroundVisible, env.WaterEnabled)
	return a.updateConfig(func(cfg *Config) { mergeEnvState(&cfg.Env, env) }, false)
}

// mergeEnvState merges src into dst using JSON marshal/unmarshal, preserving
// any dst fields not present in src. Uses JSON round-trip so struct tags are
// authoritative — the same tags the frontend uses for serialization.
func mergeEnvState(dst **EnvState, src EnvState) {
	if *dst == nil {
		*dst = &src
		return
	}
	data, err := json.Marshal(src)
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, *dst)
}

// SetUIState merges the provided UI state fields into the persisted config.
// Uses merge (not full-replace) so that callers passing only a subset of fields
// (e.g. setResourceViewMode sending just {resourceViewMode}) do not wipe the
// other persisted UI state fields.
func (a *App) SetUIState(ui UIState) error {
	a.safeLogInfo("[ui-persist] SetUIState: scale=%.1f popupWidth=%d perfMode=%s",
		ui.Scale, ui.PopupWidth, ui.PerformanceMode)
	return a.updateConfig(func(cfg *Config) { mergeUIState(&cfg.UIState, ui) }, false)
}

// mergeUIState copies only the non-zero fields from src into dst, preserving
// any dst fields not present in src. This keeps partial updates safe.
func mergeUIState(dst *UIState, src UIState) {
	if src.Scale != 0 {
		dst.Scale = src.Scale
	}
	if src.PopupWidth != 0 {
		dst.PopupWidth = src.PopupWidth
	}
	if src.Accent != "" {
		dst.Accent = src.Accent
	}
	if src.FontFamily != "" {
		dst.FontFamily = src.FontFamily
	}
	// bool 字段无零值歧义，直接覆盖（false 是有效值）
	dst.Animations = src.Animations
	dst.BlurBg = src.BlurBg
	if src.PerformanceMode != "" {
		dst.PerformanceMode = src.PerformanceMode
	}
	if src.ScreenshotFormat != "" {
		dst.ScreenshotFormat = src.ScreenshotFormat
	}
	if src.ScreenshotQuality != 0 {
		dst.ScreenshotQuality = src.ScreenshotQuality
	}
	if src.ScreenshotDir != "" {
		dst.ScreenshotDir = src.ScreenshotDir
	}
	dst.AutoCameraEnabled = src.AutoCameraEnabled
	if src.AutoCameraBeatsPerSwitch != 0 {
		dst.AutoCameraBeatsPerSwitch = src.AutoCameraBeatsPerSwitch
	}
	dst.AutoUpdateEnabled = src.AutoUpdateEnabled
	if src.FpsLimit != 0 {
		dst.FpsLimit = src.FpsLimit
	}
	dst.Vsync = src.Vsync
	dst.DefaultPhysicsEnabled = src.DefaultPhysicsEnabled
	if src.RenderScale != 0 {
		dst.RenderScale = src.RenderScale
	}
	if src.CameraSensitivity != 0 {
		dst.CameraSensitivity = src.CameraSensitivity
	}
	dst.InvertYAxis = src.InvertYAxis
	dst.AutoScaleModel = src.AutoScaleModel
	dst.AutoCenterModel = src.AutoCenterModel
	if src.MaterialCategoryMap != nil {
		dst.MaterialCategoryMap = src.MaterialCategoryMap
	}
	if src.ResourceViewMode != "" {
		dst.ResourceViewMode = src.ResourceViewMode
	}
	if src.Volume != 0 {
		dst.Volume = src.Volume
	}
	if src.AudioOffset != 0 {
		dst.AudioOffset = src.AudioOffset
	}
	dst.BpmQuantizeEnabled = src.BpmQuantizeEnabled
	dst.AutoLoadCompanionAudio = src.AutoLoadCompanionAudio
	dst.SfxEnabled = src.SfxEnabled
	if src.SfxVolume != 0 {
		dst.SfxVolume = src.SfxVolume
	}
	dst.FootstepEnabled = src.FootstepEnabled
	if src.FootstepVolume != 0 {
		dst.FootstepVolume = src.FootstepVolume
	}
	if src.ThumbnailResolution != 0 {
		dst.ThumbnailResolution = src.ThumbnailResolution
	}
	if src.KeyBindings != nil {
		dst.KeyBindings = src.KeyBindings
	}
	// Android 屏幕常亮（指针区分 nil=开启 vs false=关闭）
	if src.KeepAwake != nil {
		dst.KeepAwake = src.KeepAwake
	}
	// Android 屏幕方向（空=auto，显式保存 "auto"/"portrait"/"landscape"）
	if src.ScreenOrientation != "" {
		dst.ScreenOrientation = src.ScreenOrientation
	}
}