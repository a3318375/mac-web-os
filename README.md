# mac-web-os

在 Debian 上运行的网页文件管理器。安装后可从局域网或 VPN 内的设备打开 `http://<Debian IP>:9999`。

继续开发前先看 [项目交接与设计参考](DESIGN.md)，其中整理了用户需求、参考设计、代码入口和最近验证状态。

在 [GitHub Actions](https://github.com/a3318375/mac-web-os/actions/workflows/installers.yml) 打开最近一次成功的构建，从 Artifacts 下载对应的安装脚本。

- x86-64 使用 `mac-web-os-linux-amd64.sh`。
- ARM64 使用 `mac-web-os-linux-arm64.sh`。

把脚本放到 Debian 的 `/tmp`，在 root 终端执行 `sh /tmp/mac-web-os-linux-amd64.sh`。ARM64 使用相应的文件名。安装脚本会打印访问地址。卸载时运行 `sh /opt/mac-web-os/uninstall.sh`。

本地构建和开发步骤见 [Debian 部署说明](server/README.md)。
