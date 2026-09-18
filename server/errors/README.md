# LAN server errors / 局域网服务器错误

## 中文

- `configuration.mjs` 定义启动配置错误。绑定地址、端口、允许网段或静态根目录不满足安全合同时，服务器必须在监听端口前失败。
- 请求路径不存在、Host 不匹配或来源地址不在允许网段属于正常 HTTP 拒绝，不使用异常控制流。

## English

- `configuration.mjs` defines startup configuration failures. An invalid bind address, port, allowed subnet, or static root must fail before the server opens a listening socket.
- Missing request paths, Host mismatches, and clients outside the allowed subnet are normal HTTP rejections rather than exception-driven control flow.
