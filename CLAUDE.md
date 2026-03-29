# vsocde-Copilot-API

## 一句话介绍

一个 vscode 插件，将 `vscode.lm` 能力以 OpenAI API 兼容接口暴露在 `127.0.0.1:11435`。

## 已支持的 API 能力

| 端点 | 说明 |
|---|---|
| `GET /v1/models` | 返回 vscode.lm 可用模型列表 |
| `POST /v1/chat/completions` | 聊天补全，支持非流式 + SSE 流式 |
| `POST /v1/chat/completions` + `tools` | **Function Calling**：传入 OpenAI function tool 格式，返回 `tool_calls` |

### Function Calling 请求示例

```json
{
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "..." }],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "my_tool",
        "description": "...",
        "parameters": { "type": "object", "properties": {} }
      }
    }
  ]
}
```

响应包含 `choices[0].message.tool_calls`（finish_reason 为 `tool_calls`），格式符合 OpenAI 规范。

## 启动

```bash
# MVP 阶段（首次运行）
bash tick.sh

# 进化阶段（MVP 完成后）
bash evolve.sh
```

## 你只需要做的事

1. 编辑 `.agent/program.md` — 写目标和约束
2. 运行 `bash tick.sh` — 系统自动完成 MVP
3. 追加功能 — 在 `program.md` 末尾加 `- [ ] 你的想法`
4. 运行 `bash evolve.sh` — 系统自动实现新功能

## 需要你介入的唯一情况

```bash
cat .agent/inbox/needs-you.md   # 查看问题
# 处理完后
rm .agent/inbox/needs-you.md
bash tick.sh  # 或 evolve.sh
```

## 查看进度

```bash
cat .agent/tasks.json | python3 -m json.tool   # 任务状态
cat .agent/decisions.md                         # PM 的决策
ls .agent/experiments/                          # 迭代历史
ls .agent/knowledge/                            # 知识积累
```

## 目录结构

```
.agent/
  program.md       唯一需求基准（你来写）
  tasks.json       任务队列（系统维护）
  state.json       全局状态（系统维护）
  decisions.md     PM 决策日志
  knowledge/       research 知识库
  experiments/     迭代历史
  inbox/           需要你介入时才有文件

.claude/
  pm-agent.md      PM Agent prompt
  coder-agent.md   Coder Agent prompt
  validator-agent.md
  research-agent.md
  evolution-agent.md

tick.sh            MVP 阶段调度器
evolve.sh          进化阶段调度器
```
