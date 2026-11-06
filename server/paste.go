package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
)

type fileLocation struct {
	Disk      string `json:"disk"`
	Volume    string `json:"volume"`
	Path      string `json:"path"`
	Confirmed bool   `json:"confirmed"`
}

func pasteHandler(scan inventory) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/json" {
			fail(w, http.StatusUnsupportedMediaType, "请求格式无效。")
			return
		}
		var request struct {
			Source fileLocation `json:"source"`
			Target fileLocation `json:"target"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&request); err != nil {
			fail(w, 400, "复制请求无效。")
			return
		}
		if request.Target.Path == "" {
			request.Target.Path = "."
		}
		if !fs.ValidPath(request.Source.Path) || request.Source.Path == "." || !fs.ValidPath(request.Target.Path) {
			fail(w, 400, "文件路径无效。")
			return
		}
		disks, err := scan()
		if err != nil {
			fail(w, 503, err.Error())
			return
		}
		resolve := func(location fileLocation, writing bool) *volume {
			for _, disk := range disks {
				if disk.ID != location.Disk {
					continue
				}
				if writing && disk.System {
					fail(w, 403, "系统盘为只读，无法粘贴。")
					return nil
				}
				if (disk.System || disk.MayWake) && !location.Confirmed {
					fail(w, 409, "请先确认硬盘提示。")
					return nil
				}
				for _, mounted := range disk.Volumes {
					if mounted.ID == location.Volume {
						return &mounted
					}
				}
				break
			}
			fail(w, 404, "硬盘或分区已变化，请刷新后重试。")
			return nil
		}
		source := resolve(request.Source, false)
		if source == nil {
			return
		}
		target := resolve(request.Target, true)
		if target == nil {
			return
		}
		err = copyFile(r.Context(), *source, request.Source.Path, *target, request.Target.Path)
		switch {
		case errors.Is(err, os.ErrExist):
			fail(w, 409, "目标位置已有同名文件。")
		case err != nil:
			fail(w, 403, "复制失败。请检查文件、目标位置和可用空间。")
		default:
			jsonResponse(w, 201, map[string]string{"name": path.Base(request.Source.Path)})
		}
	}
}
