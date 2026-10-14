# 任务4：真实账号手测步骤与结果

当前alpha.10已安装启用，最小实账验收已经完成：画布103165、“聊天图片”节点 `23a70961-ecc5-4ace-9447-8cdb8db56513`、版本1、资产登记registered。Agent权威重载confirmed一致，最后手动原生UI显示同一测试图片。[完整记录](evidence/2026-10-13-task-4-live-results.json)。不需要重新安装或重复创建；下方是用户自行复验的步骤。

## 目标

通过一条自然语言，将当前聊天里的图片保存成原生图片来源节点。只上传/保存，不触发图片或视频生成，Agent无需打开画布。PNG/JPEG/WEBP/GIF且小于20MiB；普通聊天图片可能已归一化，文件附件的原始图片本期不接入。

## 复验操作

1. 在当前Shell新会话中附一张测试图片；可使用本目录[evidence/task-4-test-image.png](evidence/task-4-test-image.png)，不用上传真实商品。保持画布关闭。
2. 发送：

> 创建一个叫“Agent素材复验”的空画布，将我附上的这张图片作为图片素材节点加入，标题为“聊天图片”。只上传和保存，不生成图片或视频，不打开画布，不修改代码。完成后告诉我画布ID、节点ID、保存版本和资产登记状态。如果提交结果未知，请停止并如实说明，不要重复新增。

3. 在轨迹查看真实canvas_assets、canvas_create、canvas_get、canvas_asset_import：图片ID取当前附件；写前version可信；import必须saved并含实际节点ID/新版本，assetRegistration单独查看。不能仅凭自然语言“成功”。
4. 若Agent未自行权威重载，再发送“从后端重新读取刚创建的画布，核对聊天图片节点的ID、素材URL和保存版本，仍不要打开画布”。应为canvas_get(view:nodes,refresh:true)返回read/confirmed、contentType:upload、同ID/URL、generation:null。
5. 最后把真实画布ID填入原Shell画布控件，手动打开；应该能看见同一图片与标题。此时才创建可见画布面板。

## 本次实际结果

| 检查 | 已观察结果 |
| --- | --- |
| 图片 | 自造PNG320×200、1667bytes；attachment sha256与本地文件一致 |
| 创建 | created/103165/version0/runtime ready |
| 素材导入 | saved/version1/一个节点ID/asset uploaded；1174ms |
| 资产登记 | 工具完整结果中的assetRegistration.status为registered |
| 权威重载 | refresh true；read/confirmed/version1/nodeCount1/同ID与URL/contentType upload |
| 原生UI | 仅在重载后手动打开103165，蓝底三黄色块图片及“聊天图片”标题正确显示 |
| 原画布 | 103161未修改 |

底层HTTP次数和打开前数字iframe计数本次未采集，不能补写为实账测量值；相关一次写入/无iframe行为有自动原生fixture证据。需要排查运输问题时再使用正确Harness内容页DevTools Network；Host发起的上传/身份/登记不一定显示在Renderer Network中，工具回执和权威读取是本次主要证据。

## 错误处理

- needs_input：补当前聊天图片或明确来源节点/产物序号；多张候选用途不明时不猜。
- VERSION_CONFLICT/EDITOR_BUSY：保留用户正在编辑的内容，先核对，不替换版本强写。
- upload_unknown/submission_unknown：停止自动重试；先核对当前画布/原提交，不换调用重复添加。
- saved但登记失败：图片节点已经保存，保留ID；登记问题独立处理，不能以“修复登记”为理由重加节点。
- 模型不支持/模板/生成/连线：不属于本期素材工具范围，不要求Agent自行修改项目代码来补能力。
