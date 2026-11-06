#!/bin/sh
set -eu

install_dir=/opt/mac-web-os
unit=mac-web-os.service
arch=__ARCH__

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

service_user=root
case "${1:-}" in
  -h|--help)
    printf '用法：sudo sh %s\n' "$0"
    printf '在 root 终端可直接执行 sh %s。服务默认以 root 运行。\n' "$0"
    exit 0
    ;;
  --run-as)
    [ "$#" -eq 2 ] && [ -n "$2" ] || fail "--run-as 需要一个账户名。"
    service_user=$2
    ;;
  '')
    [ "$#" -eq 0 ] || fail "用法：sudo sh $0"
    ;;
  *) fail "用法：sudo sh $0" ;;
esac
[ "$(id -u)" -eq 0 ] || fail "请用 sudo 执行安装脚本。"
[ "$(uname -s)" = Linux ] || fail "此安装包用于 Debian Linux。"
command -v dpkg >/dev/null && command -v systemctl >/dev/null ||
  fail "此安装包需要使用 systemd 的 Debian 系统。"
[ "$(dpkg --print-architecture)" = "$arch" ] ||
  fail "此安装包用于 $arch，当前系统是 $(dpkg --print-architecture)。"
[ ! -L "$install_dir" ] || fail "请将 $install_dir 设置为普通目录。"

if [ -d "$install_dir" ]; then
  case "$(stat -c '%u:%a' "$install_dir")" in
    0:755|0:750|0:700) ;;
    *) fail "$install_dir 必须由 root 所有，且权限为 755、750 或 700。" ;;
  esac
fi
case "$service_user" in
  -*|*[!a-zA-Z0-9_.-]*) fail "无效的服务账户：$service_user" ;;
esac
id -u "$service_user" >/dev/null || fail "找不到服务账户 $service_user。"

install -d -m 0755 -- "$install_dir"
stage=$(mktemp -d "$install_dir/.install.XXXXXX")
cleanup() {
  rm -f -- "$stage/mac-web-os" "$stage/$unit" "$stage/uninstall.sh"
  rmdir -- "$stage"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

base64 -d <<'MAC_WEB_OS_PAYLOAD' | gzip -dc >"$stage/mac-web-os" || fail "安装包解压失败，请重新复制。"
__PAYLOAD__
MAC_WEB_OS_PAYLOAD
printf '%s  %s\n' '__SHA256__' "$stage/mac-web-os" | sha256sum -c --status ||
  fail "安装包校验失败，请重新复制。"

chmod 0755 "$stage/mac-web-os"

cat >"$stage/$unit" <<EOF
[Unit]
Description=mac-web-os
After=local-fs.target

[Service]
Type=exec
User=$service_user
ExecStart=$install_dir/mac-web-os -listen :9999
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF

cat >"$stage/uninstall.sh" <<'MAC_WEB_OS_UNINSTALL'
__UNINSTALL__
MAC_WEB_OS_UNINSTALL

chmod 0755 "$stage/uninstall.sh"
chmod 0644 "$stage/$unit"
mv -fT -- "$stage/mac-web-os" "$install_dir/mac-web-os"
mv -fT -- "$stage/$unit" "$install_dir/$unit"
mv -fT -- "$stage/uninstall.sh" "$install_dir/uninstall.sh"

systemctl enable "$install_dir/$unit"
systemctl restart "$unit" || fail "服务启动失败。运行 sudo journalctl -u $unit -n 30 查看日志。"
sleep 1
systemctl is-active --quiet "$unit" ||
  fail "服务未运行。运行 sudo journalctl -u $unit -n 30 查看日志。"

rm -f -- "$install_dir/lan.json"
printf 'mac-web-os 已安装到 %s\n' "$install_dir"
addresses=$(hostname -I 2>/dev/null || true)
for address in $addresses; do
  case "$address" in
    *:*) address="[$address]" ;;
  esac
  printf '访问 http://%s:9999\n' "$address"
done
[ -n "$addresses" ] || printf '访问 http://<Debian IP>:9999\n'
printf '卸载：sudo sh %s/uninstall.sh\n' "$install_dir"
