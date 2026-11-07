package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"sync"
	"time"
)

type copyTask struct {
	ID        int      `json:"id"`
	Source    string   `json:"source"`
	Target    string   `json:"target"`
	State     string   `json:"state"`
	Bytes     int64    `json:"bytes"`
	Total     int64    `json:"total"`
	Current   string   `json:"current"`
	FileBytes int64    `json:"fileBytes"`
	FileTotal int64    `json:"fileTotal"`
	Completed int      `json:"completed"`
	Files     []string `json:"files"`
	Error     string   `json:"error"`
}

type copyTasks struct {
	mu    sync.Mutex
	next  int
	items []*copyTask
	queue chan func()
	logs  *operationLogs
}

func newCopyTasks() *copyTasks {
	tasks := &copyTasks{queue: make(chan func(), 16)}
	go func() {
		for run := range tasks.queue {
			run()
		}
	}()
	return tasks
}

func (tasks *copyTasks) list(w http.ResponseWriter, r *http.Request) {
	tasks.mu.Lock()
	if r.Method == http.MethodDelete {
		active := []*copyTask{}
		for _, item := range tasks.items {
			if item.State == "queued" || item.State == "running" {
				active = append(active, item)
			}
		}
		tasks.items = active
	}
	items := make([]copyTask, 0, len(tasks.items))
	for _, item := range tasks.items {
		snapshot := *item
		snapshot.Files = append([]string(nil), item.Files...)
		items = append(items, snapshot)
	}
	tasks.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	jsonResponse(w, http.StatusOK, items)
}

type copyProgressKey struct{}

func reportCopy(ctx context.Context, update func(*copyTask)) {
	if report, ok := ctx.Value(copyProgressKey{}).(func(func(*copyTask))); ok {
		report(update)
	}
}

func (tasks *copyTasks) submit(w http.ResponseWriter, source, target string, run func(context.Context) error) {
	tasks.mu.Lock()
	defer tasks.mu.Unlock()
	tasks.next++
	item := &copyTask{ID: tasks.next, Source: source, Target: target, State: "queued"}
	logID := 0
	lastLog := time.Time{}
	update := func(change func(*copyTask)) {
		tasks.mu.Lock()
		defer tasks.mu.Unlock()
		previous := item.State
		change(item)
		if tasks.logs != nil && (item.State != previous || time.Since(lastLog) >= 200*time.Millisecond) {
			tasks.logs.updateCopy(logID, *item)
			lastLog = time.Now()
		}
	}
	select {
	case tasks.queue <- func() {
		update(func(task *copyTask) { task.State = "running" })
		err := run(context.WithValue(context.Background(), copyProgressKey{}, update))
		update(func(task *copyTask) {
			task.State = "done"
			if err != nil {
				task.State = "failed"
				task.Error = copyError(err)
			}
		})
	}:
		if tasks.logs != nil {
			logID = tasks.logs.record(operationRecord{Action: "copy", Source: source, Target: target, State: "queued"})
			tasks.logs.updateCopy(logID, *item)
		}
		tasks.items = append([]*copyTask{item}, tasks.items...)
		if len(tasks.items) > 100 {
			tasks.items = tasks.items[:100]
		}
		jsonResponse(w, http.StatusAccepted, item)
	default:
		fail(w, http.StatusServiceUnavailable, "复制队列已满，请稍后重试。")
	}
}

func copyError(err error) string {
	switch {
	case errors.Is(err, errCopyIntoSource):
		return "不能把文件夹粘贴到自身或其子文件夹。"
	case errors.Is(err, os.ErrExist):
		return "目标位置已有同名文件或文件夹。"
	default:
		return "复制失败。请检查文件、目标位置和可用空间。"
	}
}
