# mac-web-os 项目交接

这是给后续会话用的需求和设计记录。项目是 Debian 上运行的 Web 文件管理器。优先把 Finder 做到尽可能接近原生 macOS，再复刻 Dock。Dashboard 可以独立设计。每次改完主动在浏览器验证。

## 设计参考

- 用户指定的首要参考是 macOS 27 UI Kit 的 Figma 节点 `207:14481`。文件里有多页，先自行搜索 Finder、Dock 和相关组件，定位到具体画面再对照。[指定的 Figma 节点](https://www.figma.com/design/BROGR0oCh5IqGBDOc9IhX9/macOS-27--Community-?node-id=207-14481&t=pWh8asvKGsMPDRCn-1)
- 官方资源的 macOS 27 区域提供 Figma 和 Sketch 版本。[Apple Design Resources](https://developer.apple.com/design/resources/#macos) · [Figma Community](https://www.figma.com/community/file/1651309434229735362/macos-27) · [Sketch](https://sketch.com/s/57153a31-3379-4737-8ac6-dbfd6525f052)
- 复制和粘贴交互参考原生 Finder 的右键菜单和快捷键。[Apple 支持](https://support.apple.com/en-us/102553)
- 「1:1」是视觉目标。调整界面时，拿同尺寸参考帧与浏览器截图对照，检查字体、图标、行高、侧栏、工具栏、选中态、右键菜单和 Dock。此文档更新时未能通过网页工具打开指定的 Figma 节点，尚无该帧的像素级验收记录。

## 已确认的界面要求

### Finder

- 保留 macOS Finder 的布局和交互。用户看过实现后要求把列表模式的文字、图标，以及左侧栏的文字、图标一起放大。
- 左侧只保留「所有硬盘」和硬盘入口。移除「共享目录」「文档」「媒体」「备份」等预设入口。每个物理盘一个入口，有多个已挂载分区时可在盘内选择。
- 系统盘叫 `system`。其他盘用实际挂载路径的末段做显示名，例如 `/mnt/volume1` 显示为 `volume1`。侧栏和总览默认把 `system` 放第一，其他已挂载盘自然排序 `volume1、volume2、volume3、volume4…`，未挂载盘放最后并显示设备名。
- 打开 `system` 后直接列出根目录 `/` 的内容，像 `boot`、`etc`、`home`。不要在外面再套一层名为 `/` 的文件夹，也不要在根列表额外混入一个 `/boot/efi` 入口。
- 先实现基本右键操作。当前有「复制」和「粘贴项目」，可以到另一块已挂载的数据盘粘贴。右键目录空白处可粘贴到当前目录，右键子目录可粘贴到该目录。Mac 用 `⌘C / ⌘V`，Windows 用 `Ctrl+C / Ctrl+V`。

### Dock、阅读窗口和 Dashboard

- Dock 参考 macOS，位于底部中央，浮在所有页面和阅读窗口之上。移除曾经横贯页面底部的灰色条，别给 Dock 预留整条底栏。Finder 自己的路径和状态栏仍可独立显示。
- Dock 里有参考 macOS 的设置入口。现有设置包括图标大小、悬停放大、恢复默认。
- 文本、图片、视频用独立窗口打开，标题栏可拖拽。窗口使用 Windows 式的最小化、最大化／还原、关闭图标。最小化后从 Dock 恢复。视频由浏览器播放，格式兼容性取决于浏览器。
- 「系统概览」顶部并列显示资源和散热卡片，下方左侧是物理硬盘容量条与详情，右侧留白。CPU、内存和所选网卡每两秒从 `/proc` 采样，页面进入后台时暂停。固态盘的 SMART、可安全归属的挂载卷容量和主机传感器进页时读取一次。概览对机械盘和类型未知的盘只显示内核元数据，展开详情也不探测。

## 硬盘访问约定

- 用户的机器有五块物理盘，一块 Debian 系统盘、两块 SSD、两块 HDD。设备名和挂载位置从 Debian 读取，避免把设备名、盘数或 `volume1` 至 `volume4` 写死。
- 应用启动时自动刷新，Finder 工具栏也有手动「刷新硬盘」按钮。枚举只读取 `/sys` 和 `/proc/self/mountinfo` 的元数据。刷新不读取盘内目录，也不能为了判断状态去唤醒休眠盘。
- SSD 直接打开。系统盘先提示「系统盘，请谨慎修改」，当前文件管理实现以只读方式访问。机械盘和可能唤醒的盘先提示休眠风险，用户确认后才读取。跨盘复制如果要重新读取另一块机械盘，也先提示。
- 每次可复制一个普通文件或文件夹，文件夹包含子目录和空目录。同名项目提示冲突并保留目标，文件夹不能粘贴到自身或其子目录。

## 部署和发布约定

- 后端统一放在 `server/`，用 Go。发布版把前端嵌进一个 Linux 可执行文件。Debian 系统盘统一安装到 `/opt/mac-web-os`，systemd 服务名为 `mac-web-os.service`。
- Debian 是纯命令行服务器，正式服务监听 `:9999`。从另一台局域网或 VPN 设备访问 `http://<Debian IP>:9999`。此前用户给过的实机排查入口是 `http://192.168.5.3:9999/#/files/nvme2n1`。开发时 Vite 到 Go 的本机代理可继续使用 `127.0.0.1:9999`。
- 用户明确要求简单 HTTP，服务默认以 root 运行，不要求选择账号。登录、HTTPS 和证书管理不在项目范围内。重要的硬盘操作由界面提示确认。
- 用单个自包含 shell 安装包。复制到 Debian 的 `/tmp`，在 root 终端执行 `sh /tmp/mac-web-os-linux-amd64.sh`，ARM64 换对应文件名。用同一个脚本升级。卸载用 `sh /opt/mac-web-os/uninstall.sh`，停止服务、清理安装文件并保留硬盘数据。
- GitHub 仓库是 `a3318375/mac-web-os`。`main` 的安装包工作流会产出 amd64 和 arm64 两个脚本。本地 Windows 如遇 GitHub 网络问题，用户提供的 HTTP 和 HTTPS 代理地址都是 `http://127.0.0.1:7897`，按需用于当前进程。[构建工作流](https://github.com/a3318375/mac-web-os/actions/workflows/installers.yml)
- 本地构建、安装和卸载的完整命令见 [Debian 部署说明](server/README.md)。

## 接手时从这里查

| 内容 | 代码入口 |
| --- | --- |
| Finder 布局、视图、右键、快捷键 | [src/finder.tsx](src/finder.tsx) · [src/finder.css](src/finder.css) |
| 挂载名、排序、文件 API 客户端 | [src/disks.ts](src/disks.ts) |
| Dock、设置和 Dashboard | [src/main.tsx](src/main.tsx) · [src/style.css](src/style.css) |
| 文件阅读和拖动窗口 | [src/reader.tsx](src/reader.tsx) · [src/reader.css](src/reader.css) |
| 枚举和挂载识别 | [server/disks.go](server/disks.go) |
| 文件读取和粘贴 API、Linux 文件操作 | [server/main.go](server/main.go) · [server/paste.go](server/paste.go) · [server/files_linux.go](server/files_linux.go) |
| 安装、卸载和打包 | [scripts/](scripts/) · [GitHub Actions 定义](.github/workflows/installers.yml) |

### 最近一次验证

- 截至 2026-11-06 本次交接，挂载名、系统盘根目录直出、自然排序和右键复制粘贴都在本地工作区。接手先看 `git status` 和现有 diff，GitHub 上的版本可能较早。
- 本地浏览器用模拟盘验证了启动与刷新、系统盘和机械盘确认、根目录直出、跨盘粘贴后的目录刷新、快捷键和同名提示。前端构建通过，Windows 下可运行的 Go 测试通过，Linux 测试程序已交叉编译。
- 本地已生成 amd64 和 arm64 安装包并通过 `sh -n`。实机写入和休眠盘行为仍需在用户的 Debian 上验证。浏览器模拟数据无法验证真实硬盘是否唤醒。
