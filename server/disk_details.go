package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"time"
)

type filesystemSpace struct {
	Mount string `json:"mount"`
	Used  uint64 `json:"used"`
	Free  uint64 `json:"free"`
}

type smartReport struct {
	Passed      *bool   `json:"passed,omitempty"`
	Temperature *int    `json:"temperature,omitempty"`
	Cycles      *uint64 `json:"cycles,omitempty"`
	Hours       *uint64 `json:"hours,omitempty"`
	Wear        *uint64 `json:"wear,omitempty"`
}

func parseSMART(data []byte) (smartReport, error) {
	var raw struct {
		Cycles *uint64 `json:"power_cycle_count"`
		OnTime struct {
			Hours *uint64 `json:"hours"`
		} `json:"power_on_time"`
		Endurance struct {
			Used *uint64 `json:"current_percent"`
		} `json:"endurance_used"`
		Status struct {
			Passed *bool `json:"passed"`
		} `json:"smart_status"`
		Temperature struct {
			Current *int `json:"current"`
		} `json:"temperature"`
		NVMe struct {
			Temperature *int    `json:"temperature"`
			Cycles      *uint64 `json:"power_cycles"`
			Hours       *uint64 `json:"power_on_hours"`
			Wear        *uint64 `json:"percentage_used"`
		} `json:"nvme_smart_health_information_log"`
	}
	err := json.Unmarshal(data, &raw)
	report := smartReport{Passed: raw.Status.Passed, Temperature: raw.Temperature.Current, Cycles: raw.Cycles, Hours: raw.OnTime.Hours, Wear: raw.Endurance.Used}
	if report.Temperature == nil {
		report.Temperature = raw.NVMe.Temperature
	}
	if report.Cycles == nil {
		report.Cycles = raw.NVMe.Cycles
	}
	if report.Hours == nil {
		report.Hours = raw.NVMe.Hours
	}
	if report.Wear == nil {
		report.Wear = raw.NVMe.Wear
	}
	return report, err
}

func readSMART(ctx context.Context, id string) (*smartReport, string) {
	smartctl, err := exec.LookPath("smartctl")
	if err != nil {
		return nil, "服务器未找到 smartctl（smartmontools）。"
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	// smartctl may return a nonzero status to report a failing disk, with valid JSON.
	data, _ := exec.CommandContext(ctx, smartctl, "-j", "-H", "-A", filepath.Join("/dev", id)).Output()
	if ctx.Err() != nil {
		return nil, "SMART 读取超时或已取消。"
	}
	report, err := parseSMART(data)
	if err != nil || report == (smartReport{}) {
		return nil, "未读到 SMART 数据，请检查设备支持和服务权限。"
	}
	return &report, ""
}

func diskDetailsHandler(scan inventory) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		disks, err := scan()
		if err != nil {
			fail(w, 503, err.Error())
			return
		}
		for _, disk := range disks {
			if disk.ID != r.PathValue("disk") {
				continue
			}
			if disk.Kind != "ssd" {
				fail(w, 409, "休眠保护：系统概览不探测机械盘或类型未知的盘。")
				return
			}
			result := struct {
				At         int64             `json:"at"`
				Space      []filesystemSpace `json:"space"`
				Skipped    int               `json:"skipped"`
				SMART      *smartReport      `json:"smart,omitempty"`
				SMARTError string            `json:"smartError,omitempty"`
			}{Space: []filesystemSpace{}}
			seen := map[string]bool{}
			for _, v := range disk.Volumes {
				if r.Context().Err() != nil {
					return
				}
				if seen[v.fsDevice] {
					continue
				}
				if v.fsDevice != "" {
					if space, err := volumeSpace(v); err == nil {
						seen[v.fsDevice] = true
						result.Space = append(result.Space, space)
						continue
					}
				}
				result.Skipped++
			}
			result.SMART, result.SMARTError = readSMART(r.Context(), disk.ID)
			result.At = time.Now().UnixMilli()
			jsonResponse(w, 200, result)
			return
		}
		fail(w, 404, "硬盘已断开或不存在。请刷新硬盘。")
	}
}
