# Secure LAN server / 安全局域网服务器

## 中文

`lan-static-server.mjs` 只把 V23 生产入口和运行资源发布到指定局域网地址。默认合同为：

- 监听 `10.10.0.250:8088`，不监听 `0.0.0.0`、回环地址、Wi-Fi、VPN 或雷雳网桥。
- 仅接受来源于 `10.10.0.0/24` 的 IPv4 连接，显式拒绝网关 `10.10.0.1`，并只接受 `Host: 10.10.0.250[:8088]`；即使未来误设转发并由网关改写来源，也不能通过应用层检查。
- 仅开放 `GET` / `HEAD`、根入口、健康检查和 `assets/`、`errors/`、`src/`、`styles/`、`vendor/`；README、审计、测试、工具、日志与点文件不会发布。
- 提供单段音频 Range、CSP、同源隔离、禁止嵌入、MIME 嗅探保护，以及关闭摄像头、麦克风、定位、USB、支付等无关浏览器权限。
- 不提供账号、上传、目录列表、写接口、WebSocket 或反向代理，也不创建路由器端口映射。

当前机器由用户级 LaunchAgent `com.gary.neon-v23-lan` 在登录后启动。局域网设备访问：

```text
http://10.10.0.250:8088/
```

主 HTML 同一目录提供两个可从 Finder 双击的脚本：

- `启动局域网游戏.command`：确认有线网卡仍为安全配置地址，启用并载入 LaunchAgent，通过健康检查后打开游戏。
- `关闭局域网游戏.command`：先禁用再卸载 LaunchAgent，确认端口关闭；关闭状态跨下次登录保留，直到再次运行启动脚本。

健康检查：

```text
http://10.10.0.250:8088/__health
```

运行回归：

```sh
node --test server/lan-static-server.test.mjs
```

服务器不承载凭据或私人数据，因此当前可信局域网使用 HTTP。若未来加入账号、得分上传或其他敏感数据，必须先升级为受信任证书的 HTTPS，再扩大合同。

### Windows 本地启动

Windows 玩家应双击项目根目录的 `Start-V23-Windows.cmd`；中文名 `启动Windows本地游戏.cmd` 是同一入口的轻量别名。不要直接在 Edge 打开 HTML，也不要直接打开 PS1。两个 CMD 均为纯 ASCII、无 BOM、CRLF，服务脚本为 Windows PowerShell 5.1 可解析的 UTF-8 BOM、CRLF。批处理固定调用系统 Windows PowerShell 并在任何退出码后保留结果窗口；服务把完整异常写入 Windows TEMP 下的 `NeonV23-Windows-launch.log`。`windows-local-server.ps1` 先按第 2 版清单校验主 HTML、两个 CMD、自身及全部生产资源的长度与 SHA-256，读不到 iCloud 占位文件、文件缺失、截断或混代时在打开浏览器前明确失败。通过后从 `48723–48732` 选择空闲端口，只绑定 `127.0.0.1`，只接受精确 Host、`GET / HEAD`、五个生产资源目录和单段 Range，并发送 CSP、同源、禁止嵌入和 MIME 防嗅探头。默认浏览器失败会尝试资源管理器并保留 URL。它不要求 Node/Python、管理员权限、Edge 扩展参数或网络连接；关闭启动窗口即释放服务。

修改任何生产字节后运行：

```sh
node tools/generate-windows-production-manifest.mjs
node --test server/windows-local-server.test.mjs
```

## English

`lan-static-server.mjs` publishes only the V23 production entry and runtime assets on one explicit LAN address. Its default contract is:

- Listen on `10.10.0.250:8088`, never `0.0.0.0`, loopback, Wi-Fi, VPN, or Thunderbolt bridge addresses.
- Accept IPv4 clients only from `10.10.0.0/24`, explicitly deny gateway `10.10.0.1`, and require `Host: 10.10.0.250[:8088]`. A future accidental forward whose source is rewritten by the gateway therefore still fails the application boundary.
- Allow only `GET` / `HEAD`, the root entry, health check, and `assets/`, `errors/`, `src/`, `styles/`, and `vendor/`. READMEs, audits, tests, tools, logs, and dotfiles remain private.
- Support one audio byte range and send CSP, same-origin isolation, anti-framing, MIME-sniffing protection, and denials for unrelated camera, microphone, location, USB, payment, and similar browser capabilities.
- Expose no account, upload, directory-listing, write, WebSocket, or reverse-proxy surface, and create no router port forwarding.

The current machine starts the service at login through the user LaunchAgent `com.gary.neon-v23-lan`. LAN devices use:

```text
http://10.10.0.250:8088/
```

Two Finder-double-clickable scripts live beside the main HTML:

- `启动局域网游戏.command` verifies that Ethernet still owns the configured address, enables and loads the LaunchAgent, then opens the game only after health succeeds.
- `关闭局域网游戏.command` disables before unloading the LaunchAgent and verifies that the port closes. The stopped state survives the next login until the start script runs again.

Health check:

```text
http://10.10.0.250:8088/__health
```

Run the regression suite:

```sh
node --test server/lan-static-server.test.mjs
```

HTTP is acceptable on the current trusted LAN because the server handles no credentials or private data. Add trusted-certificate HTTPS before introducing accounts, score uploads, or any other sensitive data.

### Windows local launch

Windows players should double-click `Start-V23-Windows.cmd` at the project root; `启动Windows本地游戏.cmd` is a thin alias for the same entry. Do not open either the HTML or PS1 directly. Both CMD files are ASCII, BOM-free, and CRLF; the service script is UTF-8 BOM plus CRLF for Windows PowerShell 5.1. The batch pins the built-in Windows PowerShell path and keeps the result window visible for every exit code, while the service writes full failures to `NeonV23-Windows-launch.log` under Windows TEMP. `windows-local-server.ps1` checks the main HTML, both CMD files, itself, and all production resources against the schema-2 size/SHA-256 manifest before opening a browser. Unreadable iCloud placeholders, missing or truncated bytes, and mixed releases fail clearly. It then selects a free port from `48723–48732`, binds only `127.0.0.1`, accepts the exact Host plus `GET / HEAD`, five production directories, and one media range, and emits CSP, same-origin, anti-framing, and MIME-sniffing protections. Default-browser failure falls back through Explorer while leaving the URL visible. It needs no Node/Python, administrator rights, Edge file-access flag, or network connection. Closing the launcher window releases the service.

After any production-byte change, run:

```sh
node tools/generate-windows-production-manifest.mjs
node --test server/windows-local-server.test.mjs
```
