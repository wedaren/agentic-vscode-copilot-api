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
- **内嵌 HTTP 服务器**：监听本地端口（默认 11435，可在 VS Code 设置中修改），接受 OpenAI 兼容格式的 HTTP 请求
- **API 路由层**：实现 `/v1/models`、`/v1/chat/completions` 端点
- **vscode.lm 适配层**：将 OpenAI 格式请求（messages、model、stream 等）转换为 `vscode.lm.selectChatModels()` + `model.sendRequest()` 调用（VS Code 1.90+ 新版 API），并将响应转回 OpenAI 格式

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
- [ ] 支持流式响应（stream: true，SSE 格式：每块 `data: {...}\n\n`，结束发 `data: [DONE]\n\n`）
- [ ] Copilot 未授权 / 未登录时返回 HTTP 401 + OpenAI 格式 error body，服务不崩溃
- [ ] HTTP 响应包含 CORS 头（`Access-Control-Allow-Origin: *`），浏览器客户端可正常调用
- [ ] npm run compile 无报错

---

## 技术选型（PM Agent 默认决策，可 [OVERRIDE]）

- **HTTP 服务器**：Node.js 内置 `http` 模块，无需引入 Express 等外部依赖，减小插件体积
- **默认端口**：`11435`（避免与 Ollama 默认端口 11434 冲突），可通过 `copilotApi.port` 配置项修改
- **模型名称策略**：直接透传 `vscode.lm.selectChatModels()` 返回的原始模型 ID（如 `copilot-gpt-4o`），客户端使用 GET /v1/models 获取后填入请求
- **流式响应**：使用 `vscode.LanguageModelChatResponse` 的 `stream` 异步迭代器，逐 token 写入 SSE
- **错误处理**：捕获 `vscode.LanguageModelError`，映射为对应 HTTP 状态码（401 未授权、429 限流、500 其他）
- **CORS**：所有响应添加 `Access-Control-Allow-Origin: *` 等跨域头，OPTIONS 预检请求直接返回 204

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
- [x] 希望有个 vscode treeview 视图，点击"播放"icon 执行，视图下面一系列模拟场景执行，方便用户理解服务状态
- [x] 提供的接口服务希望能稳定，能解决多个客户同时请求的场景
- [x] 用户可能同时打开多个 workspace，都有该插件，会不会有问题
- [x] 用户打开多个多个 workspace，都有该插件，确保只有一个端口11435路由到不同实例
- [x] vscode engine 升级到最新

