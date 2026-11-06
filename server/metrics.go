package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type cpuCounters struct {
	Busy    uint64 `json:"busy"`
	Idle    uint64 `json:"idle"`
	Logical int    `json:"logical"`
}

type memoryCounters struct {
	Total     uint64 `json:"total"`
	Available uint64 `json:"available"`
}

type networkCounters struct {
	Name string `json:"name"`
	Rx   uint64 `json:"rx"`
	Tx   uint64 `json:"tx"`
}

type metricsSnapshot struct {
	At      int64             `json:"at"`
	CPU     cpuCounters       `json:"cpu"`
	Memory  memoryCounters    `json:"memory"`
	Network []networkCounters `json:"network"`
}

func readMetrics(proc string) (metricsSnapshot, error) {
	sample := metricsSnapshot{Network: []networkCounters{}}
	// Keep live sampling on procfs. Storage inventory is handled separately.
	stat, err := os.ReadFile(filepath.Join(proc, "stat"))
	if err != nil {
		return sample, err
	}
	summary, rest, _ := strings.Cut(string(stat), "\n")
	fields := strings.Fields(summary)
	if len(fields) < 9 || fields[0] != "cpu" {
		return sample, errors.New("invalid /proc/stat CPU counters")
	}
	// guest and guest_nice are already included in user and nice.
	for i, field := range fields[1:9] {
		ticks, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return sample, err
		}
		if i == 3 || i == 4 {
			sample.CPU.Idle += ticks
		} else {
			sample.CPU.Busy += ticks
		}
	}
	for line := range strings.SplitSeq(rest, "\n") {
		if !strings.HasPrefix(line, "cpu") {
			break
		}
		sample.CPU.Logical++
	}

	meminfo, err := os.ReadFile(filepath.Join(proc, "meminfo"))
	if err != nil {
		return sample, err
	}
	memory := map[string]uint64{}
	for line := range strings.SplitSeq(string(meminfo), "\n") {
		key, value, _ := strings.Cut(line, ":")
		if key != "MemTotal" && key != "MemAvailable" {
			continue
		}
		fields := strings.Fields(value)
		if len(fields) != 2 || fields[1] != "kB" {
			return sample, errors.New("invalid /proc/meminfo memory counters")
		}
		kb, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			return sample, err
		}
		memory[key] = kb * 1024
	}
	available, ok := memory["MemAvailable"]
	if total := memory["MemTotal"]; ok && total > 0 && available <= total {
		sample.Memory = memoryCounters{Total: total, Available: available}
	} else {
		return sample, errors.New("missing or invalid Linux memory totals")
	}

	netdev, err := os.ReadFile(filepath.Join(proc, "net", "dev"))
	if err != nil {
		return sample, err
	}
	for line := range strings.SplitSeq(string(netdev), "\n") {
		separator := strings.LastIndexByte(line, ':')
		if separator < 0 {
			continue
		}
		name := strings.TrimSpace(line[:separator])
		if name == "lo" {
			continue
		}
		fields := strings.Fields(line[separator+1:])
		if len(fields) < 16 {
			return sample, errors.New("invalid /proc/net/dev interface counters")
		}
		rx, rxErr := strconv.ParseUint(fields[0], 10, 64)
		tx, txErr := strconv.ParseUint(fields[8], 10, 64)
		if err := errors.Join(rxErr, txErr); err != nil {
			return sample, err
		}
		sample.Network = append(sample.Network, networkCounters{Name: name, Rx: rx, Tx: tx})
	}
	sample.At = time.Now().UnixMilli()
	return sample, nil
}

func systemMetrics(w http.ResponseWriter, _ *http.Request) {
	if runtime.GOOS != "linux" {
		fail(w, http.StatusServiceUnavailable, "系统监控需要 Linux 后端。")
		return
	}
	sample, err := readMetrics("/proc")
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "暂时无法读取 Linux 系统指标。")
		return
	}
	jsonResponse(w, http.StatusOK, sample)
}
