# Secure LAN server / 安全局域网服务器

## 中文

macOS 的 `Start-Neon-LAN.command` 可随项目目录复制到不同电脑。它从本机寻找 Node.js 20+，读取默认物理 `en*` 网卡的私网 IPv4、掩码与网关，在 `8088–8098` 中选择空闲端口，首次启动自动生成当前用户的 `~/Library/LaunchAgents/com.gary.neon-lan.plist`。配置里的 Node 与项目绝对路径来自当前电脑；服务在登录或重启时重新发现网络地址。`Stop-Neon-LAN.command` 禁用并卸载服务，停止状态在下次登录后仍有效。

- 默认物理网卡可为有线或 Wi-Fi；VPN、公共 IPv4、过宽网段和多个无法确定的地址会在监听前失败。VPN 改写默认路由时可用 `NEON_LAN_INTERFACE=en7` 显式选择本机物理网卡。
- 只绑定选中网卡的一个私网 IPv4；只接受同一实际子网的 IPv4 客户端，拒绝当前网关，并要求精确的 Host。需要固定端口时可设置 `NEON_LAN_PORT`；否则启动器自动选端口。
- 仅开放 `GET` / `HEAD`、根入口、健康检查和 `assets/`、`errors/`、`src/`、`styles/`、`vendor/`；README、审计、测试、工具、日志与点文件不会发布。
- 提供单段音频 Range、CSP、同源隔离、禁止嵌入和 MIME 防嗅探；不提供账号、上传、目录列表、写接口、WebSocket、反向代理或路由器端口映射。

启动器通过健康检查后输出当前机器的 `http://<私网地址>:<端口>/` 并打开浏览器。若 Node 未安装、网络不满足限制或端口不可用，会显示具体错误，不会改用 `0.0.0.0`。直接运行 `node server/lan-static-server.mjs` 在 macOS 上也会重新发现网络；非 macOS 服务器必须显式提供 `NEON_LAN_HOST` 与 `NEON_LAN_NETWORK`。只在可信局域网中运行此 HTTP 服务。

运行回归：

```sh
node --test server/lan-machine.test.mjs server/lan-service.test.mjs server/lan-static-server.test.mjs
```

### Windows 本地启动

Windows 玩家应双击项目根目录的 `Start-Neon-Windows.cmd`；英文别名 `Launch-Neon-Windows.cmd` 是同一入口的轻量别名。不要直接在 Edge 打开 HTML，也不要直接打开 PS1。两个 CMD 均为纯 ASCII、无 BOM、CRLF，服务脚本为 Windows PowerShell 5.1 可解析的 UTF-8 BOM、CRLF。批处理固定调用系统 Windows PowerShell 并在任何退出码后保留结果窗口；服务把完整异常写入 Windows TEMP 下的 `Neon-Windows-launch.log`。`windows-local-server.ps1` 先按第 2 版清单校验主 HTML、两个 CMD、自身及全部生产资源的长度与 SHA-256，读不到 iCloud 占位文件、文件缺失、截断或混代时在打开浏览器前明确失败。通过后从 `48723–48732` 选择空闲端口，只绑定 `127.0.0.1`，只接受精确 Host、`GET / HEAD`、五个生产资源目录和单段 Range，并发送 CSP、同源、禁止嵌入和 MIME 防嗅探头。默认浏览器失败会尝试资源管理器并保留 URL。它不要求 Node/Python、管理员权限、Edge 扩展参数或网络连接；关闭启动窗口即释放服务。

修改任何生产字节后运行：

```sh
node tools/generate-windows-production-manifest.mjs
node --test server/windows-local-server.test.mjs
```

## English

`Start-Neon-LAN.command` works from a copied project directory on another Mac. It finds Node.js 20+, reads the default physical `en*` interface’s private IPv4 address, mask, and gateway, selects a free port from `8088–8098`, and creates `~/Library/LaunchAgents/com.gary.neon-lan.plist` for the current user on first start. The generated Node and project paths belong to that computer; the server rediscovers the network on login and every restart. `Stop-Neon-LAN.command` disables and unloads the agent, preserving the stopped state across login.

- The default physical interface may be Ethernet or Wi-Fi. VPN routes, public IPv4 addresses, broad subnets, and ambiguous interface addresses fail before listening. If a VPN owns the default route, set `NEON_LAN_INTERFACE=en7` to select a physical interface on that computer.
- Bind only one private IPv4 address, accept only clients in its actual subnet, reject the current gateway, and require the exact Host. Set `NEON_LAN_PORT` for a fixed port or let the launcher choose one.
- Publish only `GET` / `HEAD`, the entry, health check, and `assets/`, `errors/`, `src/`, `styles/`, and `vendor/`. READMEs, audits, tests, tools, logs, and dotfiles stay private.
- Support one audio byte range and restrictive browser headers. There are no accounts, uploads, listings, write endpoints, WebSockets, reverse proxy, or router port mapping.

After the health check, the launcher prints this computer’s `http://<private-address>:<port>/` and opens it. Missing Node, an unsafe network, or unavailable ports produce a clear error; the server never falls back to `0.0.0.0`. Running `node server/lan-static-server.mjs` directly rediscovers the network on macOS. A non-macOS server requires explicit `NEON_LAN_HOST` and `NEON_LAN_NETWORK`. Run this HTTP service only on a trusted LAN.

Regression checks:

```sh
node --test server/lan-machine.test.mjs server/lan-service.test.mjs server/lan-static-server.test.mjs
```

### Windows local launch

Windows players should double-click `Start-Neon-Windows.cmd` at the project root; `Launch-Neon-Windows.cmd` is a thin alias for the same entry. Do not open either the HTML or PS1 directly. Both CMD files are ASCII, BOM-free, and CRLF; the service script is UTF-8 BOM plus CRLF for Windows PowerShell 5.1. The batch pins the built-in Windows PowerShell path and keeps the result window visible for every exit code, while the service writes full failures to `Neon-Windows-launch.log` under Windows TEMP. `windows-local-server.ps1` checks the main HTML, both CMD files, itself, and all production resources against the schema-2 size/SHA-256 manifest before opening a browser. Unreadable iCloud placeholders, missing or truncated bytes, and mixed releases fail clearly. It then selects a free port from `48723–48732`, binds only `127.0.0.1`, accepts the exact Host plus `GET / HEAD`, five production directories, and one media range, and emits CSP, same-origin, anti-framing, and MIME-sniffing protections. Default-browser failure falls back through Explorer while leaving the URL visible. It needs no Node/Python, administrator rights, Edge file-access flag, or network connection. Closing the launcher window releases the service.

After any production-byte change, run:

```sh
node tools/generate-windows-production-manifest.mjs
node --test server/windows-local-server.test.mjs
```
