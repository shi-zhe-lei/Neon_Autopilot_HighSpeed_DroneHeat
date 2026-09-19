#!/bin/zsh

set -u

typeset -r service_label='com.gary.neon-lan'
typeset -r service_domain="gui/$(/usr/bin/id -u)"
typeset -r service_target="${service_domain}/${service_label}"
typeset -r launch_agent_path="${HOME}/Library/LaunchAgents/${service_label}.plist"
typeset -r script_directory="${0:A:h}"
typeset -r expected_entry_path="${script_directory}/Neon_Autopilot_HighSpeed_DroneHeat.html"
typeset -r expected_server_path="${script_directory}/server/lan-static-server.mjs"

pause_if_interactive() {
  if [[ -t 0 && "${NEON_NO_PAUSE:-0}" != '1' ]]; then
    printf '\n按任意键关闭此窗口…'
    read -k 1
    printf '\n'
  fi
}

fail() {
  printf '\n启动失败：%s\n' "$1" >&2
  pause_if_interactive
  exit 1
}

[[ -f "${expected_entry_path}" ]] || fail '主 HTML 不在启动脚本旁边。'
[[ -f "${expected_server_path}" ]] || fail '安全局域网服务器文件缺失。'
[[ -f "${launch_agent_path}" ]] || fail "自动启动配置不存在：${launch_agent_path}"

/usr/bin/plutil -lint "${launch_agent_path}" >/dev/null \
  || fail '自动启动配置格式无效。'

typeset -r configured_server_path="$(
  /usr/bin/plutil -extract ProgramArguments.1 raw -o - "${launch_agent_path}" 2>/dev/null
)"
typeset -r configured_node_path="$(
  /usr/bin/plutil -extract ProgramArguments.0 raw -o - "${launch_agent_path}" 2>/dev/null
)"
typeset -r lan_host="$(
  /usr/bin/plutil -extract EnvironmentVariables.NEON_LAN_HOST raw -o - "${launch_agent_path}" 2>/dev/null
)"
typeset -r lan_port="$(
  /usr/bin/plutil -extract EnvironmentVariables.NEON_LAN_PORT raw -o - "${launch_agent_path}" 2>/dev/null
)"

[[ "${configured_server_path}" == "${expected_server_path}" ]] \
  || fail '自动启动配置指向了其他目录，请先同步配置路径。'
[[ -x "${configured_node_path}" ]] \
  || fail "Node 运行时不可执行：${configured_node_path}"
[[ "${lan_port}" == <-> ]] \
  || fail '自动启动配置中的端口不是有效整数。'

# Fail closed when Ethernet no longer owns the configured address; silently binding another interface would weaken LAN isolation.
typeset -r current_ethernet_ip="$(/usr/sbin/ipconfig getifaddr en0 2>/dev/null || true)"
[[ "${current_ethernet_ip}" == "${lan_host}" ]] \
  || fail "有线网卡当前地址是 ${current_ethernet_ip:-未连接}，安全配置要求 ${lan_host}。"

typeset -r game_url="http://${lan_host}:${lan_port}/"
typeset -r health_url="${game_url}__health"
/bin/mkdir -p "${HOME}/Library/Logs/NeonLAN" \
  || fail '无法创建服务日志目录。'

/bin/launchctl enable "${service_target}" \
  || fail '无法启用局域网游戏服务。'

if /bin/launchctl print "${service_target}" >/dev/null 2>&1; then
  /bin/launchctl kickstart -k "${service_target}" \
    || fail '无法重新启动局域网游戏服务。'
else
  /bin/launchctl bootstrap "${service_domain}" "${launch_agent_path}" \
    || fail '无法载入局域网游戏服务。'
fi

# Health success, rather than process existence alone, is the authority for presenting a playable URL.
typeset health_ready='0'
for attempt in {1..50}; do
  if /usr/bin/curl --noproxy '*' --fail --silent --show-error --max-time 1 "${health_url}" >/dev/null 2>&1; then
    health_ready='1'
    break
  fi
  /bin/sleep 0.1
done

if [[ "${health_ready}" != '1' ]]; then
  printf '\n最近的错误日志：\n' >&2
  /usr/bin/tail -n 20 "${HOME}/Library/Logs/NeonLAN/server-error.log" 2>/dev/null >&2 || true
  fail '服务未在 5 秒内通过健康检查。'
fi

printf '\n局域网宇宙飞船已启动：\n%s\n' "${game_url}"
if [[ "${NEON_SKIP_OPEN:-0}" != '1' ]]; then
  /usr/bin/open "${game_url}" \
    || printf '服务已启动，但未能自动打开浏览器。\n' >&2
fi

pause_if_interactive
