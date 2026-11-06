package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

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
