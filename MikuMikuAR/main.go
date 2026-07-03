package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	wailsApp := application.New(application.Options{
		Name:        "MikuMikuAR",
		Description: "PMX Player with physics simulation",
		Services: []application.Service{
			application.NewService(app),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})

	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:         "MikuMikuAR — PMX 播放器",
		Width:         1280,
		Height:        800,
		MinWidth:      800,
		MinHeight:     600,
		BackgroundColour: application.NewRGBA(30, 30, 40, 255),
		URL:           "/",
	})

	app.wailsApp = wailsApp

	err := wailsApp.Run()
	if err != nil {
		log.Fatal(err)
	}
}
