//go:build !release

package main

import "net/http"

func webFiles(override string) http.FileSystem {
	if override == "" {
		override = "../dist"
	}
	return http.Dir(override)
}
