# program.md — vsocde-Copilot-API

<!-- 
这是项目的唯一事实来源。
- 所有 agent 只读这个文件，不修改它
- 你需要填写：目标、约束、停止条件
- 模糊的地方留着，PM Agent 会帮你补全
-->

## 目标

一个 VS Code 插件，将 vscode.lm API（GitHub Copilot 语言模型访问能力）通过 OpenAI 兼容接口暴露为本地 HTTP 服务，使任意支持 OpenAI API 的客户端都可以直接调用 VS Code 内置的语言模型。

---

## 系统组成

- **VS Code Extension 主体**：插件激活入口，管理 HTTP 服务的启动/停止生命周期，注册命令
- **内嵌 HTTP 服务器**：监听本地端口（默认 11434 或可配置），接受 OpenAI 兼容格式的 HTTP 请求
- **API 路由层**：实现 `/v1/models`、`/v1/chat/completions` 端点
- **vscode.lm 适配层**：将 OpenAI 格式请求（messages、model、stream 等）转换为 `vscode.lm.sendChatRequest` 调用，并将响应转回 OpenAI 格式

---

## 约束（不能动的）

- 只用 TypeScript
- 利用 vscode.lm API，不引入需要外部 API key 的第三方服务
- 不做用户账号系统，纯本地服务
- HTTP 服务只监听 localhost，不对外暴露

---

## 停止条件（MVP 验收标准）

<!-- 每条必须是可以用命令验证的 -->

- [ ] 插件可安装并激活（F5 启动扩展宿主不报错）
- [ ] GET /v1/models 返回 vscode.lm 可用模型列表（JSON 格式符合 OpenAI 规范）
- [ ] POST /v1/chat/completions 能转发请求到 vscode.lm 并返回 OpenAI 格式的响应
- [ ] 支持流式响应（stream: true，Server-Sent Events 格式）
- [ ] npm run compile 无报错

---

## 技术选型（PM Agent 默认决策，可 [OVERRIDE]）

<!-- PM Agent 会在 task_000 research 后填充这里 -->

---

## 功能进化区（MVP 完成后持续追加）

<!--
使用方式：
1. 在下面追加功能想法，格式随意，可以很模糊
2. 保存文件
3. bash evolve.sh 自动检测并开始实现

状态：
- [ ] 待处理
- [~] 进行中（系统自动标记）
- [x] 已完成（系统自动标记）
-->

### 待实现功能

