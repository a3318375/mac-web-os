package main

import (
	"fmt"
	"os"

	"golang.org/x/sys/unix"
)

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
