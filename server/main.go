package main

import (
	"encoding/json"
	"errors"
	"flag"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"path"
	"runtime"
	"strings"
	"time"
)

type inventory func() ([]*disk, error)

var contentTypes = map[string]string{
	".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
	".log": "text/plain; charset=utf-8", ".conf": "text/plain; charset=utf-8", ".ini": "text/plain; charset=utf-8",
	".json": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8",
	".yaml": "text/plain; charset=utf-8", ".yml": "text/plain; charset=utf-8",
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
	".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp", ".svg": "image/svg+xml",
	".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
	".ogv": "video/ogg",
}

type entry struct {
	Name     string    `json:"name"`
	Kind     string    `json:"kind"`
	Bytes    int64     `json:"bytes"`
	Modified time.Time `json:"modified"`
}

func fileKind(name string) string {
	typ := contentTypes[strings.ToLower(path.Ext(name))]
	if prefix, _, ok := strings.Cut(typ, "/"); ok {
		return prefix
	}
	return "file"
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func fail(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}

func api(scan inventory) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/disks", func(w http.ResponseWriter, r *http.Request) {
		disks, err := scan()
		if err != nil {
			fail(w, 503, err.Error())
			return
		}
		jsonResponse(w, 200, disks)
	})
	mux.HandleFunc("GET /api/disks/{disk}/{operation}", func(w http.ResponseWriter, r *http.Request) {
		action := r.PathValue("operation")
		if action != "entries" && action != "file" {
			fail(w, 404, "未知操作。")
			return
		}
		query := r.URL.Query()
		relative := query.Get("path")
		if relative == "" {
			relative = "."
		}
		if !fs.ValidPath(relative) || (relative == "." && action == "file") {
			fail(w, 400, "文件路径无效。")
			return
		}
		disks, err := scan()
		if err != nil {
			fail(w, 503, err.Error())
			return
		}
		var selected *disk
		for _, candidate := range disks {
			if candidate.ID == r.PathValue("disk") {
				selected = candidate
				break
			}
		}
		if selected == nil {
			fail(w, 404, "硬盘已断开或不存在。请刷新硬盘。")
			return
		}
		if (selected.System || selected.MayWake) && query.Get("confirmed") != "1" {
			fail(w, 409, "请先确认硬盘提示。")
			return
		}
		var selectedVolume *volume
		for _, candidate := range selected.Volumes {
			if candidate.ID == query.Get("volume") {
				selectedVolume = &candidate
				break
			}
		}
		if selectedVolume == nil {
			fail(w, 404, "分区未挂载或已变化。请刷新硬盘。")
			return
		}
		file, err := openVolume(*selectedVolume, relative, action == "entries")
		if err != nil {
			fail(w, 403, "无法读取此路径。请检查访问权限或从对应的硬盘入口打开。")
			return
		}
		defer file.Close()

		if action == "entries" {
			items, err := file.ReadDir(-1)
			if err != nil {
				fail(w, 403, "无法读取目录。")
				return
			}
			result := make([]entry, 0, len(items))
			for _, item := range items {
				if item.Type()&(fs.ModeSymlink|fs.ModeDevice|fs.ModeNamedPipe|fs.ModeSocket|fs.ModeCharDevice) != 0 {
					continue
				}
				info, err := entryInfo(file, item.Name())
				if err != nil {
					continue
				}
				kind := fileKind(item.Name())
				if info.IsDir() {
					kind = "directory"
				} else if !info.Mode().IsRegular() {
					continue
				}
				result = append(result, entry{item.Name(), kind, info.Size(), info.ModTime()})
			}
			jsonResponse(w, 200, result)
			return
		}

		info, err := file.Stat()
		if err != nil {
			fail(w, 403, "无法读取文件。")
			return
		}
		typ := contentTypes[strings.ToLower(path.Ext(relative))]
		name := path.Base(relative)
		if query.Get("preview") == "1" && (!strings.HasPrefix(typ, "text/plain") || info.Size() > 1024*1024) {
			fail(w, 413, "此文件无法预览或超过 1 MB。你可以下载后打开。")
			return
		}
		if typ == "" || query.Get("download") == "1" {
			w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
		}
		if typ == "" {
			typ = "application/octet-stream"
		}
		w.Header().Set("Content-Type", typ)
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
		http.ServeContent(w, r, name, info.ModTime(), file)
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			fail(w, 403, "禁止跨站访问。")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func systemDisks() ([]*disk, error) {
	if runtime.GOOS != "linux" {
		return nil, errors.New("请在 Debian 或其他 Linux 主机上运行 Go 后端。")
	}
	disks, err := discover("/sys", "/proc/self/mountinfo")
	if err != nil {
		log.Print(err)
		return nil, errors.New("无法读取 Linux 的硬盘或挂载信息。")
	}
	return disks, nil
}

func main() {
	listen := flag.String("listen", "127.0.0.1:9999", "HTTP listen address")
	web := flag.String("web", "", "override frontend directory")
	flag.Parse()
	listenHost, _, err := net.SplitHostPort(*listen)
	if err != nil {
		log.Fatal(err)
	}
	loopback := listenHost == "localhost" || net.ParseIP(listenHost).IsLoopback()
	mux := http.NewServeMux()
	mux.Handle("/api/", api(systemDisks))
	mux.Handle("/", http.FileServer(webFiles(*web)))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if value, _, err := net.SplitHostPort(host); err == nil {
			host = value
		}
		if loopback && host != "localhost" && !net.ParseIP(host).IsLoopback() {
			http.Error(w, "Invalid Host", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
	if disks, err := systemDisks(); err != nil {
		log.Print(err)
	} else {
		log.Printf("Discovered %d disks from Linux metadata", len(disks))
	}
	server := &http.Server{Addr: *listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("mac-web-os on http://%s", *listen)
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
