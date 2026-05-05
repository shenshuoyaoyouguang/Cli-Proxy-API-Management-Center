# Agent Notes

- Usage token 统计不要盲信 `usage.total_tokens` / `api.total_tokens` / `model.total_tokens`。若对应 detail 中存在可识别 token evidence，应优先以 detail-derived truth 作为 canonical 值，哪怕真值是 `0`。
- 当 localStorage 退化为 aggregate-only lite cache 时，time-range 过滤不能把整份 snapshot 直接清零；没有 details 时应保留 aggregate summary，等待下次成功拉取再恢复明细类指标。
- persisted store 和 auto-persist 都依赖相同的 trim/rehydrate 语义；后续若修改 usage cache 行为，应同时检查 `src/utils/usage/cacheSnapshot.ts`、`src/stores/useUsageStatsStore.ts` 和 `src/services/autoPersist/AutoPersistService.ts`。
