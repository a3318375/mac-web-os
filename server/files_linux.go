package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

func copyFile(ctx context.Context, source volume, sourcePath string, target volume, targetPath string) error {
	input, err := openVolume(source, sourcePath, false)
	if errors.Is(err, os.ErrPermission) {
		input, err = openVolume(source, sourcePath, true)
	}
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
	if info.IsDir() {
		if source.ID == target.ID && (targetPath == sourcePath || strings.HasPrefix(targetPath, sourcePath+"/")) {
			return errCopyIntoSource
		}
		return copyDirectory(ctx, input, directory, name)
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
	reportCopy(ctx, func(task *copyTask) { task.Total = info.Size(); task.Current = name })
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
	finishCopyFile(ctx, name)
	return nil
}

func copyDirectory(ctx context.Context, input, directory *os.File, name string) error {
	dirFD := int(directory.Fd())
	target := fmt.Sprintf("/proc/self/fd/%d", dirFD)
	staging, err := os.MkdirTemp(target, ".mac-web-os-copy-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)

	item := staging + "/item"
	if err := copyTree(ctx, input, item, name); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return unix.Renameat2(dirFD, path.Base(staging)+"/item", dirFD, name, unix.RENAME_NOREPLACE)
}

func copyTree(ctx context.Context, source *os.File, destination, relative string) error {
	info, err := source.Stat()
	if err != nil {
		return err
	}
	if err := os.Mkdir(destination, 0700); err != nil {
		return err
	}
	for {
		entries, err := source.ReadDir(128)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		for _, entry := range entries {
			name := entry.Name()
			if !visiblePath(name) {
				return errCopyIntoSource
			}
			child := path.Join(relative, name)
			reportCopy(ctx, func(task *copyTask) {
				task.Current = child
				task.FileBytes = 0
				task.FileTotal = 0
			})
			if err := copyTreeEntry(ctx, source, name, filepath.Join(destination, name), child); err != nil {
				return err
			}
		}
	}
	return os.Chmod(destination, info.Mode().Perm())
}

func copyTreeEntry(ctx context.Context, parent *os.File, name, destination, relative string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	fd, err := pathDescriptor(int(parent.Fd()), name)
	if errors.Is(err, unix.ELOOP) {
		buffer := make([]byte, 4096)
		count, err := unix.Readlinkat(int(parent.Fd()), name, buffer)
		if err != nil {
			return err
		}
		if count == len(buffer) {
			return os.ErrInvalid
		}
		if err := os.Symlink(string(buffer[:count]), destination); err != nil {
			return err
		}
		finishCopyFile(ctx, relative)
		return nil
	}
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	var info unix.Stat_t
	if err := unix.Fstat(fd, &info); err != nil {
		return err
	}
	kind := info.Mode & unix.S_IFMT
	if kind != unix.S_IFREG && kind != unix.S_IFDIR {
		return os.ErrPermission
	}
	input, err := os.Open(fmt.Sprintf("/proc/self/fd/%d", fd))
	if err != nil {
		return err
	}
	defer input.Close()
	if kind == unix.S_IFDIR {
		return copyTree(ctx, input, destination, relative)
	}
	reportCopy(ctx, func(task *copyTask) { task.FileTotal = info.Size })
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, copyReader{ctx: ctx, file: input})
	if copyErr == nil {
		copyErr = output.Chmod(fs.FileMode(info.Mode & 0777))
	}
	if err := errors.Join(copyErr, output.Close()); err != nil {
		return err
	}
	finishCopyFile(ctx, relative)
	return nil
}

func finishCopyFile(ctx context.Context, name string) {
	reportCopy(ctx, func(task *copyTask) {
		task.Completed++
		if len(task.Files) < 100 {
			task.Files = append(task.Files, name)
		}
	})
}

func editDirectory(v volume, relative, oldName, name string) error {
	dir, err := openVolume(v, relative, true)
	if err != nil {
		return err
	}
	defer dir.Close()
	fd := int(dir.Fd())
	if oldName == "" {
		return unix.Mkdirat(fd, name, 0777)
	}
	if _, err := entryInfo(dir, oldName); err != nil {
		return err
	}
	return unix.Renameat2(fd, oldName, fd, name, unix.RENAME_NOREPLACE)
}

type copyReader struct {
	ctx  context.Context
	file *os.File
}

func (reader copyReader) Read(buffer []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := reader.file.Read(buffer)
	reportCopy(reader.ctx, func(task *copyTask) {
		task.Bytes += int64(n)
		task.FileBytes += int64(n)
	})
	return n, err
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
