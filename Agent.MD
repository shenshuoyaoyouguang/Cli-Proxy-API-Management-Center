# Agent Notes

- Usage token 统计不要盲信 `usage.total_tokens` / `api.total_tokens` / `model.total_tokens`。若对应 detail 中存在可识别 token evidence，应优先以 detail-derived truth 作为 canonical 值，哪怕真值是 `0`。
- 当 localStorage 退化为 aggregate-only lite cache 时，time-range 过滤不能把整份 snapshot 直接清零；没有 details 时应保留 aggregate summary，等待下次成功拉取再恢复明细类指标。
- persisted store 和 auto-persist 都依赖相同的 trim/rehydrate 语义；后续若修改 usage cache 行为，应同时检查 `src/utils/usage/cacheSnapshot.ts`、`src/stores/useUsageStatsStore.ts` 和 `src/services/autoPersist/AutoPersistService.ts`。
- 当前 SSE `usage:delta` detail payload 不包含 endpoint，前端绝不能把 `detail.source` 或其他凭证标识写进 `usage.apis` 充当路由键；增量明细只能先追加到 `usageDetails`，endpoint 级修正必须等待 full snapshot。
- `src/services/sse/UsageSSEService.ts` 中，统计页 SSE 首次连接失败不能直接视为登录失效。旧版后端、未开启 SSE、反向代理拦截等都会导致 stream 首次 `CLOSED`；此时必须降级为 polling，而不是派发全局 `unauthorized` 登出事件。
- `src/pages/LoginPage.tsx` 的恢复连接流程里，`restoreSession()` 之后不能继续使用首屏渲染时捕获的 `storedBase` / `storedRememberPassword`。要从 `useAuthStore.getState()` 读取最新值，否则“记住连接地址”会回填成错误的默认地址。
- 本机个人级 Codex `PreToolUse` hook 会拦截 `git commit` Lore 格式校验。实际生效链路为：`C:\Users\76578\.codex\hooks.json` -> `codex-native-hook.js` -> `codex-native-pre-post.js`。提交信息必须使用 inline `-m`，并且必须包含**精确** trailer：`Co-authored-by: OmX <omx@oh-my-codex.dev>`；大小写、邮箱和整行文本不匹配都会被拒绝。
- 本机启用了个人级 Codex `PreToolUse` hook：`C:\Users\76578\.codex\hooks.json` -> `codex-native-hook.js` -> `codex-native-pre-post.js`。`git commit` 会被 Lore guard 拦截，提交信息必须使用 inline `-m`，且必须包含**精确** trailer：`Co-authored-by: OmX <omx@oh-my-codex.dev>`。大小写、邮箱和整行文本都要完全匹配，否则会被 hook 拒绝。
