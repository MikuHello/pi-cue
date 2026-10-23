<p align="center">
  <img src="docs/images/hero.svg" width="100%" alt="pi-cue：为 Pi 提供任务完成提醒，用 /cue 设置，用 /cue debug 排障。">
</p>

# pi-cue

[English](README.md) · **简体中文**

**给 Pi 的任务完成提醒。** 桌面通知和音效分别控制，提醒时机随终端焦点状态调整。任务真正收尾后，给一次提示，让注意力回到手头的事。

<p align="center">
  <img src="docs/images/sound-settings.png" width="560" alt="pi-cue 当前声音设置：左侧五类日常设置，右侧音效开关、命名音效、试听及聚焦和离开时的播放条件。">
</p>

<p align="center">
  <sub>配置页面预览</sub>
</p>

## 能做什么

- **在整轮结束时提醒。** 重试和排队续作合并到同一轮，结束后再判断是否需要提醒。
- **通知与声音各自控制。** 桌面通知请求静音，音效可独立开关、选择和试听；短任务与离开时长可设门槛。
- **在原生 TUI 里设置。** English / 简体中文界面，五类日常设置，确认一项即保存；`/cue debug` 单独提供排查工具。
- **按需观察集成。** 支持已验证协议的 Ask 等待回答和异步子任务事件；默认关闭，启用前查看[集成说明](docs/integrations.md)。

## 快速开始

需要 **Node.js 24+** 和 **Pi 1.4.0**；当前适配 Pi TUI 1.4.0，无需 pi-open-tui。

安装 npm 包 [`@mikuhello/pi-cue`](https://www.npmjs.com/package/@mikuhello/pi-cue)，并将扩展登记到个人 Pi 配置：

```sh
pi install npm:@mikuhello/pi-cue
```

重新启动 Pi 会话后输入 `/cue`。若只想临时体验一次、不登记到配置：

```sh
pi -e npm:@mikuhello/pi-cue
```

也支持从 GitHub 安装：

```sh
pi install git:github.com/MikuHello/pi-cue
```

### 从源码加载

下载或克隆源码后，在项目目录安装依赖：

```sh
npm ci --ignore-scripts --cache .dev/npm-cache --no-audit --no-fund
```

在同一目录临时加载扩展，沿用日常 Pi 的模型与配置：

```sh
pi -e ./index.ts
```

进入 Pi 后输入：

```text
/cue
```

也可以在其他工作目录启动 Pi，把 `./index.ts` 换成源码中 `index.ts` 的实际绝对路径。`-e` 只为本次运行加载扩展，不登记到全局扩展配置。

## 日常使用

| 命令 | 用途 |
|---|---|
| `/cue` | 常规、通知、声音、行为和集成设置 |
| `/cue debug` | 发送测试通知、试听当前音效、预览文字、查看诊断 |
| `/cue help` | 查看用法；参数支持补全 |

**设置面板：** ← / → 或 Tab 切栏，↑ / ↓ 选项，Enter / Space 操作。候选浏览不保存、不播放，音效列表按 P 试听。Esc / q 返回或关闭。

**排障面板：** 单列四项工具。打开不会自动发送或播放，明确执行动作才请求系统操作。提交反馈不等于通知横幅已经显示。

**配置：** 使用 Pi agent 目录下的一份 `pi-cue.json`。界面语言只改变面板文案；内置通知默认为英文，自定义模板保持原样。默认聚焦时只播放音效，离开时请求静音通知并播放音效；能否呈现仍取决于宿主报告与系统能力。

修改扩展后，关闭面板并在 Pi 执行 `/reload`，再打开 `/cue`。完整设置、旧配置兼容规则和模板示例见[配置说明](docs/configuration.md)。

## 平台与边界

| 环境 | 当前状态 |
|---|---|
| macOS | 使用旧版通知兼容接口；提交调用已有过程验证，横幅显示未验证。音效播放进程已有验证，实际听感待确认。 |
| Windows / WSL2 | 后端已实现并有受控测试，具体桌面与终端组合待实机验证。 |
| Linux 桌面 | 实现 D-Bus 通知与本地音效路径；需要现有桌面服务和工具，具体组合待实测。 |
| SSH、print / JSON / RPC、无 TTY | SSH 不调用远端桌面通道；非交互模式不发送提醒或播放声音。 |

**通知提交不等于横幅显示。** 结果未知时不重发。macOS 的现代接口替换限制、系统依赖和具体验证范围见[平台说明](docs/platforms.md)。

终端不一定报告真实窗口焦点；没有报告时按配置策略处理。标题标记目前不可用，插件不会改写标题。这里只列实际实现与验证范围，不把“代码路径存在”当作全平台支持承诺。

## 文档与开发

- [配置与模板](docs/configuration.md) · [集成协议](docs/integrations.md) · [平台细节](docs/platforms.md)
- [添加命名音效](docs/sounds.md)：agent 维护名称、PCM WAV、来源与许可，用户在面板里直接选用。
- [贡献与提交规范](CONTRIBUTING.md)：Conventional Commits 结构 + Gitmoji 语义，提供无依赖的本地校验器。

完整源码工作区可运行：

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test tests/*.test.ts
```

### 隔离开发预览

只想查看界面或调试扩展时，可在完整源码工作区运行：

```sh
npm run dev
```

该入口使用项目内独立的配置、会话和缓存，不代表日常 Pi 配置。它不复制日常 Pi 的认证文件，但会继承启动时的环境变量。没有模型配置时仍可使用 `/cue` 查看设置。

打包的扩展只保留运行代码、资源、公开使用文档和音效维护脚本；开发工具、测试、项目技能和本机配置不会随包分发。npm 包名为 `@mikuhello/pi-cue`。

## 许可证

项目代码与原创合成的 soft / bright 音效采用 [MIT License](LICENSE)。系统音效由操作系统提供，不随项目分发录音。Pi / TUI 的第三方许可见[许可记录](docs/licenses/pi-1.4.0.txt)。
