# 平台能力与验证状态

记录日期：2026-10-23。实现目标仍包含 Windows 10/11 + Windows Terminal、macOS Terminal.app / iTerm2 / Ghostty、Linux 桌面、WSL2 + Windows Terminal。当前没有取得全部目标组合的实机通过证据。

| 系统 / 终端 / 模式 | 通知 | 声音 | 焦点 | 标题 | 状态 |
|---|---|---|---|---|---|
| macOS 26.6.2 (25G83)，受控 PTY，Pi 1.4.0，Node 24.18.0，fullscreen | 修正后宿主 JXA 返回 submitted；未目视确认横幅 | afplay 生成的 soft WAV 退出 0；未人工确认扬声器可听 | 真实 Pi 输入链路接受受控 FocusIn/Out 序列；不是桌面窗口切换实测 | 禁用，不写原始标题 | 宿主与进程级部分验证 |
| macOS Terminal.app（具体版本未采集） | 待实测 | 待实测 | 待真实窗口切换 | 能力禁用 | 目标组合待验证 |
| macOS iTerm2（具体版本未采集） | 待实测 | 待实测 | 待真实窗口切换 | 能力禁用 | 目标组合待验证 |
| macOS Ghostty（具体版本未采集） | 待实测 | 待实测 | 待真实窗口切换 | 能力禁用 | 目标组合待验证 |
| Windows 10 + Windows Terminal | WinRT silent XML 代码/参数验证；无实机 | Asterisk / SoundPlayer 代码路径；无实机 | 待报告验证 | 能力禁用 | 待验证 |
| Windows 11 + Windows Terminal | 同上；要求现有稳定版 Windows Terminal 通知身份 | 同上 | 待报告验证 | 能力禁用 | 待验证 |
| Linux 桌面（尚无具体发行版/桌面组合实测） | D-Bus 唯一 owner + sound capability 的受控适配器验证 | complete / paplay / aplay 路径受控验证 | 待实际终端报告 | 能力禁用 | 待验证，不能泛称 Linux 已支持 |
| WSL2 + Windows Terminal | 内核识别、Windows 宿主桥代码已实现；无实机 | wslpath 到 Windows SoundPlayer；无实机 | 待实际宿主报告 | 能力禁用 | 待验证 |
| tmux | 按外层能力；未做实机组合验证 | 按本机后端 | 不把 pane active 当桌面焦点 | 能力禁用 | 尽力适配 |
| SSH | 跳过远端 native 通知 | 跳过远端声音 | 无报告时 unknown | 能力禁用 | 不保证本机提醒 |
| 无桌面 Linux | 缺桌面/D-Bus 时跳过 | 只按现有工具能力，不保证输出设备 | 通常 unknown | 能力禁用 | 不保证桌面提醒 |
| print / JSON / RPC / 无 TTY / TERM=dumb | 禁止 | 禁止 | 不装观察器，不写控制序列 | 禁止 | 模式守卫与真实 Pi 事件探针已验证 |

此前已记录的真实通知测试未采集系统通知权限与勿扰状态；因此 submitted 仅证明桥接调用提交，不能据此判断该环境的横幅可见性或完整验收条件。

## 本次 macOS 有限核查

2026-10-23，`sw_vers` 确认本机 macOS 26.6.2（25G83）。不发送通知的JXA探针确认通知对象和默认center仍可创建、`soundName`为nil；该探针进程自身的bundle identifier为`com.apple.osascript`。这些只证明兼容API存在，不能证明横幅已显示，也不能据此判断Terminal不支持或确认系统设置中的通知归属。这些检查没有读取通知内容、通知权限或专注模式状态。

当前实现由 `osascript` 通过JXA调用旧版 `NSUserNotificationCenter`。Apple已将该API标为弃用，文档明确通知中心及用户设置可以影响呈现；`deliver(_:)`还会将`isPresented`设为true，因此补读该属性也不能把本实现的提交结果升级为目视显示证据。参见 [NSUserNotificationCenter](https://developer.apple.com/documentation/foundation/nsusernotificationcenter) 与 [deliver(_:)](https://developer.apple.com/documentation/foundation/nsusernotificationcenter/deliver(_:))。弃用不等于本机API已不存在。

[Apple通知设置说明](https://support.apple.com/guide/mac-help/change-notifications-settings-mh40583/mac)列出应用允许通知、显示位置及共享屏幕等控制；本次未检查这些状态，因此没有将它们写作缺少横幅的确定原因。当前保留兼容调用与原有防重复规则，排障反馈使用中性的“已尝试发送，是否显示尚无法确认”，诊断明确显示未验证。没有更改系统权限、安装helper或打包签名应用，也没有重复发系统通知。

### 现代接口的替换判断

本轮进一步核对了Apple当前 [UNUserNotificationCenter.current()](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/current()) 和 [通知授权说明](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications)：现代接口使用应用自己的通知中心，面向用户的提醒需要应用授权。在现有裸 `osascript` / JXA 形态下，独立探针仅导入框架并读取 `currentNotificationCenter`，即因 `bundleProxyForCurrentProcess is nil` 原生断言退出134；mainBundle指向`file:///usr/bin/`。这项检查没有调用授权请求、权限查询、通知添加或声音播放。

这个本机反例说明现代API不能直接替换当前JXA调用；Node扩展目前也没有可复用的应用身份与授权载体。为遵守轻量使用边界，本轮保留旧兼容尝试和显示未验证说明，没有引入应用bundle、签名、注册helper或新依赖。该结论限定于当前扩展形态，不代表所有macOS应用或终端都不支持系统通知。AppleScript `display notification`仍是既有脚本命令，不被当作现代接口替换方案。

## 后端契约

macOS 使用现有 `osascript` 的 JXA Objective-C 桥接，`NSUserNotification.soundName = $()` 后检查 `isNil()`，不合格就不提交。**JavaScript null 不是 Objective-C nil**，该区别已用本机只读探针验证。Apple 的 [soundName 文档](https://developer.apple.com/documentation/foundation/nsusernotification/soundname) 和本机 SDK 头文件明确 nil 不播放声音。API 已被 Apple 标为 deprecated；若未来系统移除或拒绝，会保守降级，不声称长期保证。

Windows / WSL 使用 `powershell.exe -NoProfile -NonInteractive -EncodedCommand` 执行仓库内固定脚本，用户文本通过 UTF-8 stdin JSON 传递，XML 文字用 CreateTextNode。明确 `<audio silent="true"/>`，依据 [Microsoft Toast audio schema](https://learn.microsoft.com/en-us/uwp/schemas/tiles/toastschema/element-audio)。仅使用已存在的 `Microsoft.WindowsTerminal_8wekyb3d8bbwe!App` 身份，不注册快捷方式、不更改执行策略、不安装工具。Preview/非商店身份不自动视为同一身份。

Linux 先以 GetNameOwner 取得通知服务的唯一 D-Bus owner，再对同一 owner 调 GetCapabilities 与 Notify。只有声明 sound 能力才发送 suppress-sound=true；[Freedesktop 协议](https://specifications.freedesktop.org/notification/latest/protocol.html) 要求 sound capability 对应支持 suppress-sound。仅传 hint 而不核验能力不算可靠静音。未知能力、缺 gdbus、无桌面环境或无会话总线则跳过。当前每个平台只有一个合规通知适配器，没有启用 OSC 后备。

三种结果为 submitted / not-submitted / unknown。系统权限、勿扰、通知中心设置和桌面会话可能阻止横幅。已经提交或未知不会重发；不承诺撤回已显示通知，也不承诺点击精确返回原 tab/pane。

system 音效映射为 macOS `/System/Library/Sounds/Glass.aiff`、Windows `SystemSounds.Asterisk`、Linux `canberra-gtk-play -i complete`；WSL 明确走 Windows 宿主。soft/bright 为项目生成的 22,050 Hz 单声道 16-bit PCM WAV。Linux 本地 WAV 用 paplay，确定未启动才可用 aplay；播放结果未知不叠加。工具缺失不会自动安装。

## 补齐实机验收

在每个目标组合记录 OS、终端、Pi、Node、桌面通知服务与音频工具版本，加载扩展并运行 `/cue debug` 的通知测试与声音试听。分别确认通知无自带声音、独立音效一次、聚焦/失焦/unknown诊断、权限拒绝与勿扰、缺工具、候选取消、reload/退出资源释放。使用一轮真实模型对话验证 settled 边界；没有凭据时可运行仓库的本地确定性 provider 探针，但须标明它不是外部模型或第三方包联调。禁止把控制序列注入当作桌面聚焦实测。
