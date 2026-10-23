# 配置、模板与保存契约

唯一生效文件是 Pi 公开 `getAgentDir()` 返回目录中的 `pi-cue.json`，默认通常为 `~/.pi/agent/pi-cue.json`。支持宿主对 `PI_CODING_AGENT_DIR` 的归一化。有效设置是内置默认加此文件；界面、自动提醒、测试与试听使用同一份值。

## 从此前实现升级

此前的个人文件原样沿用，已有明确值继续生效，包括界面语言、自定义通知模板和旧自定义音效。缺少配置时内置 UI 语言为 English，不会因升级强行改写已选择的语言。

此前的项目 `.pi/pi-cue.json` 不再读取、合并、校验或写入，文件保留原字节。损坏的旧项目文件也不会阻塞新版。只存在于项目文件里的值停止生效，不会自动复制到通用配置；如需迁移，先明确选定要应用到所有项目的设置，再由 agent 处理。

升级过程中，新配置存储等待同一文件的旧版在途事务完成后再读取磁盘，保住已经确认的写入；不继承旧项目文件的错误或状态。其他文件的队列不会阻塞它。

```json
{
  "schemaVersion": 1,
  "settings": {
    "language": "en",
    "soundPreset": "soft",
    "minWorkMs": 5000,
    "minAwayMs": 3000
  }
}
```

## 保存和恢复

v1 结构仍为 `schemaVersion` + `settings`，此次无需格式迁移。无版本、未来版本、损坏 JSON、非法已知字段、符号链接或超过 256 KiB 的文件均受写保护；非法文件不贡献有效值，错误可诊断。未知顶层字段和未知设置保留。

确认后的校验与保存进入同进程串行事务，跨 reload 和会话替换保留。磁盘提交采用独占目录锁、重新读取、SHA-256 指纹比较、临时文件、fsync 与原子 rename。冲突拒绝保存，须重读后重试；遗留锁不自动删除。忽略锁的外部编辑器仍可能在极窄窗口内制造竞争，不承诺任意写入者之间的数据库级事务。

General 的 Restore defaults / 恢复默认先显示确认，默认选取消；确认后只清除该 cue 文件中已知自定义设置，回到内置默认，未知字段保留。重读不写文件。关闭面板不撤销已确认事务，失败证据保留到下一次成功保存。

## 可编辑设置与兼容字段

当前双栏界面提供 21 个可编辑字段。机器契约仍保留 28 个已知字段；不为保留数量而继续提供无效操作。设置元数据在 `data/settings.json`，音效 ID 由 `data/presets.json` 生成合法列表，`scripts/generate-schema.mjs` 生成对应 Schema。

| 分类 | 字段 | 默认 |
|---|---|---|
| General | enabled / language | true / en；语言仅控制 /cue UI |
| Alerts | nativeNotification / backend | true / auto |
| Alerts | notifyWhenFocused / notifyWhenUnfocused | false / true |
| Alerts | notificationTitle / notificationBody | `Pi: {session}` / 空，使用事件内置英文正文 |
| Sound | soundEnabled / soundPreset | true / system；命名目录中的 ID |
| Sound | soundWhenFocused / soundWhenUnfocused | true / true |
| Behavior | notifyOnError / notifyOnAbort | true / false |
| Behavior | minWorkMs / minAwayMs | 0 / 0；整数 0–86,400,000 ms |
| Behavior | unknownFocusPolicy | unfocused；unfocused / focused / silent |
| Add-ons | notifyOnAsk | false |
| Add-ons | subagentNotifications / subagentOnSuccess / subagentOnFailure | false / true / true |
| 兼容字段 | soundFile 与 soundPreset=file | 空；旧自定义音效，无路径编辑入口 |
| 兼容字段 | markerEnabled / markWhenUnfocused / markerPrefix | true / true / `[!] `；当前无标题输出 |
| 兼容字段 | clearOnFocus / clearOnStart | true / true；原完成标记语义保留 |
| 兼容字段 | headlessNotifications | false；true 仍非法，不能绕过非交互守卫 |

命名音效只从扩展的 assets 目录读取普通 PCM WAV 文件，拒绝目录穿越、绝对资源名与符号链接。旧 `soundPreset=file` 和非空 `soundFile` 继续显示为 Custom sound / 自定义音效；相对路径仍以唯一 cue 配置文件目录为基准。不会将旧文件路径悄悄改写为其他音效。

声音格式为 RIFF 整数 PCM WAV：单/双声道、8/16 位、8–96 kHz，最大 20 MiB。文件无效、缺失或确定尚未开始时，最多尝试 soft 后备一次；播放结果未知不叠加。没有 MP3、任意 shell 命令或界面路径编辑功能。新增命名音效走 [agent 添加规范](sounds.md)。

system 映射为 macOS Glass、Windows Asterisk、Linux complete；WSL 使用 Windows 宿主映射，不承诺跟随系统所有个性化通知音设置。

## 计时、语言与模板

整轮从首个 `agent_start` 到最终 `agent_settled` 使用单调时钟，重试与 follow-up 不重置。成功、失败、启用的取消及异步子任务遵守工作门槛；Ask 不受工作门槛。away 记录连续有效失焦策略时间，unknown 策略计时不冒充实际观测。声音在完成时决定一次，延迟回调不重播。

`language` 只控制 /cue 面板文案和面板诊断显示，不改变 Pi 宿主语言，也不改变通知标题、正文或背景任务补充文字。内置事件正文固定为英文；自定义标题和正文不被语言切换改写。正文为空时使用主成功、失败、取消、Ask、子任务成功/失败的内置文字；非空正文适用于所有启用事件，可在 `/cue debug` 中预览。

模板仅支持 `{session}` / `{duration}`，不求值代码，未知或未闭合占位符拒绝保存，缺失字段显示 `—`。输入长度上限为标题 512、正文 4096 Unicode 码点；输出上限为标题 128、正文 1024。正文可多行，标题换行转空格；输入拒绝 TAB 和控制字符，输出清理 ESC、BEL、C1 与方向控制字符。默认不带回答、问题全文或错误详情。已确认有后台任务仍运行时，主完成追加英文说明。
