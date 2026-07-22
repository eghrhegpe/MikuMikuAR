// [doc:adr-153] A11y system bridge — types & App method
// SystemA11ySettings struct 和 App binding 方法，跨平台共享。

package app

// SystemA11ySettings 系统无障碍设置
type SystemA11ySettings struct {
	IsDarkMode    bool `json:"isDarkMode"`
	IsHighContrast bool `json:"isHighContrast"`
}

// GetSystemA11ySettings 返回当前系统无障碍设置。
// 前端在启动时调用，并在收到 system_a11y 事件时重新查询。
// detectDarkMode/detectHighContrast 由平台特定文件实现。
func (a *App) GetSystemA11ySettings() SystemA11ySettings {
	return SystemA11ySettings{
		IsDarkMode:    detectDarkMode(),
		IsHighContrast: detectHighContrast(),
	}
}
