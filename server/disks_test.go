package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDiscoveryAndProtectedDiskGate(t *testing.T) {
	root := t.TempDir()
	write := func(relative, content string) {
		t.Helper()
		path := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, spec := range []struct{ name, dev, rotating string }{
		{"sda", "8:0", "0"}, {"sdb", "8:16", "0"}, {"sdc", "8:32", "0"},
		{"sdd", "8:48", "1"}, {"sde", "8:64", "1"},
	} {
		base := "block/" + spec.name
		write(base+"/device/model", "Test disk")
		write(base+"/dev", spec.dev)
		write(base+"/queue/rotational", spec.rotating)
		write(base+"/size", "2000")
	}
	write("block/sda/sda1/partition", "1")
	write("block/sda/sda1/dev", "8:1")
	write("block/sda/sda1/start", "100")
	write("block/sda/sda1/size", "1800")
	write("dev/block/dm0/slaves/sda1/dev", "8:1")
	write("mountinfo", `31 1 dm0 / / rw - ext4 /dev/dm-0 rw
34 31 8:16 / /mnt/ssd rw - ext4 /dev/sdb rw
35 31 8:48 / /mnt/cold\040disk rw - ext4 /dev/sdd rw
39 35 8:32 / /mnt/cold\040disk/nested rw - ext4 /dev/sdc rw
36 31 8:48 / /mnt/longer-alias rw - ext4 /dev/sdd rw
37 31 0:7 / /proc rw - proc proc rw
`)
	scan := func() ([]*disk, error) { return discover(root, filepath.Join(root, "mountinfo")) }
	handler := api(scan)
	response := func(url string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
		return w
	}
	res := response("/api/disks")
	if res.Code != 200 {
		t.Fatal(res.Code, res.Body.String())
	}
	var disks []disk
	if err := json.Unmarshal(res.Body.Bytes(), &disks); err != nil {
		t.Fatal(err)
	}
	if len(disks) != 5 || !disks[0].System || disks[0].Volumes[0].Mount != "/" {
		t.Fatalf("%+v", disks)
	}
	if len(disks[3].Volumes) != 1 || disks[3].Volumes[0].Mount != "/mnt/cold disk" || !disks[3].MayWake {
		t.Fatalf("unexpected mechanical disk: %+v", disks[3])
	}
	if disks[1].MayWake || len(disks[4].Volumes) != 0 {
		t.Fatal("unexpected SSD or unmounted-disk state")
	}
	if disks[0].Unallocated != 200*512 || disks[4].Unallocated != 0 {
		t.Fatal("unexpected unpartitioned space")
	}
	internal, err := scan()
	if err != nil {
		t.Fatal(err)
	}
	if internal[0].Volumes[0].fsDevice == "" || internal[1].Volumes[0].fsDevice == "" || internal[2].Volumes[0].fsDevice != "" {
		t.Fatal("only SSD filesystems reachable without crossing a mechanical mount should be probed")
	}
	for url, want := range map[string]int{
		"/api/disks/sda/entries?volume=31":                          409,
		"/api/disks/sdd/file?volume=35&path=video.mp4":              409,
		"/api/system/disks/sdd/details?confirmed=1":                 409,
		"/api/system/disks/sde/details":                             409,
		"/api/disks/sdb/entries?volume=missing":                     404,
		"/api/disks/sdd/file?volume=35&confirmed=1&path=../private": 400,
	} {
		if got := response(url).Code; got != want {
			t.Errorf("%s: status %d; want %d", url, got, want)
		}
	}
}
