# mac-web-os 部署到 Debian

正式版是一个 Linux 可执行文件，内含 Web 页面和 Go API。安装目录为系统盘的 `/opt/mac-web-os`。安装版使用 HTTP 端口 `9999`，供局域网和 VPN 内的设备访问。构建机需要项目的 Node.js/npm 和 Go 1.25+。运行机需要 Linux 5.8+。

项目已于 2026-11-07 确定统一采用飞牛风格的桌面与窗口设计，完整规范见 [统一设计规范与项目交接](../DESIGN.md)。文件管理、系统概览、任务管理器、阅读窗口、菜单、设置和程序坞均使用共用桌面与窗口样式；此前以原生 macOS Finder 为首要视觉目标的约定已被替代。界面风格调整不改变本文件中的部署、API 数据来源和硬盘保护约定。

## 打包

在 Debian 运行 `dpkg --print-architecture` 确认架构。在有源码的构建机上，从项目根目录执行。这里以 `amd64` 为例，ARM 机器使用 `arm64`。

```sh
npm ci
npm run package -- amd64
```

## 安装和更新

把对应的 `release/mac-web-os-linux-amd64.sh` 或 `release/mac-web-os-linux-arm64.sh` 复制到 Debian 的 `/tmp`。安装脚本已包含程序和网页。安装需要 root 权限，服务默认也以 root 运行。

```sh
sudo sh /tmp/mac-web-os-linux-amd64.sh
```

已登录 root 时，直接执行。

```sh
sh /tmp/mac-web-os-linux-amd64.sh
```

ARM 机器使用 `/tmp/mac-web-os-linux-arm64.sh`。脚本会校验安装包，把程序、服务文件和卸载脚本放在 `/opt/mac-web-os`，并启动服务、设置开机自启。执行同一命令升级时，旧安装的服务也会切换到 root。

从局域网或 VPN 内的电脑、手机打开安装脚本打印的 `http://<Debian IP>:9999` 即可。用新版脚本升级后，旧版生成的登录和证书配置会被清理。

日志可用 `sudo journalctl -u mac-web-os.service -n 30` 查看。

## 卸载

```sh
sudo sh /opt/mac-web-os/uninstall.sh
```

脚本会停止服务、取消开机自启并删除应用文件。硬盘数据和安装目录中的其他文件会保留。卸载脚本在安装目录里，安装后可以清理 `/tmp` 中的安装包。

## 开发

在 `server` 目录运行 `go run .`。在另一个终端从项目根目录运行 `npm run dev`，Vite 会将 `/api` 转发到本机 9999。

正式桌面在 `/`，文件管理、系统概览和任务管理器的初始地址分别为 `/#/files`、`/#/overview` 和 `/#/tasks`。桌面与程序坞可以同时打开多个应用窗口。界面使用真实 API；此前的独立模拟文件预览已经移除，旧 `/#/preview/files` 地址只重定向到正式文件管理。桌面、主题和图标拖拽在 [desktop.tsx](../src/desktop.tsx)，共用窗口在 [app-window.tsx](../src/app-window.tsx)，文件业务在 [finder.tsx](../src/finder.tsx)。

正式部署需要重新执行 `npm run package -- amd64` 或对应架构的打包命令，再使用生成的安装包升级。前端被嵌入 Linux 可执行文件，修改源码或只运行本地 Vite 不会更新 Debian 上已安装的页面。

- 启动和刷新只读取 `/sys` 和 `/proc/self/mountinfo`，获取设备及挂载信息。
- 程序坞的「任务管理器」通过 `/api/system/processes` 读取 `/proc` 的进程和系统资源计数，每两秒刷新，支持 CPU、内存等列排序及搜索。单核 CPU 满载为 100%，多线程进程可超过 100%；内存使用 RSS，包含共享页。权限限制下只显示可读取的进程，无法读取或已退出的进程会跳过；不支持结束进程。
- 每个物理盘显示一个入口。多个已挂载分区分别列出。未挂载的盘会显示在列表里，挂载由 Debian 管理。
- 系统盘、机械盘和类型不明的盘需要确认后才能读取。读取可能唤醒正在休眠的盘。
- 浏览和预览以只读方式访问对应挂载分区。非系统盘可以通过 `POST /api/file-edit` 新建文件夹、重命名和永久删除项目；删除要求 `action: "delete"` 与 `confirmDelete: true`，系统盘禁止修改，休眠盘必须先确认。递归删除不跟随符号链接或跨挂载点，不处理复制中的保留临时目录；无回收站，界面明确确认不可恢复，失败会刷新目录并报告可能的部分删除。
- 复制粘贴每次向已挂载的非系统盘写入一个普通文件或文件夹，同名项目会保留。文件夹逐文件复制，内部符号链接保留为链接。复制任务在服务进程内排队，进度和记录在程序坞的“日志”中查看。
- 概览的分区外空间根据内核分区范围估算。没有已识别的分区时不推断整盘未分配。文件系统空闲量包含系统保留块，只统计可安全归属的已挂载文件系统。
- 固态盘的 SMART 依赖服务可执行的 `smartctl`（来自 `smartmontools`）。概览不会启动 `smartd`，也不会访问机械盘的 SMART、温度或文件系统用量。部署额外监控服务时需分别核对其磁盘探测配置。

### 操作日志与新增桌面入口

- `GET /api/logs` 返回 `started`、`limit` 和 `items`。每项含操作时间、结束时间（若已结束）、操作类型、来源、目标、状态和错误；复制附带进度快照。日志记录实际调用文件操作后的结果；权限、确认、路径校验仍在操作前执行。
- 历史仅存于当前 Go 服务内存，保留最近 1000 条已结束操作和全部进行中复制，重启清空。不会为日志额外访问休眠盘，也不创建日志文件。复制快照最多每 200ms 更新，状态变更立即更新。
- `/api/copy-tasks` 继续供文件管理检测复制完成，清除其已结束记录不会影响日志。日志地址为 `/#/logs`，旧 `/#/copies` 自动跳转。
- `/#/downloads` 是纯前端下载 Demo，无下载 API、协议实现或文件写入；`/#/settings` 为系统设置，现有外观、程序坞与图标排列集中在这里。
- 窗口缩放和网格逻辑用 `node scripts/window-geometry.test.mjs` 验证。后端执行 `go test ./...`；Linux 文件操作和日志集成测试需在 Linux 执行，Windows 只能交叉编译检查。
- 用户明确要求打包时再运行 `npm run package` 或手动触发 GitHub Actions 安装包流程；推送代码不会自动打包。日常验证用 `npm run build`。本轮未生成安装包。
