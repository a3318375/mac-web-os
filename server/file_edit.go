package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

func editHandler(scan inventory, history *operationLogs) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var edit struct {
			Directory     fileLocation
			Name          string
			OldName       string
			Action        string
			ConfirmDelete bool
		}
		if r.Header.Get("Content-Type") != "application/json" ||
			json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&edit) != nil ||
			(edit.Directory.Path != "" && !fs.ValidPath(edit.Directory.Path)) || !visiblePath(edit.Directory.Path) || !validName(edit.Name) ||
			(edit.OldName != "" && !validName(edit.OldName)) {
			fail(w, 400, "文件名或目录无效。")
			return
		}
		if edit.Action != "" && edit.Action != "delete" || edit.Action == "delete" && (!edit.ConfirmDelete || edit.OldName != "") {
			fail(w, 400, "请确认删除操作。")
			return
		}
		if edit.Directory.Path == "" {
			edit.Directory.Path = "."
		}
		disks, err := scan()
		if err != nil {
			fail(w, 503, "无法读取硬盘。")
			return
		}
		for _, disk := range disks {
			if disk.ID != edit.Directory.Disk {
				continue
			}
			if disk.System || (disk.MayWake && !edit.Directory.Confirmed) {
				fail(w, 403, "当前硬盘不可修改或尚未确认。")
				return
			}
			for _, v := range disk.Volumes {
				if v.ID != edit.Directory.Volume {
					continue
				}
				var err error
				started := time.Now()
				if edit.Action == "delete" {
					err = deleteDirectoryEntry(r.Context(), v, edit.Directory.Path, edit.Name)
				} else {
					err = editDirectory(v, edit.Directory.Path, edit.OldName, edit.Name)
				}
				if history != nil {
					now := time.Now()
					item := operationRecord{At: started, Action: "create", Target: path.Join(v.Mount, edit.Directory.Path, edit.Name), State: "done", FinishedAt: &now}
					if edit.Action == "delete" {
						item.Action, item.Source, item.Target = "delete", item.Target, ""
					}
					if edit.OldName != "" {
						item.Action, item.Source = "rename", path.Join(v.Mount, edit.Directory.Path, edit.OldName)
					}
					if err != nil {
						item.State, item.Error = "failed", "操作未完成，请刷新目录检查。"
						if errors.Is(err, os.ErrExist) {
							item.Error = "目标位置已有同名项目。"
						}
						if edit.Action == "delete" {
							item.Error = "删除未完成，部分内容可能已被删除，请刷新目录检查。"
						}
					}
					history.record(item)
				}
				switch {
				case errors.Is(err, os.ErrExist):
					fail(w, 409, "目标位置已有同名项目。")
				case err != nil:
					if edit.Action == "delete" {
						fail(w, 403, "删除未完成，请刷新目录检查。部分内容可能已被删除；挂载点、正在复制的临时目录和不可访问的项目不会被继续处理。")
					} else {
						fail(w, 403, "无法修改目录，请检查项目是否仍存在。")
					}
				default:
					jsonResponse(w, 200, struct{}{})
				}
				return
			}
		}
		fail(w, 404, "硬盘或分区已变化，请刷新后重试。")
	}
}

func validName(name string) bool {
	return fs.ValidPath(name) && name != "." && name != ".." &&
		strings.TrimSpace(name) != "" && !strings.ContainsAny(name, "/\\\x00") &&
		!strings.HasPrefix(name, ".mac-web-os-copy-")
}

func visiblePath(relative string) bool {
	for _, name := range strings.Split(relative, "/") {
		if strings.HasPrefix(name, ".mac-web-os-copy-") {
			return false
		}
	}
	return true
}
