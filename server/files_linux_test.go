package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestCopyFileKeepsExistingFilesAndCleansUpOnCancel(t *testing.T) {
	root := t.TempDir()
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, root, 0, unix.STATX_MNT_ID, &stat); err != nil {
		t.Fatal(err)
	}
	v := volume{ID: fmt.Sprint(stat.Mnt_id), Mount: root}
	for _, directory := range []string{"target", "cancelled"} {
		if err := os.Mkdir(filepath.Join(root, directory), 0700); err != nil {
			t.Fatal(err)
		}
	}
	source := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(source, []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(context.Background(), v, "hello.txt", v, "target"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(context.Background(), v, "hello.txt", v, "target"); !errors.Is(err, os.ErrExist) {
		t.Fatalf("expected existing file error, got %v", err)
	}
	got, err := os.ReadFile(filepath.Join(root, "target", "hello.txt"))
	if err != nil || string(got) != "hello" {
		t.Fatalf("copied file: %q, %v", got, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := copyFile(ctx, v, "hello.txt", v, "cancelled"); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(root, "cancelled"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("cancelled copy left files: %v, %v", entries, err)
	}
}

func TestCopyDirectory(t *testing.T) {
	root := t.TempDir()
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, root, 0, unix.STATX_MNT_ID, &stat); err != nil {
		t.Fatal(err)
	}
	v := volume{ID: fmt.Sprint(stat.Mnt_id), Mount: root}
	for _, dir := range []string{"source/child/empty", "target"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "source/child/file"), []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(context.Background(), v, "source", v, "source/child"); !errors.Is(err, errCopyIntoSource) {
		t.Fatalf("copy into child: %v", err)
	}
	if err := copyFile(context.Background(), v, "source", v, "target"); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(filepath.Join(root, "target/source/child/file")); err != nil || string(got) != "data" {
		t.Fatalf("nested file: %q, %v", got, err)
	}
	if _, err := os.ReadDir(filepath.Join(root, "target/source/child/empty")); err != nil {
		t.Fatal(err)
	}
	if err := copyFile(context.Background(), v, "source", v, "target"); !errors.Is(err, os.ErrExist) {
		t.Fatalf("copy over existing directory: %v", err)
	}
}

func TestOpenVolumeRejectsLinksAndSpecialFiles(t *testing.T) {
	root := t.TempDir()
	var info unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, root, 0, unix.STATX_MNT_ID, &info); err != nil {
		t.Fatal(err)
	}
	v := volume{ID: fmt.Sprint(info.Mnt_id), Mount: root}
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/etc/passwd", filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(filepath.Join(root, "pipe"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"link", "pipe", "../outside"} {
		if f, err := openVolume(v, name, false); err == nil {
			f.Close()
			t.Fatalf("opened blocked path %q", name)
		}
	}
	f, err := openVolume(v, "hello.txt", false)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := io.ReadAll(f)
	if err != nil || string(got) != "hello" {
		t.Fatalf("%q: %v", got, err)
	}
	dir, err := openVolume(v, ".", true)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	if _, err := entryInfo(dir, "hello.txt"); err != nil {
		t.Fatal(err)
	}
	v.ID = "0"
	if f, err := openVolume(v, "hello.txt", false); err == nil {
		f.Close()
		t.Fatal("accepted a mismatched mount ID")
	}
}
