# 集成与生命周期规范

仅以下项目属于首版协议目标，不自动宣称其他同名扩展兼容。不引入 Todo 提醒，不干预第三方已有通知、BEL、界面或 Fleet。

## Pi 宿主

已固定本地和开发依赖 `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` 1.4.0。公开 `ctx.mode` 区分 tui / rpc / json / print，`hasUI` 在 RPC 也可能为 true，不能作为提醒守卫。必须同时为 tui、stdin/stdout TTY 且 TERM 不是 dumb。

源码依据为本地 Pi 1.4.0：`dist/core/agent-session.js` 的 `_startRun` 在 retry / compaction / queued continuation 收束后才发送 settled；原生 `tool_execution_start` 会等待扩展 handler 完成，然后执行工具。`agent_end` 只收集最后 assistant 结果，后续成功覆盖中间失败。`agent_settled.aborted` 处理取消。

reload 和会话替换会 `session_shutdown`、使旧 runtime 失效、卸载事件总线监听，再载入新 runtime。因此存在真实观测空窗。所有待发提醒都有会话、轮次与通道资格；每次异步后端调用前再次检查，失效就停止。关闭开关、返焦、新任务、退出会使适用回调不可复活，重新打开不补旧动作。

## Ask

来源：[juicesharp/rpiv-mono 固定提交 8a39fcca41aa19d8fe85796e3897c276985cf645](https://github.com/juicesharp/rpiv-mono/tree/8a39fcca41aa19d8fe85796e3897c276985cf645/packages/rpiv-ask-user-question)，包元数据版本 **2.13.9**。

- `events.ts` blob `be3ead1f8f30b3734a4a1f1959c9865651396d0e`：`rpiv:ask-user:blocked` 含 boolean active 与 toolCallId，无 sessionId。
- `ask-user-question.ts` blob `999d5fa9296846134809b335342b8312c9459829`：同一个 toolCallId 的 true 包围整个问卷流程，finally 发 false，非每页重复开关。
- 必须先由当前会话原生 `tool_execution_start` 观察到精确工具名 `ask_user_question` 与该 toolCallId，blocked 才可关联。只看名字、总线、cwd 均不足。
- 多问卷独立跟踪。blocked false 或 native execution end 会结束对应资格；false 后重放 true 不能重新打开。同一 ID 的重复 native start 或跨会话复用保守跳过。
- 持续聚焦不新增提醒；离开且仍等待时最多一次静音通知，没有 pi-cue 音效。返焦隐藏等待标记；再次离开可显示等待状态，但不重发通知。多个等待优先合并为 `[?]`；实际标题能力目前禁用。

这次验证包括固定源码顺序、控制事件反例，以及真实 Pi 的本地工具 stub 发出协议事件；未安装真实 Ask 包并进行真实用户问卷端到端联调。

## pi-subagents

来源：[nicobailon/pi-subagents 固定提交 a9e2eec609a2a0447e4c2b057b2845187098d04e](https://github.com/nicobailon/pi-subagents/tree/a9e2eec609a2a0447e4c2b057b2845187098d04e)，源码包元数据 **0.80.0**，不把它当作已发布或本机安装版本。

- `src/shared/session-identity.ts` 定义 parent identity 为 `getSessionFile() ?? getSessionId()`；通常是父会话文件路径，不是子会话 UUID。
- `src/shared/completion-owner.ts` 使用 `Symbol.for("pi-subagents.completion-owner-id")`，为父 Pi 进程/窗口生成跨 reload 稳定 UUID。pi-cue 只读取已有值，绝不创建或猜测。
- `src/runs/background/async-execution.ts` 的 started 事件带 id、sessionId、completionOwnerId；固定生命周期格式为 3。pi-cue 要求这三个归属证据及格式匹配才记录启动。
- `src/runs/background/result-watcher.ts` 发出 `subagent:async-complete`，包含规范 runId 和原结果数据。完成必须匹配当前精确父会话、owner 和已观察启动；success 必须是 boolean。额外字段被忽略。
- 按 `[canonical parent UUID, runId]` 去重。`awaitedByWorkflow=true` 和 foreground 来源只移除已知运行状态，不单独提醒。同步前台子任务随主 settled；不监听 Todo。
- `pi.events` 仅进程内。没有文件轮询、跨进程传输或全局包猜测。观察到的后台任务仅用于准确表述主会话范围，不宣称掌握后台全貌。

进程期内记忆保留已消费 ID，不按短 TTL 重新开放。连续观察到的在途任务可以跨主 Agent 多轮完成；reload 或会话替换空窗使相关 run 变为 gap，之后完成保守跳过。当前协议没有经验证的可信新完成标记来跨越这个空窗；保留内存或 timestamp 字段本身不构成证据。未见启动、旧进程遗留以及切回后的历史事件均不补发。

Ask 的历史 toolCallId 集合和子任务记录各有 **8192** 项进程期上限。容量满后拒绝新追踪，显示诊断，重启可重新开始；不驱逐旧去重项以换取潜在重复提醒。记录不保存问题、回答或任务全文。

集成页分别显示「尚未观察」「未识别」或「已观察到可信协议」，以及拒绝计数。只有通过相应原生工具或父会话/owner 检查后才标识已识别；它是本会话观察证据，不等于已安装包版本保证。拒绝原因在诊断中查看，状态按事件刷新，无常驻探测。
