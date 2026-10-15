# 安全与隐私

## 这是一个纯本地应用

本项目的交付形态是**单文件静态网页**：`index.html` + `roster.js`。
它没有后端、没有服务端 API、没有账号体系、不上传任何数据。可以把它当成一个本地小工具。

### 数据在哪里

| 数据 | 位置 | 是否会离开你的设备 |
|---|---|---|
| 队伍配置、预设库、收藏、语言偏好 | 浏览器 `localStorage` | ❌ 不会 |
| `roster.js` 图鉴数据 | 与 `index.html` 同目录的本地文件 | ❌ 不会 |
| 角色头像 | 第三方 CDN 的**外链图片** | ⚠️ 加载图片时，对方 CDN 会看到你的 IP 与浏览器信息 |

也就是说：**你输入的队伍和自建角色不会被发送到任何服务器**。
唯一的对外请求是加载角色头像图片（`https://cdn.dokkan.fyi/...`），
如果你在意，可以断网使用 —— 除头像外的功能完全正常。

### 不会做的事

- ❌ 不加载任何第三方 JS / 统计脚本 / 广告 / 追踪像素
- ❌ 不使用 `fetch` / `XMLHttpRequest` 向任何服务器上传数据
- ❌ 不读取除 `roster.js` 之外的任何本地文件
- ❌ 不申请任何浏览器权限（无摄像头、麦克风、地理位置、通知）
- ❌ 不存储任何凭据或令牌

### 页面里的网络请求清单

唯一会发起的请求：

```
GET https://cdn.dokkan.fyi/assets/en/character/thumb/card_<id>_thumb/...png   ← 角色头像
```

图片加载失败会自动隐藏（`onerror` 降级），不影响功能。

---

## 数据安全建议

导出功能生成的 JSON 是**明文**的，只包含你选的队伍与自建角色信息，不含敏感数据。
但如果你用「导入预设库」粘贴来路不明的 JSON：

- 导入只解析数据字段（名称、属性、标签等），**不会执行其中的任何代码**
- 仍然建议导入前看一眼内容，避免超长字符串导致的界面异常

**定期用「导出预设库」备份**是个好习惯 —— 清理浏览器数据会一并清掉 `localStorage`。

---

## 报告安全问题

如果你发现了**安全问题**（例如可被利用来执行任意脚本的输入处理、XSS、原型污染、
导入 JSON 导致的任意代码执行等），请**不要公开提 Issue**。

请通过以下方式私下联系：

1. 使用 GitHub 的 [Private vulnerability reporting](https://docs.github.com/zh/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
   （仓库 **Security** 标签页 → **Report a vulnerability**）
2. 或通过仓库维护者 GitHub 主页公开的邮箱联系

请在报告中包含：影响范围、复现步骤、以及可行的修复建议（如已知）。

**我会在 48 小时内确认收到，并在修复后于 CHANGELOG 中致谢（如你愿意署名）。**

---

## 支持范围

| 版本 | 是否接受安全更新 |
|---|---|
| 最新发布版本 | ✅ |
| 更早版本 | ❌（请先升级） |

本项目为个人维护的非商业粉丝工具，不承诺 SLA，但会尽力及时响应。
