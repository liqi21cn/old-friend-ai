# External Login API — 外部系统登录接口文档

> 为其他系统提供账号密码校验能力，校验通过后返回与本系统内部等价的 JWT Token。
> 外部系统可用该 Token 调用本系统其他需要登录的 API。

---

## 基本信息

| 项 | 值 |
|---|---|
| 接口路径 | `POST /api/external/login` |
| 协议 | HTTP / HTTPS |
| 请求格式 | `application/json` |
| 响应格式 | `application/json` |
| 鉴权方式 | API Key（请求头） |
| 字符编码 | UTF-8 |

**环境地址示例**：

- 本地调试：`http://localhost:3001/api/external/login`
- 生产环境：`https://<你的域名>/api/external/login`

---

## 鉴权

调用前必须在请求头中携带由本系统颁发的 API Key。两种请求头任选其一：

```http
Authorization: Bearer <API_KEY>
```

```http
X-API-Key: <API_KEY>
```

两者等价。若两者同时存在，以 `Authorization` 为准。

> API Key 由本系统管理员通过 `EXTERNAL_API_KEYS` 环境变量配置，请向管理员索取。**Key 视为机密，勿写入前端代码或公开仓库**。

---

## 请求参数

### Headers

| 名称 | 必填 | 说明 |
|---|---|---|
| `Content-Type` | 是 | 固定为 `application/json` |
| `Authorization` 或 `X-API-Key` | 是 | API Key，格式见上文 |

### Body (JSON)

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | 是 | 用户名或邮箱（两者任一匹配即可） |
| `password` | string | 是 | 明文密码。服务端使用 bcrypt 校验 |

#### 请求体示例

```json
{
  "username": "zsadmin",
  "password": "hunter2"
}
```

---

## 响应

### 成功（HTTP 200）

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
  "user": {
    "id": 1,
    "username": "zsadmin",
    "name": "张三",
    "phone": "13800000000",
    "email": "zs@example.com",
    "is_admin": true,
    "is_active": true,
    "user_level": "pro"
  }
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `token` | string | JWT Token。后续调用本系统其他接口时放在 `Authorization: Bearer <token>` 头里 |
| `user.id` | number | 用户 ID |
| `user.username` | string | 用户名 |
| `user.name` | string | 姓名，可能为空字符串 |
| `user.phone` | string | 手机号，可能为空字符串 |
| `user.email` | string | 邮箱 |
| `user.is_admin` | boolean | 是否为系统管理员 |
| `user.is_active` | boolean | 账号是否启用 |
| `user.user_level` | string | 用户等级：`free` / `pro` / ... |

> **Token 有效期**：非常长（当前设置为 100 年）。因此无需主动刷新，但若用户被踢下线（见 [会话互斥](#会话互斥) 一节），旧 Token 会失效。

### 失败

所有失败响应的结构：

```json
{ "error": "<错误描述>" }
```

#### 错误码矩阵

| HTTP 状态 | `error` 文案 | 触发条件 |
|---|---|---|
| `400` | `Username and password are required` | 请求体缺少 `username` 或 `password` |
| `401` | `Missing API key` | 请求头未携带 API Key |
| `401` | `Invalid API key` | API Key 不在白名单 |
| `401` | `Invalid credentials` | 用户不存在，或密码错误 |
| `403` | `Account is disabled` | 用户账号被禁用（`is_active = false`） |
| `500` | `Login failed` | 服务器内部异常 |
| `503` | `External API not configured` | 服务端未配置 `EXTERNAL_API_KEYS`，接口整体关闭 |

> **安全设计**：用户不存在和密码错误返回**同一错误文案**（`Invalid credentials`），防止通过错误差异枚举用户。

---

## 调用示例

### curl

```bash
curl -X POST https://<你的域名>/api/external/login \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 43adec2e2a0a0d776782e6a96dd49bcb661b16bf93195f4db9bcb2d49b0db910" \
  -d '{"username":"zsadmin","password":"hunter2"}'
```

### Node.js (fetch)

```javascript
const res = await fetch('https://<你的域名>/api/external/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.PARTNER_API_KEY}`,
  },
  body: JSON.stringify({
    username: 'zsadmin',
    password: 'hunter2',
  }),
});

if (!res.ok) {
  const { error } = await res.json();
  throw new Error(`Login failed: ${error}`);
}
const { token, user } = await res.json();
// 保存 token，用于后续 API 调用
```

### Python (requests)

```python
import os
import requests

resp = requests.post(
    'https://<你的域名>/api/external/login',
    headers={
        'Content-Type': 'application/json',
        'X-API-Key': os.environ['PARTNER_API_KEY'],
    },
    json={
        'username': 'zsadmin',
        'password': 'hunter2',
    },
    timeout=10,
)
resp.raise_for_status()
data = resp.json()
token = data['token']
user = data['user']
```

### Java (OkHttp)

```java
OkHttpClient client = new OkHttpClient();
MediaType JSON = MediaType.parse("application/json");

String body = "{\"username\":\"zsadmin\",\"password\":\"hunter2\"}";
Request req = new Request.Builder()
    .url("https://<你的域名>/api/external/login")
    .header("X-API-Key", System.getenv("PARTNER_API_KEY"))
    .post(RequestBody.create(body, JSON))
    .build();

try (Response resp = client.newCall(req).execute()) {
    if (!resp.isSuccessful()) {
        throw new IOException("Login failed: HTTP " + resp.code());
    }
    String json = resp.body().string();
    // 解析 json.token / json.user
}
```

---

## 使用返回的 Token

拿到 `token` 后，调用本系统其他受保护的接口时把它放进请求头：

```http
Authorization: Bearer <token>
```

示例（获取当前用户信息）：

```bash
curl https://<你的域名>/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
```

---

## 会话互斥

⚠️ **本系统实施单活跃会话策略**：同一用户只能保持一个活跃 Token。

- 每次调用 `/api/external/login` 都会**重新生成**该用户的 `session_token`
- 之前的 Token（不论是通过 Web UI 还是其他 API Key 登录获得）**立即失效**
- 如果外部系统频繁调用本接口，会把用户从 Web 界面踢下线

**建议使用模式**：

1. 在用户触发"登录"动作时调用一次 `/api/external/login`，缓存返回的 `token`
2. 后续使用缓存的 `token` 调用其他接口
3. 收到 `401 Session expired` / `401 Not authenticated` 时才重新登录

---

## 速率与限制

- 单次请求体最大 `50MB`（与本系统其他接口一致，实际登录场景极小）
- 没有显式速率限制，但建议：
  - 外部系统自行合并并发
  - 同一用户短时间内避免重复调用（避免互相踢下线）

---

## 日志与排查

服务端会记录每次登录尝试，日志前缀 `[ExternalAPI]`。常见条目：

| 日志 | 含义 |
|---|---|
| `[ExternalAPI] login ok caller=<name> userId=<id> username=<name>` | 成功 |
| `[ExternalAPI] login denied (no such user) caller=<name> username=<name>` | 用户不存在 |
| `[ExternalAPI] login denied (bad password) caller=<name> userId=<id>` | 密码错误 |
| `[ExternalAPI] login denied (disabled) caller=<name> userId=<id>` | 账号禁用 |
| `[ExternalAPI] No EXTERNAL_API_KEYS configured — all external requests are denied` | 服务端未配置 Key |

`caller=<name>` 即配置 `EXTERNAL_API_KEYS` 时 `name:key` 格式里的 name，便于识别调用方。未配置 name 时显示 `anonymous`。

排查接口问题时可在服务器上：

```bash
docker compose logs --tail 50 backend | grep ExternalAPI
```

---

## 常见问题

**Q1：返回 `503 External API not configured`？**
A：服务端 `.env` / `.env.production` 中未配置 `EXTERNAL_API_KEYS`，或值为空。联系管理员配置并重启 backend。

**Q2：用户被锁在门外，登录反复失败？**
A：检查响应 `error`：
- `Invalid credentials` → 密码错误或用户不存在
- `Account is disabled` → 后台将账号重新启用
- `Invalid API key` → API Key 过期或被吊销，找管理员重新领取

**Q3：Token 一直用不失效，需要做什么？**
A：当前设计下 Token 有效期极长（100 年）。除非该用户被踢下线（会话互斥），否则无需处理过期。如果需要短效 Token，建议升级到 OAuth2 / 刷新 Token 模式（本接口暂不支持）。

**Q4：能否用返回的 Token 调用管理员接口？**
A：由返回的 `user.is_admin` 决定。若为 `true`，Token 可访问管理员接口；否则被拒绝。这一判断在每个管理员接口内部独立进行。

**Q5：用户名支持邮箱吗？**
A：支持。`username` 字段同时匹配 `users.username` 和 `users.email`，任一命中即可。

---

## 版本记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-04-14 | 1.0 | 首次发布，支持 API Key 鉴权 + 账号密码登录，返回 JWT Token |
