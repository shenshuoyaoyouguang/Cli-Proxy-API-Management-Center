# Agent Notes

- `managementKey` 不允许再落到 `localStorage` / `sessionStorage` / `secureStorage`。登录页的“记住”语义已改成仅记住连接信息（`apiBase`），不要恢复或新增任何浏览器侧 bearer 持久化。
- 需要可取消的配置或 usage 请求时，必须把 `AbortSignal` 继续传到 `configApi.getConfig()` / `usageApi.getUsage()`，不要只在 store 里创建 `AbortController`。
- `useUsageStatsStore` bootstrap 选择缓存时要比较 `detailCount`，不要拿 `usageDetails.length` 代替，否则会把裁剪过明细但更新的快照误判成更旧。
- `AuthFiles` 发生上传、删除、批量删除、状态切换后，要同步 `invalidateAuthFilesMapCache(scopeKey)`，否则 `UsagePage` 可能继续消费旧的 auth file 映射。
- Provider 删除接口不要再把上游 `api-key` 放进 query string，统一走 DELETE body。
