#!/bin/sh
set -eu

install_dir=/opt/mac-web-os
unit=mac-web-os.service

if [ "$(id -u)" -ne 0 ]; then
  printf '请执行 sudo sh %s/uninstall.sh\n' "$install_dir" >&2
  exit 1
fi
if [ -L "$install_dir" ]; then
  printf '安装目录是符号链接，请检查 %s。\n' "$install_dir" >&2
  exit 1
fi
if [ ! -d "$install_dir" ]; then
  printf 'mac-web-os 已卸载。\n'
  exit 0
fi

load_state=$(systemctl show -p LoadState --value "$unit") || [ "$load_state" = not-found ]
if [ "$load_state" != not-found ]; then
  systemctl disable --now "$unit"
fi
rm -f -- "$install_dir/mac-web-os" "$install_dir/$unit" "$install_dir/uninstall.sh" "$install_dir/lan.json"
if ! rmdir -- "$install_dir" 2>/dev/null; then
  printf '已卸载 mac-web-os。%s 中的其他文件已保留。\n' "$install_dir"
else
  printf 'mac-web-os 已卸载。\n'
fi
