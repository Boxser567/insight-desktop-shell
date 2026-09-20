# 因赛多模态企业代理协议

## 连接和鉴权

技能调用随包 enterprise_proxy.mjs，读取私有本机代理描述；企业 Host 携带当前登录态。后端端点：
`POST /api/skill-proxy/call-insight-api`。

请求：
```json
{
  "method": "POST",
  "path": "/v1/proxy",
  "query": {},
  "body": {
    "model_id": "目录返回的 canonical_model_id",
    "task_type": "text_to_image",
    "data": {"prompt": "小狗", "image_url_list": [], "image_params": {}}
  }
}
```

不要直接使用 curl 调公网后端或提供凭据。脚本 → 本机代理 → 后台，每层都有请求上限；不接受任意目标 URL、请求头或自带鉴权。后端独立连接默认指向原版的 52867 部署，使用服务端 INSIGHT_API_AK / INSIGHT_API_SK，并覆盖 biz_info 为实际登录用户。不影响 media-generator 的 52667 连接及 MG_API_AK / MG_API_SK。

实际转发白名单：POST /v1/proxy、POST /v1/proxy_async_create、POST /v1/proxy_async_get_result。后端分别签名，客户端不设置主机或签名字段。

HTTP 响应是 NDJSON：accepted → heartbeat（可重复）→ result 或 error。enterprise_proxy.mjs 消费事件并只返回 result.body。非 2xx、网络中断或 error 不自动重试。

## 模型目录与参数

实时读取固定公开 OSS model_params_with_mode.json；失败后显式回退包内 references/model_params.json。客户端合并 parameters 与历史拼写 senoir_parameters，跳过 set 类型默认值。model_key 选择模式条目，canonical_model_id 发给后台。显式模型选择不能被免费优先规则覆盖。

参数映射：
- 文本/理解 → data.chat_params（search_resource 默认 false）
- 图片 → data.image_params
- 视频 → data.video_params；enableRealPerson → enable_real_person，enableAudio → enable_audio
- 音频 → data.audio_params；TTS voiceId → voice_id、language_boost → language、vol → volume、pitch → intonation
- 参考素材 → image_url_list、video_url_list、audio_url_list、voice_url_list
- gen_count → 调用次数，不放到上游参数对象
- cameraControl 启用时按原版生成镜头提示词前缀

聊天附件必须使用现有 STS 上传返回的 HTTP(S) URL，不接受本机路径或占位 URL。企业版不分发长期 OSS AK/SK 上传脚本。

## 异步视频

| 模式 | 创建 task_type | 查询 task_type |
| --- | --- | --- |
| text_to_video | async_text_to_video_create | async_text_to_video_get_result |
| image_to_video | async_image_to_video_create | async_image_to_video_get_result |
| reference_image_to_video | async_reference_image_to_video_create | async_reference_image_to_video_get_result |
| first_last_frame_to_video | async_first_last_frame_to_video_create | async_first_last_frame_to_video_get_result |

创建使用完整模型/data 请求，发往 /v1/proxy_async_create。
返回 data.task_id_list 是企业后台加密的任务句柄，绑定当前用户、连接和查询模式，24 小时有效；只用于本后台查询。后台解密后传递 API Manager 的真实本地任务 ID，不将用户间的任务查询权限混用。各副本须配置一致且稳定的 JWT_SECRET；轮换密钥会使旧句柄失效。

查询发往 /v1/proxy_async_get_result，body 仅：
```json
{"task_type":"async_text_to_video_get_result","task_id":"创建时返回的完整任务句柄"}
```

code=0 且 status=running 时继续等候；success 返回 data.video_list；failed、未知状态、非零 code 或超时停止。不要拿供应商内部 ID 查询。客户端打印 async_created 后才开始查询，可用 poll 子命令恢复，不能重复创建以“重试查询”。

默认查询间隔 10 秒，整体等候 3600 秒，单次异步请求 120 秒；JSON 代理单次等待上限 1250 秒，后端上游超时上限 1200 秒。整体超时不表示上游任务取消。

## 产物

同步/异步成功均要求 HTTP 2xx 和 code=0。按模态读取 data.text_list / image_list / audio_list / video_list，并在对话展示真实结果。脚本返回值不是 enterprise_generate 记录，不会自动创建画布或历史产物卡片。

## 来源

由本机 /Users/duzhimeng/.codex/skills/call-insight-api 的 2026-09-16 版本迁入：保留原版模型目录、模式参数转换、音视频解析与异步语义；企业适配替换凭据、签名和发送层，去除长期凭据上传。原 Codex 技能目录不修改。
