# AI 客户端品牌资产说明

首次获取日期：2026-08-29；本次补充日期：2026-09-09。

这些标志仅用于在 Bandi 中识别第三方客户端，不表示相关权利方赞助、认可或与 Bandi 建立合作关系。软件源码许可证不自动授予商标权；请同时遵守各品牌的商标与品牌使用规范。

| 本地文件 | 客户端 | 官方来源 | SHA-256 | 说明 |
|---|---|---|---|---|
| `claude-code.svg` | Claude Code | [Anthropic Press Kit](https://www.anthropic.com/press-kit) | `d8a00c51cd1a31e85f8ca264f89617894d4c2ed9c72e71ccdc00f84bcca7a6a3` | 官方 Claude Code 单色标志；保持比例，不重绘。 |
| `claude.svg` | Claude Code / Claude Desktop | [Anthropic Press Kit](https://www.anthropic.com/press-kit) | `059e22f525d67c6258c4f64514f0b0e717c914df8a706936d0299d5e6b8082d9` | 官方 Claude 圆角图标；Claude Code 的独立资源是横向字标，紧凑界面复用该母品牌图标。 |
| `chatgpt.png` | ChatGPT（稳定工具 ID：`codex`） | 本机官方 ChatGPT 应用 `Contents/Resources/icon-chatgpt.png` / [OpenAI 品牌规范](https://openai.com/brand/) | `89b50d3e4dace382f12e35e9b6f9e7642d4fbcccae6c578aa9c820e5a1b68141` | 官方应用图标裁除透明留白并缩放为 256×256；用于已合并 Codex 能力的 ChatGPT 桌面应用，OpenAI 商标权另行保留。 |
| `gemini-cli.png` | Gemini CLI | [Gemini CLI 官方仓库](https://github.com/google-gemini/gemini-cli/blob/main/packages/vscode-ide-companion/assets/icon.png) | `351e9f5b1bf863d738cd7be4ed040a625a1419450ae7fc490143e4042b7c2438` | 官方 VS Code companion 1645×1645 应用图标；仓库为 Apache-2.0，品牌使用受 [Google Brand Resource Center](https://about.google/brand-resource-center/) 约束。 |
| `grok-build.webp` | Grok Build | [Lobe Icons 固定版本](https://github.com/lobehub/lobe-icons/blob/a94750e3f5f8fc33757b839d85030e742284e43a/packages/static-avatar/avatars/grok.webp) | `01d41ad86a3a6328bea920f5f058f06e2aac6f9515fae8f83856cbe404a08cb5` | 1280×1280 方形竞品资产，Lobe Icons 仓库为 MIT；Grok 商标权归 xAI，未暗示官方背书。 |
| `opencode.svg` | OpenCode | [OpenCode 官方仓库](https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/assets/favicon/favicon-v3.svg) | `e29bbe33380ad1c1ada9134b52f229d30e9776d60481512c9d81f2bb6f37def9` | 官方方形应用图标；仓库代码为 MIT，商标权另行保留。 |
| `openclaw.svg` | OpenClaw | [OpenClaw 官方仓库](https://github.com/openclaw/openclaw/blob/main/ui/public/favicon.svg) | `3351f513d5a60049730dce4d1e4a789820a11f3729bc372c58fecfe469e86419` | 官方动态 favicon；已禁用动效以遵守 reduced-motion 和桌面工具的克制风格。仓库为 MIT，商标权另行保留。 |
| `hermes.png` | Hermes | [Hermes Agent 官方仓库](https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/assets/icon.png) | `b979f0349eaa05a946f6d040fcdad65ec67a2fa759042e7c6b8cab2aaa48e912` | 官方桌面应用图标裁除透明留白并缩放为 256×256；仓库为 MIT，商标权另行保留。 |
| `pi.svg` | Pi | [Pi Press Kit](https://pi.dev/press-kit) / [官方网站仓库](https://github.com/earendil-works/pi-website/blob/main/src/favicon.svg) | `a5624bc3b8cac94de75f6f13701eca2ad3ef67bbeba286c4af3f398806f0858a` | 官方方形徽标；网站仓库为 MIT，商标权另行保留。 |

## 加载失败回退

九个客户端正常状态均使用本地图片资产。资源加载或解码失败时，公共 `AiClientIcon` 才显示稳定 `shortName` 文字徽标；该异常兜底不改变后端数据协议。
