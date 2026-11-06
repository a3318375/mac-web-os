//go:build !linux

package main

import "os"

func openVolume(volume, string, bool) (*os.File, error) { return nil, os.ErrInvalid }
func entryInfo(*os.File, string) (os.FileInfo, error)   { return nil, os.ErrInvalid }
