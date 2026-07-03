package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"mikumikuar/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	myApp := app.NewApp()

	wailsApp := application.New(application.Options{
		Name:        "MikuMikuAR",
		Description: "PMX Player with physics simulation",
		Services: []application.Service{
			application.NewService(myApp),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})

	wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "MikuMikuAR — PMX 播放器",
		Width:            1280,
		Height:           800,
		MinWidth:         800,
		MinHeight:        600,
		BackgroundColour: application.NewRGBA(30, 30, 40, 255),
		URL:              "/",
	})

	myApp.SetWailsApp(wailsApp)

	err := wailsApp.Run()
	if err != nil {
		log.Fatal(err)
	}
}
