package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"

	"golang.org/x/sys/unix"
)

func copyFile(ctx context.Context, source volume, sourcePath string, target volume, targetPath string) error {
	input, err := openVolume(source, sourcePath, false)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	directory, err := openVolume(target, targetPath, true)
	if err != nil {
		return err
	}
	defer directory.Close()

	dirFD := int(directory.Fd())
	name := path.Base(sourcePath)
	if err := unix.Faccessat(dirFD, name, unix.F_OK, unix.AT_SYMLINK_NOFOLLOW); err == nil {
		return os.ErrExist
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	output, err := os.CreateTemp(fmt.Sprintf("/proc/self/fd/%d", dirFD), ".mac-web-os-copy-*")
	if err != nil {
		return err
	}
	tempName := path.Base(output.Name())
	defer func() {
		if tempName != "" {
			_ = unix.Unlinkat(dirFD, tempName, 0)
		}
	}()
	defer output.Close()
	if _, err := io.Copy(output, copyReader{ctx: ctx, file: input}); err != nil {
		return err
	}
	if err := output.Chmod(info.Mode().Perm()); err != nil {
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := unix.Renameat2(dirFD, tempName, dirFD, name, unix.RENAME_NOREPLACE); err != nil {
		return err
	}
	tempName = ""
	return nil
}

type copyReader struct {
	ctx  context.Context
	file *os.File
}

func (reader copyReader) Read(buffer []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	return reader.file.Read(buffer)
}

func openVolume(v volume, relative string, directory bool) (*os.File, error) {
	root, err := unix.Open(v.Mount, unix.O_PATH|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	defer unix.Close(root)
	var stat unix.Statx_t
	if err := unix.Statx(root, "", unix.AT_EMPTY_PATH, unix.STATX_MNT_ID, &stat); err != nil {
		return nil, err
	}
	if stat.Mask&unix.STATX_MNT_ID == 0 || fmt.Sprint(stat.Mnt_id) != v.ID {
		return nil, os.ErrNotExist
	}
	fd, err := pathDescriptor(root, relative)
	if err != nil {
		return nil, err
	}
	defer unix.Close(fd)
	var info unix.Stat_t
	if err := unix.Fstat(fd, &info); err != nil {
		return nil, err
	}
	expected := uint32(unix.S_IFREG)
	if directory {
		expected = unix.S_IFDIR
	}
	if uint32(info.Mode)&unix.S_IFMT != expected {
		return nil, os.ErrPermission
	}
	return os.Open(fmt.Sprintf("/proc/self/fd/%d", fd))
}

func pathDescriptor(parent int, relative string) (int, error) {
	return unix.Openat2(parent, relative, &unix.OpenHow{
		Flags:   unix.O_PATH | unix.O_CLOEXEC,
		Resolve: unix.RESOLVE_BENEATH | unix.RESOLVE_NO_XDEV | unix.RESOLVE_NO_SYMLINKS,
	})
}

func entryInfo(dir *os.File, name string) (os.FileInfo, error) {
	fd, err := pathDescriptor(int(dir.Fd()), name)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), name)
	defer file.Close()
	return file.Stat()
}

func volumeSpace(v volume) (filesystemSpace, error) {
	root, err := openVolume(v, ".", true)
	if err != nil {
		return filesystemSpace{}, err
	}
	defer root.Close()
	var stat unix.Statfs_t
	if err := unix.Fstatfs(int(root.Fd()), &stat); err != nil {
		return filesystemSpace{}, err
	}
	blockSize := stat.Frsize
	if blockSize <= 0 {
		blockSize = stat.Bsize
	}
	if blockSize <= 0 || stat.Bfree > stat.Blocks {
		return filesystemSpace{}, os.ErrInvalid
	}
	return filesystemSpace{Mount: v.Mount, Used: (stat.Blocks - stat.Bfree) * uint64(blockSize), Free: stat.Bfree * uint64(blockSize)}, nil
}
