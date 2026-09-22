# OSS 上传链路最小诊断

仅诊断，**不 stage / promote，不改 RC17 资产或更新指针**。复用现有
publish-update 工作流身份与 STS，不需要手工提供密钥。合并到 main 后执行：

```sh
gh workflow run publish-update.yml --ref main -f command=diagnose -f tag=v1.0.0-rc.17 -f scope=all
```

tag 仅用于工作流名称/报告名称，诊断不会下载该 Release。
会与正式发布任务串行，不能跳过现有发布并发锁。

## 对照项

同一个 Runner 依次运行：64 KiB 和 4 MiB 的 SDK 文件 PUT、SDK Buffer PUT、
Node HTTPS Buffer PUT，以及 8 MiB 的 SDK 文件/Buffer 分片上传（4 MiB/片）。
独立 HTTPS 复用 SDK V4 签名，但不经过 ali-oss/urllib 的发送实现；因此不是
完全独立的鉴权对照。每请求 60 秒，无重试，单项失败后继续。

报告位于工作流 artifact 内的 `oss-probe.json`。任一对照失败时 workflow 标红，
但仍上传报告。最坏情况下工作流诊断步骤 15 分钟后终止。
最多写入约 28.2 MiB 随机测试内容，路径 `desktop/diagnostics/<run>-<uuid>/`。
诊断对象及未完成的 multipart 保留给运维核查，不申请删除权限。

## 判读

- 小请求也返回 403：先核查该诊断路径的 STS/RAM 权限，不能判定网络故障。
- Buffer 成功、文件失败：优先检查文件流/SDK 路径。
- SDK 失败、HTTPS 成功：优先检查 SDK 发送实现及连接复用；鉴权方式也有差异。
- 多种实现只有大请求超时：上传链路/请求体处理优先，需结合 OSS 访问记录。
- 全部成功：只能说明该 Runner 当时的小规模上传正常，不能证明 287 MB 资产发布已恢复。

`sourceBytesRead` 是本地流已消费字节数，0 也可能是非流发送。
`bodyBytesSubmitted` / `requestBodyFlushed` 只代表交给本地系统，不代表 OSS 收到。
HTTPS 另外记录 DNS/TCP/TLS/响应耗时。仅 2xx 是请求成功证据；不打印签名 URL、
凭证、原始异常或响应正文。SDK 自身可能打印普通对象请求 URL，但不包含签名查询参数。
