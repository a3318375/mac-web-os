//go:build release

package main

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed web-build
var frontend embed.FS

func webFiles(override string) http.FileSystem {
	if override != "" {
		return http.Dir(override)
	}
	web, err := fs.Sub(frontend, "web-build")
	if err != nil {
		panic(err)
	}
	return http.FS(web)
}
