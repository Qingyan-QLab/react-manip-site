# 网站与评测后端 V1 对接约定（2026-11-02）

## 本轮完成与边界

本轮对齐静态网站、演示、浏览器请求格式和网站业务数据库结构。**未部署网站网关、账号登录、数据库实例、JWT 签发、回调或 HTTPS；未连接真实评测服务器。**
`index.html` 和 `submit.html` 的 `website-api` 均保留空值。页面显示 `Online evaluation is not available yet.`，不能正式提交。`?demo=1` 使用明确标识的内存样例，不等于真实评测成功或数据库已经保存。

最终链路：浏览器 → 阿里云网站网关 → 同机评测后端 `http://127.0.0.1:8090`。网站业务数据库和评测数据库都在云端；用户的电脑不承担任何服务转发。

## 一次提交保留全部资料

| 页面字段 | 浏览器发送位置 | 网站数据库 | 传给评测后端 |
| --- | --- | --- | --- |
| Team name | evaluation.team_display_name | 团队表 + 每次提交的名称快照 | 是 |
| Model / policy name | evaluation.model_id | 每次提交 | 是 |
| Model version | evaluation.model_version | 每次提交 | 是 |
| Evaluation profile | evaluation.profile_id | 每次提交、分榜依据 | 是 |
| Model HTTPS URL | evaluation.model_endpoint | 加密保存，仅服务端读取 | 是 |
| Model API key（必填） | evaluation.model_api_key | 不保存额外明文副本；通过 evaluation ID 关联评测后端的加密凭据 | 是 |
| Organization | website_metadata.organization | 每次提交快照，最多 150 字符 | 否 |
| Model category（Agent/Model） | website_metadata.submission_type | 每次提交快照 | 否 |
| Email | website_metadata.email | 私有记录，最多 254 字符 | 否 |
| Contact method | website_metadata.contact_method | phone / wechat | 否 |
| Phone / WeChat | website_metadata.contact_value | 私有记录，最多 64 字符 | 否 |

浏览器 **POST 到网站网关** `/api/v1/evaluations`：

```json
{
  "evaluation": {
    "profile_id": "house-local-16x3x15-v1",
    "team_display_name": "Example team",
    "model_id": "my-policy",
    "model_version": "v1",
    "model_endpoint": "https://model.example/evaluate",
    "model_api_key": "participant-secret"
  },
  "website_metadata": {
    "organization": "Example University",
    "submission_type": "agent",
    "email": "researcher@example.com",
    "contact_method": "wechat",
    "contact_value": "example_researcher"
  }
}
```

**这个外层包装是新网站网关的协议，不是现有评测后端的协议。** 网关保存完整业务资料，只将 `evaluation` 的六个白名单字段原样转发到评测 `/api/v1/evaluations`，不能把额外资料直接塞入评测请求。owner/sub 从已验证登录会话取得，不从表单或队名生成。

组织、联系方式和类别在网站数据库中按每次提交保存，后续资料修改不能覆盖历史快照。完整的当前用户详情可返回这些资料；公开榜单不得含邮箱、手机号、微信、owner ID、模型 URL、API key 或服务器路径。

## Team name 是唯一查询输入，不是身份凭据

- 查询栏已从 Policy name 改为 Team name；Model / policy name 仍是必填模型名称。
- 当前前端请求 `/evaluations?after=0&limit=50`，只在登录用户有权访问的记录中按队名精确匹配。规范化规则：Unicode NFKC → 去首尾空格 → 合并连续空白 → 小写。
- 后端文档没有 `team_name` 过滤参数。本轮不向评测服务虚构此参数，而是在授权记录分页中匹配。若仍有下一页，页面明确提示并提供“Search next page”，不会把当前页无匹配误称为全部不存在。
- 计划中的网站网关应从自己的数据库按稳定游标分页。以后可以实现服务端 team_name 索引查询，需同步调整浏览器契约和测试。
- `website/schema.sql` 给规范化 `teams.name_key` 添加唯一约束；仅属于固定 owner。**同名队伍不自动共享权限**。网关尚未运行，所以现在不能声称已对线上队名实行唯一注册。
- 团队创建、登录方式、邀请/恢复、改名和共享规则在网关阶段实现。不能以“知道队名”或填写手机号作为登录证明。

## 浏览器调用的网站网关

全部浏览器路径以 `/api/v1` 开头。下表明确区分已有评测接口和网站新增职责。

| 浏览器方法/路径 | 网站网关职责 | 评测后端对应 |
| --- | --- | --- |
| GET /session | 验证网站登录会话，返回 csrf_token；未登录 401 | 无，网站新增 |
| GET /profiles | 使用用户 JWT 获取已发布 profile | GET /profiles |
| POST /evaluations | 验证全部字段、保存业务资料、只转发六项评测参数 | POST /evaluations |
| GET /evaluations?after=0&limit=50 | 仅当前 owner，返回关联的记录及安全业务字段 | GET /evaluations；可结合网站本地记录 |
| GET /evaluations/{id} | 检查 owner，附带本人完整资料，隐藏凭据 | GET /evaluations/{id} |
| POST /evaluations/{id}/cancel | 校验会话/CSRF/owner，取消自己的任务 | POST /evaluations/{id}/cancel |
| GET /evaluations/{id}/tasks | 校验 owner，任务明细 | 同路径 |
| GET /evaluations/{id}/videos?after=0&limit=100 | 校验 owner，返回视频目录及过期信息 | 同路径 |
| GET/HEAD /artifacts/{id}/content | 登录保护的私有 MP4 流代理 | 同路径；携带用户 JWT |
| GET /rankings?profile_id=... | **网站自行实现**：按 profile 汇总已验证结果 | 评测后端没有此榜单接口 |

网站网关生成不超过 300 秒的 Ed25519 用户/服务 JWT；密钥与 JWT 不交给浏览器。浏览器请求使用 `credentials: include` 和网站会话 Cookie；写操作先 GET /session，再携带 `X-CSRF-Token`。网关必须实现 Secure、HttpOnly Cookie、CSRF 检查和 Origin 校验。
如果前端与 API 是不同 origin，允许的 CORS Origin 只配置 `https://qlab-ai.org`（origin 没有 `/react-manip-site/` 路径）；允许 credentials，处理 OPTIONS，不使用 `*`。前端/API 不在同一站点时还需考虑 Cookie 策略；优先使用同站点 API 子域名或同源代理。

## 响应适配口径

用户提供的文档列出了接口，但没有全部列表响应 JSON。以下是**网站网关向浏览器承诺的规范化响应**；接服务器后要用实际 OpenAPI 和样例验证映射，不能假定评测后端完全一致。

```json
{
  "evaluation_id": "opaque-id",
  "team_display_name": "Example team",
  "model_id": "my-policy",
  "model_version": "v1",
  "profile_id": "house-local-16x3x15-v1",
  "status": "COMPLETED",
  "completed_episodes": 720,
  "score": 83.25,
  "score_kind": "protocol",
  "official_score": null,
  "eligible_for_ranking": true,
  "finished_at": 1793232000,
  "videos_expires_at": 1793836800,
  "website_metadata": { "organization": "Example University", "submission_type": "agent" }
}
```

- profiles: `{ "profiles": [{ "profile_id": "..." }] }`，前端不允许输入任意 profile。
- evaluations: `{ "evaluations": [上述记录], "next_cursor": 123 或 "123" 或 null }`。next_cursor 再作为 `after` 请求，不能重复同一游标。
- 单条本人详情可在 `website_metadata` 中包含 email/contact_method/contact_value；列表和公开榜单不返回联系方式。
- tasks: `{ "tasks": [{ "task_id": "box_insertion", "status": "COMPLETED", "completed_episodes": 45, "score": 83.25 }] }`。
- videos: `{ "videos": [{ "artifact_id": "...", "task_id": "...", "phase": "exam", "episode_index": 0, "status": "READY", "expires_at": 1793836800 }], "next_cursor": null }`。
- rankings: `{ "profiles": [{"profile_id":"..."}], "profile_id":"...", "rankings":[上述可公开成绩记录] }`；网关决定有效默认 profile、排序和名次，不能回传私有字段。
- 时间数字统一为 Unix 秒；页面转换为本地显示时间。例子中的时间只说明格式，不是运行时常量。

## 状态、计分和视频

- 状态严格为 QUEUED、RUNNING、COMPLETED、INVALID、FAILED、CANCELLED。后四项为终态，不再持续轮询。
- 720 回合包含 240 个考试回合；成绩是 protocol 试运行分数，official_score=null。页面不承诺已完成真实 720 回合验收。
- 不同 profile 分榜。仅 COMPLETED 且 eligible_for_ranking=true 的 protocol 成绩可公开排名，不能用部分回合的分数上榜。
- 初步准备“同团队、同 profile 最近一次有效结果”；正式排名规则尚待确认，Demo 仅用于展示，不作规则批准。
- 任务接口取代旧 `/simulations/.../metrics`；页面不再虚构后端没有提供的 latency/recovery 指标。
- 视频只从网站 `/artifacts/{id}/content` 播放，不采用后端给出的外部 video_url，不传浏览器 Bearer token，不把 MP4 加载为整段 Blob。
- 网关必须转发 Range/If-Range、206/416/410、Content-Type/Content-Length/Content-Range/Accept-Ranges，并设置 private, no-store。不能以鉴权成功替代流式读取中的过期校验。
- 页面延迟到展开视频才加载；显示到期时间，到期停止播放；得分记录继续保留。Demo 视频是现有公开演示素材，明确与私有评测录像区分。

## 幂等、通知和数据库保存流程（网关待实现）

1. 网关验证网站会话、CSRF、字段、队名所有权。前端只保存请求指纹与幂等 ID，不保存 API key、URL、联系方式或 JWT。
2. 事务预存 PREPARED 业务记录；以 owner + Idempotency-Key 唯一、带服务端密钥的 HMAC 比较完整请求。不同内容返回 409。机构/联系方式/类别参与幂等比较。
3. 只转发 evaluation 六项和同一个 Idempotency-Key；接受后关联 evaluation_id 和 ACCEPTED 状态。网络结果不确定时记 UNCERTAIN，不生成新键强制重试，也不创建第二份业务记录。
4. API key 在请求内短暂转发后丢弃；其加密保留和到期由评测服务负责。网站端点字段用独立网站密钥加密，不回传浏览器。若以后需要网站自动重放，必须设计短期加密 outbox，不能偷偷保存明文请求。
5. 终态回调使用原始 body 验 HMAC、5 分钟时间窗、常量时间比较；先持久保存并应用事件再 2xx。重复 event_id/result_version 不重复计榜，旧版本不覆盖新版本。
6. 网关用 service JWT (`results:read`) cursor 补拉；游标与事件应用同事务提交。未能关联的事件保留待对账，不能丢弃。网页本身不访问跨用户结果流。
7. 网关/评测进程恢复后根据持久幂等记录和结果事件对账；不能把超时直接认定评测失败。

## 数据库位置和部署阶段

网站数据库新建在同一阿里云实例：

```text
/mnt/workspace/react-manip-website/
  data/db/website.sqlite3
  data/backups/
  secrets/website-private.pem
  secrets/callback.key
  secrets/encryption-keys.json
```

此目录**不在 `/data` OSS/FUSE**。数据库 schema 为 `website/schema.sql`，环境示例为 `website/.env.example`。只包含结构与配置模板，本轮未在服务器创建数据库。
现有文档说明 `/mnt/workspace` 为容器 overlay，尚未证明实例替换后的持久性。可以先联调；生产前必须检查挂载和实例生命周期，并使用持久块存储或云数据库。**新建目录不等于获得持久性。** OSS 可保存 SQLite online backup 生成的一致性备份，不可把正在使用的 WAL 数据库放在 OSS 挂载上。

后续创建目录时指定真实服务账户、数据权限 0700、密钥文件 0600；不要把 root 可写网页目录同时作为私有数据目录。不要执行 init --development 初始化生产身份，也不要覆盖现有评测库、已发布 profile 或密钥。

## 本轮文件与验证

部署静态网站时同时更新 index.html、submit.html、styles.css、demo-api.js、evaluation-api.js、leaderboard.js、simulation-details.js；加载版本已统一更新。
website/、本约定和 tests/ 放入源码仓库；**实际数据库、密钥、.env、node_modules、.cache 不上传**。
运行方法见 tests/README.md。浏览器模拟测试不代替真实服务联调；接通后的验收仍包括 A/B 用户隔离、同键重试、私有 Range/过期、回调重试及 cursor 对账、真实模型全量评测。