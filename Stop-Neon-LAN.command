#!/bin/zsh

set -u

typeset -r service_label='com.gary.neon-lan'
typeset -r service_domain="gui/$(/usr/bin/id -u)"
typeset -r service_target="${service_domain}/${service_label}"
typeset -r launch_agent_path="${HOME}/Library/LaunchAgents/${service_label}.plist"

pause_if_interactive() {
  if [[ -t 0 && "${NEON_NO_PAUSE:-0}" != '1' ]]; then
    printf '\n按任意键关闭此窗口…'
    read -k 1
    printf '\n'
  fi
}

fail() {
  printf '\n关闭失败：%s\n' "$1" >&2
  pause_if_interactive
  exit 1
}

[[ -f "${launch_agent_path}" ]] || fail "自动启动配置不存在：${launch_agent_path}"
/usr/bin/plutil -lint "${launch_agent_path}" >/dev/null \
  || fail '自动启动配置格式无效。'

typeset -r lan_host="$(
  /usr/bin/plutil -extract EnvironmentVariables.NEON_LAN_HOST raw -o - "${launch_agent_path}" 2>/dev/null
)"
typeset -r lan_port="$(
  /usr/bin/plutil -extract EnvironmentVariables.NEON_LAN_PORT raw -o - "${launch_agent_path}" 2>/dev/null
)"
[[ "${lan_port}" == <-> ]] \
  || fail '自动启动配置中的端口不是有效整数。'

# Disable before unloading so KeepAlive and the next login cannot immediately recreate a service the user explicitly stopped.
/bin/launchctl disable "${service_target}" \
  || fail '无法禁用局域网游戏服务。'

if /bin/launchctl print "${service_target}" >/dev/null 2>&1; then
  /bin/launchctl bootout "${service_domain}" "${launch_agent_path}" \
    || fail '无法卸载局域网游戏服务。'
fi

typeset listener_closed='0'
for attempt in {1..50}; do
  if ! /usr/bin/curl --noproxy '*' --silent --max-time 1 "http://${lan_host}:${lan_port}/__health" >/dev/null 2>&1; then
    listener_closed='1'
    break
  fi
  /bin/sleep 0.1
done

[[ "${listener_closed}" == '1' ]] \
  || fail '服务在 5 秒后仍可访问。'
if /usr/sbin/lsof -nP -iTCP:"${lan_port}" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "端口 ${lan_port} 仍被其他进程占用。"
fi

printf '\n局域网宇宙飞船已关闭；下次登录也不会自动启动。\n'
printf '需要恢复时，双击“Start-Neon-LAN.command”。\n'
pause_if_interactive
