package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestDeleteHandlerProtectsRealFiles(t *testing.T) {
	root := t.TempDir()
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, root, 0, unix.STATX_MNT_ID, &stat); err != nil {
		t.Fatal(err)
	}
	v := volume{ID: fmt.Sprint(stat.Mnt_id), Mount: root}
	file := filepath.Join(root, "keep.txt")
	if err := os.WriteFile(file, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, device := range []*disk{{ID: "disk", System: true, Volumes: []volume{v}}, {ID: "disk", MayWake: true, Volumes: []volume{v}}} {
		handler := editHandler(func() ([]*disk, error) { return []*disk{device}, nil }, nil)
		body, _ := json.Marshal(map[string]any{"action": "delete", "confirmDelete": true, "name": "keep.txt", "directory": fileLocation{Disk: "disk", Volume: v.ID, Path: ".", Confirmed: device.System}})
		request := httptest.NewRequest("POST", "/api/file-edit", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler(response, request)
		if response.Code != 403 {
			t.Fatalf("protection failed: %d %s", response.Code, response.Body)
		}
		if data, err := os.ReadFile(file); err != nil || string(data) != "keep" {
			t.Fatalf("protected file changed: %q, %v", data, err)
		}
	}
}

func TestFileEditsProduceAccurateLogs(t *testing.T) {
	root := t.TempDir()
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, root, 0, unix.STATX_MNT_ID, &stat); err != nil {
		t.Fatal(err)
	}
	v := volume{ID: fmt.Sprint(stat.Mnt_id), Mount: root}
	logs := newOperationLogs()
	handler := editHandler(func() ([]*disk, error) { return []*disk{{ID: "disk", Volumes: []volume{v}}}, nil }, logs)
	for _, operation := range []struct {
		name, old, action, expected string
		status                      int
	}{
		{"folder", "", "", "create", 200},
		{"folder", "", "", "create", 409},
		{"renamed", "folder", "", "rename", 200},
		{"renamed", "", "delete", "delete", 200},
	} {
		body, _ := json.Marshal(map[string]any{"directory": fileLocation{Disk: "disk", Volume: v.ID, Path: "."}, "name": operation.name, "oldName": operation.old, "action": operation.action, "confirmDelete": true})
		r := httptest.NewRequest("POST", "/api/file-edit", bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler(w, r)
		if w.Code != operation.status {
			t.Fatalf("%s: %d %s", operation.expected, w.Code, w.Body)
		}
		item := logs.items[0]
		if item.Action != operation.expected || item.FinishedAt == nil || item.FinishedAt.Before(item.At) {
			t.Fatalf("invalid record: %+v", item)
		}
		if operation.status != 200 && (item.State != "failed" || item.Error == "") {
			t.Fatal("failure logged as success")
		}
		if operation.status == 200 && item.State != "done" {
			t.Fatal("success logged as failure")
		}
		if operation.action == "delete" && (item.Source != filepath.Join(root, operation.name) || item.Target != "") {
			t.Fatal("invalid deletion path")
		}
		if operation.old != "" && (item.Source != filepath.Join(root, operation.old) || item.Target != filepath.Join(root, operation.name)) {
			t.Fatal("invalid rename paths")
		}
	}
}

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

func TestDeleteEntryStaysInsideVolume(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, root, 0, unix.STATX_MNT_ID, &stat); err != nil {
		t.Fatal(err)
	}
	v := volume{ID: fmt.Sprint(stat.Mnt_id), Mount: root}
	if err := os.MkdirAll(filepath.Join(root, "tree", "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{filepath.Join(root, "tree", "nested", "file"), filepath.Join(outside, "keep")} {
		if err := os.WriteFile(file, []byte("keep"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(outside, filepath.Join(root, "tree", "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "outside")); err != nil {
		t.Fatal(err)
	}
	if err := deleteDirectoryEntry(context.Background(), v, ".", "outside"); err == nil {
		t.Fatal("accepted a top-level symlink")
	}
	if err := deleteDirectoryEntry(context.Background(), v, ".", ".."); err == nil {
		t.Fatal("accepted traversal")
	}
	wrong := v
	wrong.ID = "0"
	if err := deleteDirectoryEntry(context.Background(), wrong, ".", "tree"); err == nil {
		t.Fatal("accepted mismatched mount")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := deleteDirectoryEntry(ctx, v, ".", "tree"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "tree", "nested", "file")); err != nil {
		t.Fatal("cancel removed a file")
	}
	if err := deleteDirectoryEntry(context.Background(), v, ".", "tree"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "tree")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("tree still exists: %v", err)
	}
	if got, err := os.ReadFile(filepath.Join(outside, "keep")); err != nil || string(got) != "keep" {
		t.Fatalf("outside file changed: %q, %v", got, err)
	}
	if err := os.Mkdir(filepath.Join(root, ".mac-web-os-copy-running"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := deleteDirectoryEntry(context.Background(), v, ".", ".mac-web-os-copy-running"); err == nil {
		t.Fatal("deleted active staging")
	}
}
