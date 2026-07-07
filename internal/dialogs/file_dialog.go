package dialogs

import (
	"fmt"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func OpenFile(wailsApp *application.App, title string, filters []application.FileFilter) (string, error) {
	if wailsApp == nil {
		return "", fmt.Errorf("application not initialized")
	}
	dialog := wailsApp.Dialog.OpenFile()
	dialog.SetTitle(title)
	dialog.CanChooseFiles(true)
	for _, f := range filters {
		dialog.AddFilter(f.DisplayName, f.Pattern)
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

var pmxFilters = []application.FileFilter{
	{DisplayName: "PMX Model (*.pmx)", Pattern: "*.pmx"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

var importFilters = []application.FileFilter{
	{DisplayName: "PMX Model (*.pmx)", Pattern: "*.pmx"},
	{DisplayName: "MMD Archive (*.zip)", Pattern: "*.zip"},
	{DisplayName: "VMD Motion (*.vmd)", Pattern: "*.vmd"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

var vmdFilters = []application.FileFilter{
	{DisplayName: "VMD Motion (*.vmd)", Pattern: "*.vmd"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

var vpdFilters = []application.FileFilter{
	{DisplayName: "VPD Pose (*.vpd)", Pattern: "*.vpd"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

var audioFilters = []application.FileFilter{
	{DisplayName: "Audio Files (*.mp3 *.wav *.ogg)", Pattern: "*.mp3;*.wav;*.ogg"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

var envTextureFilters = []application.FileFilter{
	{DisplayName: "Environment Map (*.hdr *.dds *.exr)", Pattern: "*.hdr;*.dds;*.exr"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

var exeFilters = []application.FileFilter{
	{DisplayName: "Executable (*.exe)", Pattern: "*.exe"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

func SelectPMX(wailsApp *application.App) (string, error) {
	return OpenFile(wailsApp, "选择 PMX 模型文件", pmxFilters)
}

func SelectImport(wailsApp *application.App) (string, error) {
	return OpenFile(wailsApp, "选择 PMX / ZIP / VMD 文件", importFilters)
}

func SelectVMD(wailsApp *application.App) (string, error) {
	return OpenFile(wailsApp, "选择 VMD 动作文件", vmdFilters)
}

func SelectVPD(wailsApp *application.App) (string, error) {
	return OpenFile(wailsApp, "选择 VPD 姿势文件", vpdFilters)
}

func SelectAudio(wailsApp *application.App) (string, error) {
	return OpenFile(wailsApp, "选择音乐文件", audioFilters)
}

func SelectEnvTexture(wailsApp *application.App) (string, error) {
	return OpenFile(wailsApp, "选择环境贴图", envTextureFilters)
}

func SelectExe(wailsApp *application.App) (string, error) {
	return OpenFile(wailsApp, "选择可执行文件", exeFilters)
}
