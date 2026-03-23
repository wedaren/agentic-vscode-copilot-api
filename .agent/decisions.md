# vsocde-Copilot-API — 技术决策日志

格式：`[task_id][时间] 决策：xxx | 原因：xxx | research 依据：knowledge/xxx.md`
如有异议：在行尾加 `[OVERRIDE] 你的意见`

---

<!-- PM Agent 从这里开始追加 -->

[task_000][2026-03-24] 决策：HTTP 库选型 → Node.js 内置 `http` 模块
原因：无需外部依赖，Extension Host 是 Node.js 环境可直接使用；减小插件体积；避免引入 express 的依赖链漏洞风险。
research 依据：knowledge/vscode_ext_http_server.md
---

[task_000][2026-03-24] 决策：默认端口 → `11435`，可通过 `copilotApi.port` 配置项修改
原因：避免与 Ollama 默认端口 11434 冲突；保持与 program.md 技术选型一致。
research 依据：knowledge/vscode_ext_scaffold.md
---

[task_000][2026-03-24] 决策：模型 ID 映射方案 → 直接透传 vscode.lm 原始 model ID
原因：`vscode.lm.selectChatModels()` 返回的 `id` 字段（如 `copilot-gpt-4o`）已足够唯一，客户端通过 `GET /v1/models` 获取后填入请求即可，不需要额外映射层。
research 依据：knowledge/vscode_lm_api.md
---

[task_000][2026-03-24] 决策：流式响应实现 → `response.text`（AsyncIterable<string>）+ SSE 格式写入
原因：`LanguageModelChatResponse.text` 是按 token 流式返回的 `AsyncIterable<string>`，用 `for await` 逐片段写入 `res.write('data: {...}\n\n')` 即可实现 SSE 流式响应。
research 依据：knowledge/vscode_lm_api.md, knowledge/openai_api_spec.md
---

[task_000][2026-03-24] 决策：错误处理映射 → 捕获 LanguageModelError，映射到 OpenAI 错误格式
原因：`LanguageModelError.NoPermissions` → HTTP 401，`LanguageModelError.Blocked` → HTTP 403，`LanguageModelError.NotFound` → HTTP 404，其他 → HTTP 500。统一返回 OpenAI 兼容错误 JSON：`{"error":{"message":"...","type":"...","code":"..."}}`。
research 依据：knowledge/vscode_lm_api.md, knowledge/openai_api_spec.md
---

[task_000][2026-03-24] 决策：CORS 策略 → 所有响应携带 `Access-Control-Allow-Origin: *`，OPTIONS 预检请求返回 204
原因：允许浏览器客户端（如 Open WebUI、SillyTavern）直接调用；纯本地服务，允许 * 无安全风险。
research 依据：knowledge/vscode_ext_http_server.md
---

[task_000][2026-03-24] 决策：activationEvent → `onStartupFinished`
原因：让 HTTP 服务器在 VS Code 启动完成后自动运行，无需用户手动触发命令。
research 依据：knowledge/vscode_ext_scaffold.md
---

[task_000][2026-03-24] 决策：TypeScript 配置 → target ES2020, strict: true, module: commonjs
原因：Extension Host 基于 Node.js 16+，ES2020 支持所有需要的特性（async/await, for-await-of）；strict 模式在编译时发现类型错误。
research 依据：knowledge/vscode_ext_scaffold.md
---
