# mac-web-os

在 Debian 上运行的网页文件管理器。安装后可从局域网或 VPN 内的设备打开 `http://<Debian IP>:9999`。

**统一设计风格已于 2026-11-07 确定：采用用户确认的飞牛风格文件管理预览。** 后续文件管理、系统概览、任务管理器、阅读窗口、设置、菜单和程序坞都遵循同一套桌面与窗口设计。以桌面壁纸、浮动窗口、左侧程序坞、紧凑侧栏和工具栏、细描边、柔和阴影及深浅色主题为主要特征。

开发前必须阅读 [项目设计规范与交接](DESIGN.md)。该文档是界面设计的统一依据，替代之前以原生 macOS Finder / macOS 27 UI Kit 为首要目标的约定；各页面共用同一套视觉规范。

正式入口现在是 NAS 桌面：桌面图标与左侧程序坞可打开文件管理、系统概览、任务管理器、复制任务及桌面设置。双击桌面图标或单击程序坞打开应用；窗口支持拖动、最小化、最大化和恢复。桌面图标可以拖动，位置和深浅色外观保存在当前浏览器，也提供重新排列入口和 Alt + 方向键移动。

文件管理接入实际硬盘信息，侧栏动态显示物理盘，不写死盘数或名称；系统盘与休眠盘访问确认仍然保留。右键支持打开、文件下载、复制粘贴、新建文件夹、重命名、收藏、位置链接和详情，非系统盘可经确认永久删除项目。收藏保存在当前浏览器，重命名与删除会同步更新对应收藏。

统一界面由 [桌面与应用管理](src/desktop.tsx)、[共用窗口](src/app-window.tsx)、[共享样式](src/desktop.css) 和 [文件管理](src/finder.tsx) 组成。旧的独立模拟预览、旧底部 Dock 及旧 Finder 外观已移除；旧地址 `/#/preview/files` 重定向到真实文件管理。

开发时运行 Go 后端和 `npm run dev`，打开 `http://127.0.0.1:5173/`。文件管理与系统监控使用实际 API，Linux 文件操作仍按 [设计规范](DESIGN.md) 和 [部署说明](server/README.md) 中的磁盘保护要求执行。

在 [GitHub Actions](https://github.com/a3318375/mac-web-os/actions/workflows/installers.yml) 打开最近一次成功的构建，从 Artifacts 下载对应的安装脚本。

- x86-64 使用 `mac-web-os-linux-amd64.sh`。
- ARM64 使用 `mac-web-os-linux-arm64.sh`。

把脚本放到 Debian 的 `/tmp`，在 root 终端执行 `sh /tmp/mac-web-os-linux-amd64.sh`。ARM64 使用相应的文件名。安装脚本会打印访问地址。卸载时运行 `sh /opt/mac-web-os/uninstall.sh`。

本地构建和开发步骤见 [Debian 部署说明](server/README.md)。
