#!/bin/zsh

set -u

typeset -r project_directory="${0:A:h:h}"
typeset -r action="${1:-}"
typeset node_path=''

pause_if_interactive() {
  if [[ -t 0 && "${NEON_NO_PAUSE:-0}" != '1' ]]; then
    printf '\n按任意键关闭此窗口…'
    read -k 1
    printf '\n'
  fi
}

if [[ "${action}" != 'start' && "${action}" != 'stop' ]]; then
  printf '启动脚本需要 start 或 stop。\n' >&2
  pause_if_interactive
  exit 2
fi

# Finder does not inherit nvm's interactive shell setup, so discover a compatible installed Node per computer.
for candidate in "$(command -v node 2>/dev/null)" \
  /opt/homebrew/bin/node /usr/local/bin/node \
  "${NVM_DIR:-${HOME}/.nvm}"/versions/node/*/bin/node(N); do
  [[ -x "${candidate}" ]] || continue
  if "${candidate}" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
    >/dev/null 2>&1; then
    node_path="${candidate}"
    break
  fi
done

if [[ -z "${node_path}" ]]; then
  printf '需要先安装 Node.js 20 或更新版本，再双击本脚本。\n' >&2
  pause_if_interactive
  exit 1
fi

"${node_path}" "${project_directory}/server/lan-service.mjs" "${action}"
typeset -r result=$?
if [[ "${result}" -ne 0 ]]; then
  printf '局域网服务操作失败；错误详情见上方输出。\n' >&2
fi
pause_if_interactive
exit "${result}"
