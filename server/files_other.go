//go:build !linux

package main

import (
	"context"
	"os"
)

func editDirectory(volume, string, string, string) error { return os.ErrInvalid }

func openVolume(volume, string, bool) (*os.File, error)              { return nil, os.ErrInvalid }
func entryInfo(*os.File, string) (os.FileInfo, error)                { return nil, os.ErrInvalid }
func copyFile(context.Context, volume, string, volume, string) error { return os.ErrInvalid }
func volumeSpace(volume) (filesystemSpace, error)                    { return filesystemSpace{}, os.ErrInvalid }
