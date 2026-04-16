# vscode-copilot-api

将 VS Code `vscode.lm` 能力以 **OpenAI API 兼容接口**暴露在 `127.0.0.1:11435`，让任何支持 OpenAI 格式的客户端（Hermes、Continue、Cursor 等）直接使用 GitHub Copilot 模型，无需 API Key。

---

## 支持的 API

| 端点 | 说明 |
|---|---|
| `GET /v1/models` | 返回 `vscode.lm` 可用模型列表 |
| `POST /v1/chat/completions` | 聊天补全，支持非流式 + SSE 流式 |
| `POST /v1/chat/completions` + `tools` | Function Calling：传入 OpenAI function tool 格式，返回 `tool_calls` |

---

## 快速开始

1. 在 VS Code 中安装此扩展（确保已登录 GitHub Copilot）
2. 扩展激活后自动在 `127.0.0.1:11435` 启动服务
3. 将客户端 API base URL 设为 `http://127.0.0.1:11435/v1`，API Key 填任意字符串

### 配置文件

扩展的配置文件位于：

- **macOS**：`~/Library/Application Support/copilot-api/config.json`
- **Linux**：`~/.config/copilot-api/config.json`
- **Windows**：`%APPDATA%\copilot-api\config.json`

```json
{
  "port": 11435,
  "allowedModels": ["gpt-5.4", "claude-sonnet-4.6"]
}
```

`allowedModels` 为空数组时允许所有可用模型。

---

## 使用示例

### curl

```bash
curl http://127.0.0.1:11435/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-any" \
  -d '{
    "model": "gpt-5.4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Function Calling

```json
{
  "model": "gpt-5.4",
  "messages": [{"role": "user", "content": "查一下天气"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "获取天气",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {"type": "string"}
        }
      }
    }
  }]
}
```

响应中 `choices[0].message.tool_calls` 遵循 OpenAI 规范，`finish_reason` 为 `tool_calls`。

---

## 架构

单实例架构，请求直接由 `vscode.lm` 处理：

```
客户端
  ↓ HTTP (127.0.0.1:11435)
server.ts        Node.js HTTP 服务
  ↓
router.ts        路由分发
  ├── GET  /v1/models           → handlers/models.ts
  └── POST /v1/chat/completions → handlers/chat.ts
                                      ↓
                                 vscode.lm API
                                      ↓
                                 GitHub Copilot
```

多个 VS Code 窗口同时打开时，后续实例会自动递增端口（11436、11437…），各自独立服务。

---

## 目录结构

```
src/
  extension.ts          扩展入口，管理服务器生命周期
  server.ts             HTTP 服务器
  router.ts             路由分发
  config.ts             配置读写
  scenarios.ts          测试场景
  handlers/
    chat.ts             POST /v1/chat/completions
    models.ts           GET /v1/models
  views/
    StatusTreeProvider.ts  侧边栏状态视图
```

---

## 开发

```bash
npm install
npm run watch    # 监听编译

# VS Code 中按 F5 启动调试实例
# 调试实例默认使用环境变量 COPILOT_API_PORT 的端口，避免与已安装版本冲突
```
