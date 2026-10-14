---
name: product-trendy-video
description: 用商品图制作具有佩戴动作的头戴式耳机赛博潮流短片，或定向修改已绑定场景的镜头与素材；通过场景服务自动补齐默认输入并交付成片。
---

# 商品潮流视频

设计示例：业务工具与场景包尚未安装。正式能力由目录available状态决定。详细业务定义见[场景模板](../scene-template.json)，执行设计见[方案B蓝图](../../2026-10-10-canvas-scheme-b-execution-blueprint.md)。

用户明确要生成此类短片时使用；询问做法、看模板或查看画布时不启动生成。此配方的动作适配头戴式耳机，其他商品按目录查找适合其用途的场景。

使用用户明确指定的商品素材，提取可见商品事实和用户要求保留的属性。模特、姿势采用用户指定素材或目录已提供的默认值；特定真人身份要求不能由默认角色满足。必要缺失项合并询问，不要求用户填写模型、模式、分辨率和内部节点参数。

正常生成调用一次 `canvas_generate`：sceneId=`product.trendy-video`、brief、具名素材inputs、可选businessOptions与有限creativeSpec。请求身份由Host关联真实用户行为，Agent无需构造。默认outputProfile=`video_complete`；用户请求完整素材包时使用`video_with_assets`。不要加载原始图并逐节点调用，不运行旧脚本。

工具返回started时展示真实运行与画布入口；needs_input时补齐返回项并沿continuation继续；needs_approval时通过真实用户响应批准具体计划；cannot_run时解释工具给出的业务差异或修复选项。不要伪造confirmed，不把用户未回复当成批准。

运行由插件和SSE推进，进度显示在状态卡；不创建cron、不反复调用状态工具。用户询问时使用`canvas_run(action=get)`读取最新状态。提交结果未知时只恢复事实，不重新发起生成。

用户明确修改某个镜头或节点时，用冻结的targetRef调用`canvas_edit`；只表达业务变化，采用服务返回的失效范围。用户要求取消、恢复或补做失败镜头时调用`canvas_run`对应动作。保留已成功素材，避免无关重跑。

完成说明采用已保存的主产物和次产物索引。成片与可选素材包分别报告状态；临时Blob、缺失分镜或旧轮媒体不能宣布为本轮完整结果。未提供音乐分支的模板交付无声成片，不自行声称已经配乐。
