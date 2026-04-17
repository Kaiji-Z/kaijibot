---
summary: "Model providers (LLMs) supported by KaijiBot"
read_when:
  - You want to choose a model provider
  - You need a quick overview of supported LLM backends
title: "Provider Directory"
---

# Model Providers

KaijiBot 支持 40+ 个国内外 LLM 提供商，开箱即用。选择一个提供商，完成认证，然后设置默认模型为 `provider/model` 即可。

> 💡 **KaijiBot 默认使用 Z.AI (智谱 GLM) 作为主要 LLM 提供商。** 国内用户推荐：Z.AI、DeepSeek、通义千问、Kimi。所有提供商均通过插件系统自动发现，无需手动安装。

Looking for chat channel docs? See [Channels](/channels).

## Quick start

1. Authenticate with the provider (usually via `kaijibot onboard`).
2. Set the default model:

```json5
{
  agents: { defaults: { model: { primary: "zai/glm-5-turbo" } } },
}
```

## 🇨🇳 国内提供商（推荐）

| 提供商 | 文档 | 环境变量 | 特点 |
|--------|------|---------|------|
| **Z.AI 智谱** | [/providers/zai](/providers/zai) | `ZAI_API_KEY` | 默认提供商，GLM-5-turbo，国内访问最快 |
| **DeepSeek** | [/providers/deepseek](/providers/deepseek) | `DEEPSEEK_API_KEY` | V3/R1 模型，性价比极高，代码能力强 |
| **通义千问** | [/providers/qwen](/providers/qwen) | `DASHSCOPE_API_KEY` | 阿里云，中文能力强，支持视频生成 |
| **Kimi (月之暗面)** | [/providers/moonshot](/providers/moonshot) | `MOONSHOT_API_KEY` | 长上下文 200K，适合长文档 |
| **MiniMax** | [/providers/minimax](/providers/minimax) | — | 语音+图像+视频+搜索，多模态 |
| **百度千帆** | [/providers/qianfan](/providers/qianfan) | — | 文心一言 |
| **阶跃星辰** | [/providers/stepfun](/providers/stepfun) | — | Step 模型 |
| **火山引擎** | [/providers/volcengine](/providers/volcengine) | — | 字节豆包 |
| **小米** | [/providers/xiaomi](/providers/xiaomi) | — | 小米大模型 |
| **Alibaba Model Studio** | [/providers/alibaba](/providers/alibaba) | — | 阿里视频生成 |

## 🌍 国际提供商

| 提供商 | 文档 | 环境变量 | 特点 |
|--------|------|---------|------|
| **Anthropic (Claude)** | [/providers/anthropic](/providers/anthropic) | `ANTHROPIC_API_KEY` | Claude 系列 |
| **Google (Gemini)** | [/providers/google](/providers/google) | `GOOGLE_API_KEY` | Gemini 系列，多模态 |
| **xAI (Grok)** | [/providers/xai](/providers/xai) | `XAI_API_KEY` | Grok + X Search |
| **Mistral** | [/providers/mistral](/providers/mistral) | `MISTRAL_API_KEY` | Mistral 系列 |
| **Perplexity** | [/providers/perplexity-provider](/providers/perplexity-provider) | — | 搜索增强 |
| **Groq** | [/providers/groq](/providers/groq) | `GROQ_API_KEY` | LPU 超快推理 |
| **NVIDIA** | [/providers/nvidia](/providers/nvidia) | — | NIM 推理服务 |
| **Hugging Face** | [/providers/huggingface](/providers/huggingface) | — | 开源模型托管 |
| **OpenAI** | [/providers/openai](/providers/openai) | `OPENAI_API_KEY` | GPT 系列 |

## 🔄 聚合/网关

| 提供商 | 文档 | 特点 |
|--------|------|------|
| **OpenRouter** | [/providers/openrouter](/providers/openrouter) | 一个 Key 接通 100+ 模型 |
| **LiteLLM** | [/providers/litellm](/providers/litellm) | 统一代理，100+ 模型 |
| **Together AI** | [/providers/together](/providers/together) | 开源模型托管 |
| **Fireworks** | [/providers/fireworks](/providers/fireworks) | 开源模型推理 |
| **Cloudflare AI Gateway** | [/providers/cloudflare-ai-gateway](/providers/cloudflare-ai-gateway) | AI 网关代理 |
| **Vercel AI Gateway** | [/providers/vercel-ai-gateway](/providers/vercel-ai-gateway) | AI 网关代理 |
| **GitHub Copilot** | [/providers/github-copilot](/providers/github-copilot) | Copilot 代理 |
| **Microsoft** | [/providers/models](/providers/models) | Azure / MS Foundry |
| **Anthropic Vertex** | [/providers/models](/providers/models) | GCP 上的 Claude |

## 🖥️ 自部署

| 提供商 | 文档 | 特点 |
|--------|------|------|
| **Ollama** | [/providers/ollama](/providers/ollama) | 本地模型，零成本 |
| **LM Studio** | — | 本地模型 GUI |
| **SGLang** | [/providers/sglang](/providers/sglang) | 自部署推理框架 |
| **vLLM** | [/providers/vllm](/providers/vllm) | 自部署推理框架 |

## 🛠️ 开发工具

- [Arcee AI](/providers/arcee) · [Chutes](/providers/chutes) · [Venice](/providers/venice) · [Vydra](/providers/vydra)
- [Kilocode](/providers/kilocode) · [OpenCode](/providers/opencode) · [OpenCode Go](/providers/opencode-go) · [Open-Prose](/concepts/features)
- [Runway](/providers/runway) (视频生成) · [ComfyUI](/providers/comfy) · [fal](/providers/fal) · [Synthetic](/providers/synthetic)
- [BytePlus](/concepts/model-providers#byteplus-international) · [Kimi Coding](/providers/moonshot)

## Shared overview pages

- [Additional bundled variants](/providers/models#additional-bundled-provider-variants) - Anthropic Vertex, Copilot Proxy, and Gemini CLI OAuth
- [Image Generation](/tools/image-generation) - Shared `image_generate` tool, provider selection, and failover
- [Music Generation](/tools/music-generation) - Shared `music_generate` tool, provider selection, and failover
- [Video Generation](/tools/video-generation) - Shared `video_generate` tool, provider selection, and failover

## Transcription providers

- [Deepgram (audio transcription)](/providers/deepgram)

## Community tools

- [Claude Max API Proxy](/providers/claude-max-api-proxy) - Community proxy for Claude subscription credentials (verify Anthropic policy/terms before use)

For the full provider catalog (xAI, Groq, Mistral, etc.) and advanced configuration,
see [Model providers](/concepts/model-providers).
