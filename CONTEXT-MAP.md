# Context Map

## Contexts

- **Gateway(网关)** — 托管/连接 CLIProxyAPI 实例:进程生命周期、账号池、上游/下游 Key、网关用量。代码:`crates/cliproxy`(规划)、`crates/api/src/routes/gateway.rs`(规划)、desktop 网关页(规划)
- **Inference(推理供应商)** — 供应商库存与 agent 原生配置写入。代码:`crates/inference`
- **Usage(用量)** — ccusage 一次性采集与展示。代码:`crates/usage`

## Relationships

- **Gateway → Inference**:每个实例同步为库存中的一个 `InferenceProvider` 条目(实例创建/改地址 → upsert,删除 → 移除并提示解绑);接线/回退全部复用 Inference 的绑定机制(天然 per-agent),Gateway 不直接写任何 agent 配置文件,也不设「使用中实例」之类的全局编排——CLIProxyAPI 自身没有多实例编排概念,aghub 不替它发明。
- **Gateway → Usage**:网关经 management API `/api-key-usage` 提供第二个用量数据源;与 ccusage 数据**不合并**(走网关的请求两侧都会记账,相加必然重复计数),分开标注口径。

## Language

**网关(Gateway)**:由 aghub 管理的 CLIProxyAPI 服务。
_Avoid_:代理、Proxy(与 HTTP proxy 设置混淆)、路由器

**实例(Instance)**:一个具体的 CLIProxyAPI 服务连接,两种来源——**托管实例**(aghub 下载二进制并管理进程,本机)与**外部实例**(用户提供地址 + management key,aghub 只当客户端)。
_Avoid_:服务器、节点

**上游账号(Upstream Account)**:实例 auth-dir 中的一份 OAuth 凭据文件(某个订阅账号)。
_Avoid_:credential(Inference 域已占用)

**上游 Key(Upstream Key)**:写进实例配置的第三方 API key,含 `openai-compatibility` 中转站条目。
_Avoid_:供应商 key

**网关 Key(Gateway Key)**:实例 `api-keys` 列表中的条目,coding agent 访问网关的凭证。
_Avoid_:API key(裸用有歧义)

**接线(Wiring)**:把某个 agent 的推理端点指向某个实例,实现为 Inference 域的一次绑定切换。
_Avoid_:切换(cc-switch 语汇,语义不同)

## Decisions

- 2026-07-17:v1 同时支持**托管实例**与**外部实例**(用户拍板,否决了「v1 只托管」的收窄方案)。client 层统一抽象为「地址 + management key」。详见 `docs/adr/0001`。
- 2026-07-17:接线目标遵循 CLIProxyAPI 原生模型——per-agent 各自绑定实例,无网关级编排(用户拍板,否决了「单一使用中实例」方案)。详见 `docs/adr/0002`。
