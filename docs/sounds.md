# 给 agent 的音效添加规范

用户只在 Sound 中选择有名称的音效并试听。增加声音时，由 agent 准备资源、记录来源并完成验证；用户无需管理路径或编辑清单。不要为此增加音效管理平台、任意命令配置或新的渲染器。

## 唯一清单

`data/presets.json` 是命名音效的唯一权威目录，每项包含：

- `id`：小写字母开头，可用小写字母、数字和连字符，最多 48 字符。
- `file`：assets 下的单个 WAV 文件名；system 为 null。不能为绝对路径、包含目录或指向符号链接。
- `en` / `zh-CN`：实际显示名称，导入时各最多 20 个终端单元格。各语言名称经 trim、NFKC 与大小写归一后必须唯一。
- `description.en` / `description.zh-CN`：短描述，各最多 160 字符；不重复占用日常界面。
- `source` / `license`：来源与许可记录，必须非空。

ID `file` 和名称 Custom sound / 自定义音效为旧文件兼容入口保留。目录必须保留 system 与 soft.wav 后备。现有 soft / bright 是本项目脚本合成的原创波形，不含第三方录音；项目代码及这两份原创合成音效采用根目录 MIT 许可证；系统音效由操作系统提供，不随项目分发录音。

## 添加流程

1. 先确认声音来源、用途与可用许可。使用用户提供且获准使用的音频，或生成原创波形；来源与许可文本本身不代替核验。
2. 准备本地 RIFF 整数 PCM WAV：单/双声道、8/16 位、8–96 kHz、最多 20 MiB。不自动安装系统转换器。
3. 在项目根运行导入脚本，为声音给出简短、可区分的双语名称：

```sh
node scripts/add-sound.ts \
  --file /absolute/path/chime.wav \
  --id mellow \
  --name-en "Mellow" \
  --name-zh "柔和音" \
  --source "具体来源或原创生成记录" \
  --license "已核验的许可及用途范围" \
  --description-en "A gentle completion sound." \
  --description-zh "轻柔的完成提示音。"
node scripts/generate-schema.mjs
```

脚本验证 PCM、名称、元数据、目标目录与既有清单，以独占锁和新文件写入避免覆盖已有资源，再原子替换清单。失败会回滚本次新资源与临时文件；若清单被其他写入者改动则拒绝覆盖。它不会修改 cue 设置或选择刚添加的音效。

4. 在完整源码工作区执行 `node --test tests/sounds.test.ts` 和类型检查；安装扩展包仅带导入/Schema/资源维护脚本，不带测试及开发依赖。核对新 ID 同时出现在运行时校验与生成 Schema 中。若调整了 UI 或配置代码，再运行对应行为测试。
5. 在隔离 Pi 中 `/reload`，进入 Sound，验证名称可见、Enter/Space 都能选用、P 只在音效候选右栏试听，以及重载后仍选择正确资源。测试环境须与用户正在运行的 Pi 分开。

本次自动验证的完整链位于 `tests/sounds.test.ts`：在独立目录导入 Mellow，生成 Schema，用生产面板通过 Space 保存、重读配置，并确认平台播放器收到正确 assets 路径。播放器使用替身，未声称实际听感通过。

## 旧自定义文件

旧 `soundPreset=file` 和 `soundFile` 继续按原路径播放，并以友好名称呈现；路径不出现在日常流程中。不要自动删除文件或把它复制到所有项目。迁入命名目录须先明确这项维护动作、给出名称和许可记录，再按上述流程导入和显式选用。
