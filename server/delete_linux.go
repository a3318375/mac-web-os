package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"golang.org/x/sys/unix"
)

// Every directory is opened beneath its parent on the same mount. Symlinks
// inside a tree are unlinked without following them, including dangling links.
func deleteDirectoryEntry(ctx context.Context, v volume, relative, name string) error {
	if !validName(name) {
		return os.ErrInvalid
	}
	dir, err := openVolume(v, relative, true)
	if err != nil {
		return err
	}
	defer dir.Close()
	info, err := entryInfo(dir, name)
	if err != nil {
		return err
	}
	if !info.IsDir() && !info.Mode().IsRegular() {
		return os.ErrPermission
	}
	return removeTreeEntry(ctx, dir, name)
}

func removeTreeEntry(ctx context.Context, parent *os.File, name string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !validName(name) {
		return os.ErrPermission
	}
	parentFD := int(parent.Fd())
	fd, err := pathDescriptor(parentFD, name)
	if errors.Is(err, unix.ELOOP) {
		return unix.Unlinkat(parentFD, name, 0)
	}
	if err != nil {
		return err
	}
	descriptor := os.NewFile(uintptr(fd), name)
	defer descriptor.Close()
	info, err := descriptor.Stat()
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return unix.Unlinkat(parentFD, name, 0)
	}
	dir, err := os.Open(fmt.Sprintf("/proc/self/fd/%d", fd))
	if err != nil {
		return err
	}
	defer dir.Close()
	for {
		entries, err := dir.ReadDir(128)
		for _, entry := range entries {
			if err := removeTreeEntry(ctx, dir, entry.Name()); err != nil {
				return err
			}
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return unix.Unlinkat(parentFD, name, unix.AT_REMOVEDIR)
}
