# mac-web-os 部署到 Debian

正式版是一个 Linux 可执行文件，内含 Web 页面和 Go API。安装目录为系统盘的 `/opt/mac-web-os`。安装版使用 HTTP 端口 `9999`，供局域网和 VPN 内的设备访问。构建机需要项目的 Node.js/npm 和 Go 1.25+。运行机需要 Linux 5.8+。

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

- 启动和刷新只读取 `/sys` 和 `/proc/self/mountinfo`，获取设备及挂载信息。
- 每个物理盘显示一个入口。多个已挂载分区分别列出。未挂载的盘会显示在列表里，挂载由 Debian 管理。
- 系统盘、机械盘和类型不明的盘需要确认后才能读取。读取可能唤醒正在休眠的盘。
- 浏览和预览以只读方式访问对应挂载分区。复制粘贴仅能向已挂载的非系统盘写入单个普通文件，同名文件会保留。
- 概览的分区外空间根据内核分区范围估算。没有已识别的分区时不推断整盘未分配。文件系统空闲量包含系统保留块，只统计可安全归属的已挂载文件系统。
- 固态盘的 SMART 依赖服务可执行的 `smartctl`（来自 `smartmontools`）。概览不会启动 `smartd`，也不会访问机械盘的 SMART、温度或文件系统用量。部署额外监控服务时需分别核对其磁盘探测配置。
