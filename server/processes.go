package main

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type processReading struct {
	PID     int    `json:"pid"`
	Name    string `json:"name"`
	State   string `json:"state"`
	UID     string `json:"uid"`
	Threads uint64 `json:"threads"`
	Memory  uint64 `json:"memory"`
	Ticks   uint64 `json:"ticks"`
	Started uint64 `json:"started"`
}

type processesSnapshot struct {
	At        int64            `json:"at"`
	CPU       cpuCounters      `json:"cpu"`
	Memory    memoryCounters   `json:"memory"`
	Processes []processReading `json:"processes"`
	Skipped   int              `json:"skipped"`
}

func parseProcessStat(stat string) (processReading, error) {
	var p processReading
	open, close := strings.IndexByte(stat, '('), strings.LastIndexByte(stat, ')')
	if open < 1 || close <= open {
		return p, errors.New("invalid process name")
	}
	pid, err := strconv.Atoi(strings.TrimSpace(stat[:open]))
	if err != nil || pid <= 0 {
		return p, errors.New("invalid process PID")
	}
	// comm can contain spaces and parentheses; fields start after the last ')'.
	fields := strings.Fields(stat[close+1:])
	if len(fields) < 22 {
		return p, errors.New("incomplete process stat")
	}
	values := make([]uint64, 5)
	for i, index := range []int{11, 12, 17, 19, 21} {
		values[i], err = strconv.ParseUint(fields[index], 10, 64)
		if err != nil {
			return p, err
		}
	}
	p = processReading{PID: pid, Name: stat[open+1 : close], State: fields[0], UID: "—",
		Ticks: values[0] + values[1], Threads: values[2], Started: values[3], Memory: values[4] * uint64(os.Getpagesize())}
	return p, nil
}

func readProcesses(proc string) (processesSnapshot, error) {
	metrics, err := readMetrics(proc)
	if err != nil {
		return processesSnapshot{}, err
	}
	sample := processesSnapshot{At: metrics.At, CPU: metrics.CPU, Memory: metrics.Memory, Processes: []processReading{}}
	entries, err := os.ReadDir(proc)
	if err != nil {
		return sample, err
	}
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid <= 0 || !entry.IsDir() {
			continue
		}
		stat, err := os.ReadFile(filepath.Join(proc, entry.Name(), "stat"))
		if err != nil {
			sample.Skipped++ // Processes may exit or be unreadable during a sample.
			continue
		}
		p, err := parseProcessStat(string(stat))
		if err != nil || p.PID != pid {
			sample.Skipped++
			continue
		}
		status, _ := os.ReadFile(filepath.Join(proc, entry.Name(), "status"))
		for line := range strings.SplitSeq(string(status), "\n") {
			if strings.HasPrefix(line, "Uid:") {
				if fields := strings.Fields(line); len(fields) >= 2 {
					p.UID = fields[1]
				}
				break
			}
		}
		sample.Processes = append(sample.Processes, p)
	}
	return sample, nil
}

func systemProcesses(w http.ResponseWriter, _ *http.Request) {
	if runtime.GOOS != "linux" {
		fail(w, http.StatusServiceUnavailable, "任务管理器需要 Linux 后端。")
		return
	}
	sample, err := readProcesses("/proc")
	if err != nil {
		fail(w, http.StatusServiceUnavailable, "暂时无法读取 Linux 进程信息。")
		return
	}
	jsonResponse(w, http.StatusOK, sample)
}
