package main

import (
	"bufio"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

type volume struct {
	ID    string `json:"id"`
	Mount string `json:"mount"`
}
type disk struct {
	ID      string   `json:"id"`
	Model   string   `json:"model"`
	Kind    string   `json:"kind"`
	Bytes   uint64   `json:"bytes"`
	System  bool     `json:"system"`
	MayWake bool     `json:"mayWake"`
	Volumes []volume `json:"volumes"`
}

func readMetadata(path string) string {
	data, _ := os.ReadFile(path)
	return strings.TrimSpace(string(data))
}

var mountEscapes = strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)

func discover(sys, mountinfo string) ([]*disk, error) {
	block := filepath.Join(sys, "block")
	devices, err := os.ReadDir(block)
	if err != nil {
		return nil, err
	}
	disks := make([]*disk, 0)
	byDevice := make(map[string]*disk)
	byName := make(map[string]*disk)
	for _, device := range devices {
		name := device.Name()
		base := filepath.Join(block, name)
		link, _ := os.Readlink(base)
		if strings.Contains(filepath.ToSlash(link), "/virtual/") || strings.HasPrefix(name, "sr") {
			continue
		}
		if _, err := os.Lstat(filepath.Join(base, "device")); err != nil {
			continue
		}
		majorMinor := readMetadata(filepath.Join(base, "dev"))
		if majorMinor == "" {
			continue
		}
		sectors, _ := strconv.ParseUint(readMetadata(filepath.Join(base, "size")), 10, 64)
		d := &disk{ID: name, Model: readMetadata(filepath.Join(base, "device", "model")),
			Kind: "unknown", Bytes: sectors * 512, Volumes: []volume{}}
		switch readMetadata(filepath.Join(base, "queue", "rotational")) {
		case "0":
			d.Kind = "ssd"
		case "1":
			d.Kind = "hdd"
		}
		d.MayWake = d.Kind != "ssd"
		disks = append(disks, d)
		byDevice[majorMinor], byName[name] = d, d
		children, _ := os.ReadDir(base)
		for _, child := range children {
			part := filepath.Join(base, child.Name())
			if readMetadata(filepath.Join(part, "partition")) == "" {
				continue
			}
			if id := readMetadata(filepath.Join(part, "dev")); id != "" {
				byDevice[id], byName[child.Name()] = d, d
			}
		}
	}

	// Follow kernel-maintained device-mapper/RAID backing-device links.
	var owners func(string, map[string]bool) []*disk
	owners = func(id string, seen map[string]bool) []*disk {
		if seen[id] {
			return nil
		}
		seen[id] = true
		if d := byDevice[id]; d != nil {
			return []*disk{d}
		}
		base := filepath.Join(sys, "dev", "block", id)
		slaves, _ := os.ReadDir(filepath.Join(base, "slaves"))
		if len(slaves) == 0 && readMetadata(filepath.Join(base, "partition")) != "" {
			if target, err := filepath.EvalSymlinks(base); err == nil {
				return owners(readMetadata(filepath.Join(filepath.Dir(target), "dev")), seen)
			}
		}
		var result []*disk
		for _, slave := range slaves {
			result = append(result, owners(readMetadata(filepath.Join(base, "slaves", slave.Name(), "dev")), seen)...)
		}
		return result
	}

	file, err := os.Open(mountinfo)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	type mounted struct {
		volume
		backing []*disk
		risk    bool
	}
	mounts := map[string]mounted{}
	scan := bufio.NewScanner(file)
	scan.Buffer(make([]byte, 4096), 1024*1024)
	for scan.Scan() {
		left, right, ok := strings.Cut(scan.Text(), " - ")
		fields, fs := strings.Fields(left), strings.Fields(right)
		if !ok || len(fields) < 6 || len(fs) < 2 {
			continue
		}
		target := mountEscapes.Replace(fields[4])
		backing := owners(fields[2], map[string]bool{})
		// Btrfs reports an anonymous device number in mountinfo.
		if len(backing) == 0 && fs[0] == "btrfs" && strings.HasPrefix(fs[1], "/dev/") {
			if d := byName[filepath.Base(fs[1])]; d != nil {
				backing = []*disk{d}
			}
		}
		if len(backing) == 0 {
			continue
		}
		risk := fs[0] == "btrfs" // Btrfs may span devices beyond the mount source.
		for _, d := range backing {
			if target == "/" || target == "/boot" || target == "/boot/efi" {
				d.System = true
			}
			risk = risk || d.Kind != "ssd"
		}
		// Keep one mount per device and filesystem root, preferring its primary path.
		key := fields[2] + ":" + fields[3]
		if old, found := mounts[key]; !found || len(target) < len(old.Mount) {
			mounts[key] = mounted{volume{fields[0], target}, backing, risk}
		}
	}
	if err := scan.Err(); err != nil {
		return nil, err
	}
	for _, mount := range mounts {
		for _, d := range mount.backing {
			d.Volumes = append(d.Volumes, mount.volume)
			d.MayWake = d.MayWake || mount.risk
		}
	}
	for _, d := range disks {
		slices.SortFunc(d.Volumes, func(a, b volume) int { return strings.Compare(a.Mount, b.Mount) })
	}
	slices.SortStableFunc(disks, func(a, b *disk) int {
		if a.System == b.System {
			return 0
		}
		if a.System {
			return -1
		}
		return 1
	})
	return disks, nil
}
