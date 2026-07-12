package dialogs

import (
	"fmt"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func OpenFile(wailsApp *application.App, title string, filters []application.FileFilter, startDir string) (string, error) {
	if wailsApp == nil {
		return "", fmt.Errorf("application not initialized")
	}
	dialog := wailsApp.Dialog.OpenFile()
	dialog.SetTitle(title)
	if startDir != "" {
		dialog.SetDirectory(startDir)
	}
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

func SelectPMX(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "选择 PMX 模型文件", pmxFilters, startDir)
}

func SelectImport(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "选择 PMX / ZIP / VMD 文件", importFilters, startDir)
}

func SelectVMD(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "选择 VMD 动作文件", vmdFilters, startDir)
}

func SelectVPD(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "选择 VPD 姿势文件", vpdFilters, startDir)
}

func SelectAudio(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "选择音乐文件", audioFilters, startDir)
}

func SelectEnvTexture(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "选择环境贴图", envTextureFilters, startDir)
}

func SelectExe(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "选择可执行文件", exeFilters, startDir)
}

var presetFilters = []application.FileFilter{
	{DisplayName: "MikuMikuAR Model Preset (*.mcupreset.json)", Pattern: "*.mcupreset.json"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

var sceneFilters = []application.FileFilter{
	{DisplayName: "MikuMikuAR Scene (*.mmascene)", Pattern: "*.mmascene"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

func SelectPresetOpen(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "加载模型预设", presetFilters, startDir)
}

func SelectSceneOpen(wailsApp *application.App, startDir string) (string, error) {
	return OpenFile(wailsApp, "加载场景", sceneFilters, startDir)
}

func SaveFile(wailsApp *application.App, title, filename string, filters []application.FileFilter, startDir string) (string, error) {
	if wailsApp == nil {
		return "", fmt.Errorf("application not initialized")
	}
	dialog := wailsApp.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{
		Title:    title,
		Filename: filename,
		Filters:  filters,
	})
	if startDir != "" {
		dialog.SetDirectory(startDir)
	}
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

func SelectPresetSave(wailsApp *application.App, startDir string) (string, error) {
	return SaveFile(wailsApp, "保存模型预设", "preset.mcupreset.json", presetFilters, startDir)
}

func SelectSceneSave(wailsApp *application.App, startDir string) (string, error) {
	return SaveFile(wailsApp, "保存场景", "scene.mmascene", sceneFilters, startDir)
}

func SelectBundleSave(wailsApp *application.App, startDir string) (string, error) {
	return SaveFile(wailsApp, "导出场景包", "scene.mmascene", sceneFilters, startDir)
}

func SelectDir(wailsApp *application.App, title, startDir string) (string, error) {
	if wailsApp == nil {
		return "", fmt.Errorf("application not initialized")
	}
	dialog := wailsApp.Dialog.OpenFile()
	dialog.SetTitle(title)
	if startDir != "" {
		dialog.SetDirectory(startDir)
	}
	dialog.CanChooseDirectories(true)
	dialog.CanChooseFiles(false)
	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(path), nil
}

func SelectLibraryDir(wailsApp *application.App, startDir string) (string, error) {
	return SelectDir(wailsApp, "选择模型库根目录", startDir)
}
