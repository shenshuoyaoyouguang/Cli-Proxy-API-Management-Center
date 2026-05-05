# SSE 实时推送重构方案

> 目标：将统计数据页面从 60s 定时轮询机制迁移到 Server-Sent Events (SSE) 实时推送，保留轮询作为降级兜底。

---

## 1. 现状分析

### 1.1 当前数据刷新机制

**结论：当前采用纯定时轮询机制，无任何实时推送能力。**

| 轮询位置 | 间隔 | 触发方式 |
|---------|------|---------|
| `UsagePage.tsx:158-162` | 60秒 | `useInterval(() => loadUsage(), 60000)` |
| `QuotaPage.tsx:65-69` | 60秒 | `useInterval(() => loadConfig()+loadFiles(), 60000)` |
| `useProviderStats.ts:32-34` | 240秒 | `useInterval(() => refreshKeyStats(), 240_000)` |
| `AutoPersistService` | 30s延迟+60s间隔 | `setTimeout` + `setInterval` |

核心数据流：

```
useInterval(60s)
  → loadUsage()
    → useUsageStatsStore.loadUsageStats({force:true})
      → usageApi.getUsage() [GET /usage, 60s超时]
        → collectUsageDetails() + computeKeyStats()
          → writePersistedUsageStats() → localStorage
          → autoPersistService.onUsageRefreshed()
```

### 1.2 现有优化机制（重构时保留）

| 机制 | 位置 | 说明 |
|------|------|------|
| stale time 去重 | `useUsageStatsStore` | 120s内不重复请求同一端点 |
| in-flight 合并 | `useUsageStatsStore` | 并发请求只发一次，复用Promise |
| AbortController 取消 | `useUsageStatsStore` | scope切换/StrictMode时取消旧请求 |
| 三层缓存回填 | `useUsageStatsStore` | 内存 → autoPersist → localStorage，避免白屏 |
| RefreshCoordinator | `services/refresh/` | 全局刷新按钮的优先级协调 |
| useApiDedupe | `hooks/api/` | 30s过期 + 10s清理的去重层 |
| AutoPersistService | `services/autoPersist/` | 后台自动持久化usage快照到服务端 |

### 1.3 性能瓶颈

| 瓶颈 | 说明 |
|------|------|
| 数据滞后 | 最多60秒延迟，统计数据无法反映实时请求量变化 |
| 无效轮询 | 无数据变更时仍每60s发一次GET，浪费带宽和服务器资源 |
| 全量拉取 | 每次GET /usage返回完整数据快照，无法增量更新 |
| 多页面重复 | UsagePage(60s) + useProviderStats(240s) 各自轮询同一/usage端点 |
| 长时间无反馈 | 用户操作后需等待轮询周期才能看到变化 |

---

## 2. 技术选型

### 2.1 方案对比

| 维度 | WebSocket | SSE (推荐) | 长轮询 | 短轮询(现状) |
|------|-----------|-----------|--------|-------------|
| 实时性 | 毫秒级 | 毫秒级 | 秒级 | 60秒级 |
| 通信方向 | 双工 | 单向(服务端→客户端) | 单次请求/响应 | 单次请求/响应 |
| 断线重连 | 需手动实现 | 浏览器内置EventSource自动重连 | 需手动 | 无需 |
| 协议开销 | 需握手升级 | 纯HTTP，无升级 | 纯HTTP | 纯HTTP |
| 代理/CDN兼容 | 部分代理不支持WS | 良好(纯HTTP) | 良好 | 良好 |
| 浏览器API | WebSocket | EventSource | fetch | fetch |
| 实现复杂度 | 高(心跳+重连+状态) | 低(浏览器托管重连) | 中 | 低 |
| 内存占用 | 持久连接 | 持久连接(更轻量) | 短连接 | 短连接 |
| 数据格式 | 二进制/文本 | 纯文本 | 任意 | 任意 |

### 2.2 推荐：SSE (Server-Sent Events)

选择理由：

1. **单向推送匹配业务模型** — 统计数据是服务端→客户端的单向推送场景，客户端无需通过同一通道回传数据
2. **浏览器内置重连** — EventSource 自动重连 + Last-Event-ID 机制，无需手动实现心跳和重连逻辑
3. **纯HTTP协议** — 无需WebSocket握手升级，兼容所有代理/负载均衡器/CDN，与现有Axios基础设施无冲突
4. **鉴权可复用** — SSE可通过URL参数传递Bearer token，复用现有鉴权链路
5. **渐进式迁移** — 可与现有轮询并存，SSE连接失败时自动降级为轮询，零风险上线
6. **轻量实现** — 前端仅需EventSource实例，后端仅需一个SSE端点

不选WebSocket的理由：统计数据场景无需双向通信，WS的双工能力是过度设计；需额外实现心跳、重连、连接状态管理，复杂度远高于SSE。

---

## 3. 重构设计

### 3.1 整体架构

```
前端:
  useUsageSSE() ──→ useUsageStatsStore
    ├─ SSE连接成功: 接收增量事件 → 合并到store
    └─ SSE连接失败: 自动降级为 useInterval(60s) 轮询

后端:
  GET /usage/stream (SSE端点)
    ├─ 发送 usage:delta  事件（增量更新，有新请求时推送）
    ├─ 发送 usage:full   事件（全量快照，首次连接/Last-Event-ID过期时推送）
    └─ 发送 usage:heartbeat 事件（保活，30s间隔）
```

### 3.2 SSE事件协议

#### 3.2.1 事件类型定义

| 事件类型 | 触发条件 | 数据格式 |
|---------|---------|---------|
| `usage:full` | 首次连接 / Last-Event-ID过期 / 客户端请求全量修正 | 与现有 GET /usage 响应格式一致 |
| `usage:delta` | 每次有新usage记录产生 | 增量数据 |
| `usage:heartbeat` | 每30秒 | 空对象 `{}` |

#### 3.2.2 事件数据格式

**usage:delta (增量事件)**

```json
{
  "seq": 1715000042,
  "timestamp": 1715000042000,
  "requestCount": 5,
  "successCount": 4,
  "failureCount": 1,
  "tokenDelta": {
    "promptTokens": 1200,
    "completionTokens": 800,
    "totalTokens": 2000
  },
  "details": [
    {
      "model": "claude-3-sonnet",
      "source": "api-key-1",
      "timestamp": 1715000042000,
      "success": true,
      "tokens": { "prompt": 1200, "completion": 800, "total": 2000 }
    }
  ]
}
```

**usage:full (全量事件)**

```json
{
  "seq": 1715000042,
  "timestamp": 1715000042000,
  "usage": { "total_requests": 1234, "apis": {}, ... },
  "usageDetails": [ ... ]
}
```

**usage:heartbeat (心跳事件)**

```json
{}
```

#### 3.2.3 SSE响应示例

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: 1715000000
event: usage:full
data: {"seq":1715000000,"timestamp":1715000000000,"usage":{...},"usageDetails":[...]}

id: 1715000030
event: usage:heartbeat
data: {}

id: 1715000042
event: usage:delta
data: {"seq":1715000042,"timestamp":1715000042000,"requestCount":3,...}

id: 1715000072
event: usage:heartbeat
data: {}
```

### 3.3 鉴权方案

`EventSource` API 不支持自定义 Header，Bearer token 需通过以下方式传递：

| 方案 | 描述 | 安全性 | 推荐度 |
|------|------|--------|--------|
| URL参数 | `?token=xxx`，简单直接 | 中(token出现在URL和日志中) | 首选 |
| Ticket模式 | 先POST获取短生命期ticket，再用ticket连SSE | 高(ticket短期有效) | 备选 |

**首选方案A (URL参数)**：实现简单，SSE端点验证token后立即从URL中清除（不记录日志）。若安全要求更高则切换为方案B。

---

## 4. 重构实施步骤

### Phase 1: 前端准备

#### Step 1.1: 创建SSE类型定义

新建 `src/types/sse.ts`：

```typescript
export type UsageSSEEventType = 'usage:delta' | 'usage:full' | 'usage:heartbeat';

export interface UsageDeltaEvent {
  seq: number;
  timestamp: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
  tokenDelta: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  details: UsageDetail[];
}

export interface UsageFullEvent {
  seq: number;
  timestamp: number;
  usage: Record<string, unknown>;
  usageDetails: UsageDetail[];
}

export type UsageSSEConnectionState = 'connecting' | 'connected' | 'fallback' | 'disconnected';
```

#### Step 1.2: 创建SSE服务层

新建 `src/services/sse/UsageSSEService.ts`：

```typescript
class UsageSSEService {
  private source: EventSource | null = null;
  private handler: UsageSSEHandler | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private lastSeq: number | null = null;

  connect(baseUrl: string, token: string, handler: UsageSSEHandler): void {
    this.disconnect();
    this.handler = handler;
    const url = `${baseUrl}/usage/stream?token=${encodeURIComponent(token)}`;
    this.source = new EventSource(url);

    this.source.addEventListener('usage:delta', (e: MessageEvent) => {
      this.reconnectAttempts = 0;
      const data = JSON.parse(e.data) as UsageDeltaEvent;
      this.lastSeq = data.seq;
      handler.onDelta(data);
    });

    this.source.addEventListener('usage:full', (e: MessageEvent) => {
      this.reconnectAttempts = 0;
      const data = JSON.parse(e.data) as UsageFullEvent;
      this.lastSeq = data.seq;
      handler.onFull(data);
    });

    this.source.addEventListener('usage:heartbeat', () => {
      this.reconnectAttempts = 0;
    });

    this.source.onerror = (e: Event) => {
      if (this.source?.readyState === EventSource.CLOSED) {
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          handler.onError(e);
        }
      }
    };
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
  }

  getLastSeq(): number | null {
    return this.lastSeq;
  }
}

export const usageSSEService = new UsageSSEService();
```

#### Step 1.3: 创建 useUsageSSE Hook

新建 `src/hooks/useUsageSSE.ts`：

```typescript
export function useUsageSSE(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const [connectionState, setConnectionState] = useState<UsageSSEConnectionState>('connecting');
  const { apiBase, managementKey } = useAuthStore.getState();
  const loadUsageStats = useUsageStatsStore((s) => s.loadUsageStats);

  useEffect(() => {
    if (!enabled || !apiBase || !managementKey) return;

    let fallenBack = false;

    usageSSEService.connect(apiBase, managementKey, {
      onDelta: (data) => {
        useUsageStatsStore.getState().applyDelta(data);
      },
      onFull: (data) => {
        useUsageStatsStore.getState().applyFullSnapshot(data);
      },
      onError: () => {
        if (!fallenBack) {
          fallenBack = true;
          setConnectionState('fallback');
        }
      },
    });

    setConnectionState('connected');

    return () => {
      usageSSEService.disconnect();
      setConnectionState('disconnected');
    };
  }, [enabled, apiBase, managementKey]);

  // 降级轮询：SSE不可用时启用60s轮询
  useInterval(() => {
    void loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, connectionState === 'fallback' ? 60000 : null);

  // 定时尝试重连SSE（降级模式下每5分钟尝试一次）
  useInterval(() => {
    // 重新尝试SSE连接
  }, connectionState === 'fallback' ? 300000 : null);

  return { connectionState };
}
```

#### Step 1.4: 扩展 useUsageStatsStore

在现有 store 中新增两个 action：

```typescript
// 类型扩展
type UsageStatsState = {
  // ...现有字段
  applyDelta: (delta: UsageDeltaEvent) => void;
  applyFullSnapshot: (snapshot: UsageFullEvent) => void;
  lastSeq: number | null;
};

// 实现
applyDelta: (delta) => {
  const state = get();
  const mergedUsage = mergeUsageDelta(state.usage, delta);
  const mergedDetails = [...state.usageDetails, ...delta.details];
  const keyStats = computeKeyStatsFromDetails(mergedDetails);
  const nextSnapshot = {
    usage: mergedUsage,
    keyStats,
    usageDetails: mergedDetails,
    lastRefreshedAt: delta.timestamp,
    detailCount: mergedDetails.length,
    scopeKey: state.scopeKey,
  };
  writePersistedUsageStats(nextSnapshot);
  autoPersistService.onUsageRefreshed({
    scopeKey: state.scopeKey,
    usage: mergedUsage,
    keyStats,
    usageDetails: mergedDetails,
    lastRefreshedAt: delta.timestamp,
  });
  set({
    usage: mergedUsage,
    usageDetails: mergedDetails,
    keyStats,
    lastRefreshedAt: delta.timestamp,
    lastSeq: delta.seq,
    loading: false,
  });
},

applyFullSnapshot: (snapshot) => {
  const usageDetails = snapshot.usageDetails.length > 0
    ? snapshot.usageDetails
    : collectUsageDetails(snapshot.usage);
  const keyStats = computeKeyStatsFromDetails(usageDetails);
  const lastRefreshedAt = snapshot.timestamp;
  const state = get();
  const nextSnapshot = {
    usage: snapshot.usage,
    keyStats,
    usageDetails,
    lastRefreshedAt,
    detailCount: usageDetails.length,
    scopeKey: state.scopeKey,
  };
  writePersistedUsageStats(nextSnapshot);
  autoPersistService.onUsageRefreshed({
    scopeKey: state.scopeKey,
    usage: snapshot.usage,
    keyStats,
    usageDetails,
    lastRefreshedAt,
  });
  set({
    usage: snapshot.usage,
    usageDetails,
    keyStats,
    lastRefreshedAt,
    lastSeq: snapshot.seq,
    loading: false,
    error: null,
  });
},
```

#### Step 1.5: 修改 UsagePage

```typescript
export function UsagePage() {
  // 替换原有的 useInterval 轮询
  const { connectionState } = useUsageSSE({ enabled: true });

  // 保留手动刷新按钮
  useHeaderRefresh(loadUsage);

  // UI中显示连接状态指示器:
  //   connected  → 显示"实时"绿色标识
  //   fallback   → 显示"轮询模式"黄色标识（60s刷新）
  //   connecting → 显示"连接中"灰色标识
}
```

#### Step 1.6: 同步修改其他消费方

- **useProviderStats**: 移除240s独立轮询，改为从store订阅（store已由SSE实时更新）
- **QuotaPage**: 根据配额数据变更频率决定是否也接入SSE（低频数据可保留轮询）

### Phase 2: 后端实现

#### Step 2.1: 新增SSE端点

```
GET /usage/stream?token=xxx
Accept: text/event-stream
```

响应头：
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

#### Step 2.2: 后端事件广播机制

```
请求处理链路:
  客户端请求 → 路由/转发 → 记录usage
    → 更新内存中的usage聚合数据
    → 通知SSE端点的订阅者列表

SSE端点内部:
  维护 subscribers: Map<string, ServerResponse>
  每次有新usage记录时:
    构造delta事件 → 遍历subscribers → res.write(sseFormattedEvent)
  每30s发送heartbeat保活
  连接关闭时从subscribers移除
```

#### Step 2.3: Last-Event-ID 续传

```
客户端重连时携带 Last-Event-ID header
  → 后端解析ID(即seq号)
  → 若seq差距较小: 计算累积delta返回
  → 若seq差距过大或过期: 直接返回 usage:full 全量快照
```

### Phase 3: 集成与测试

#### Step 3.1: 集成步骤

1. UsagePage 接入 useUsageSSE，移除 useInterval 轮询
2. useProviderStats 移除独立轮询，改为 store 订阅
3. 端到端测试 + 降级场景测试

#### Step 3.2: 测试场景

| 场景 | 预期行为 |
|------|---------|
| 正常连接 | SSE推送delta事件，页面实时更新 |
| 首次连接 | 收到usage:full全量快照 |
| 网络断开 | EventSource自动重连，通过Last-Event-ID续传 |
| 5次重连失败 | 降级为60s轮询模式，显示降级标识 |
| 降级模式5分钟后 | 自动尝试重新连接SSE |
| token过期 | 收到error事件，断开连接，触发重新认证 |
| 页面隐藏 | 断开SSE节省资源 |
| 页面可见 | 重新连接SSE |
| seq跳跃 | 客户端主动请求usage:full全量修正 |

### Phase 4: 优化

1. **visibilitychange 连接管理**: 页面隐藏时断开SSE，可见时重连
2. **重连策略调优**: 指数退避(1s, 2s, 4s, 8s, 16s) + 最大重试5次
3. **监控SSE连接稳定性**: 记录连接/断开/降级事件，上报到监控
4. **增量合并优化**: 大批量delta合并（短时间内多个delta合并为一次store更新）

---

## 5. 关键注意事项

| 事项 | 处理方案 |
|------|---------|
| 鉴权安全 | SSE端点验证token，token过期时发送event:error并关闭连接，前端触发重新认证 |
| 断线重连 | EventSource内置重连；后端通过Last-Event-ID返回断点后的累积delta，或直接回退usage:full |
| 内存管理 | 后端对每个SSE连接设置订阅超时(30分钟无活动则关闭)；前端组件卸载时调用disconnect() |
| 连接数限制 | 浏览器对同域SSE连接数限制为6(HTTP/1.1)，本项目仅1个SSE连接，无风险 |
| 降级兜底 | SSE连接5次重试失败→标记fallback→启用60s轮询→定时尝试重连SSE(每5分钟) |
| 增量合并一致性 | delta事件携带递增seq号，前端检测seq跳跃时主动请求usage:full全量修正 |
| 页面不可见 | 监听visibilitychange事件，页面隐藏时断开SSE节省资源，可见时重连 |
| 现有缓存机制 | usage:full事件仍触发writePersistedUsageStats()写localStorage，保持三层缓存一致性 |
| AutoPersistService | 保持现有逻辑不变，SSE的applyDelta/applyFullSnapshot仍调用onUsageRefreshed |

---

## 6. 新增文件清单

| 文件路径 | 说明 |
|---------|------|
| `src/types/sse.ts` | SSE事件类型定义 |
| `src/services/sse/UsageSSEService.ts` | SSE连接管理服务 |
| `src/services/sse/index.ts` | 导出 |
| `src/hooks/useUsageSSE.ts` | SSE React Hook |

## 7. 修改文件清单

| 文件路径 | 修改内容 |
|---------|---------|
| `src/stores/useUsageStatsStore.ts` | 新增 applyDelta / applyFullSnapshot / lastSeq |
| `src/pages/UsagePage.tsx` | 替换useInterval为useUsageSSE，新增连接状态UI |
| `src/components/providers/hooks/useProviderStats.ts` | 移除240s独立轮询，改为store订阅 |
| `src/services/api/usage.ts` | 新增getUsageStream端点(可选，用于fetch模式) |

---

## 8. 实施顺序总览

```
Phase 1 (前端准备) ─────────────────────────────
  Step 1.1  创建 src/types/sse.ts
  Step 1.2  创建 src/services/sse/UsageSSEService.ts
  Step 1.3  创建 src/hooks/useUsageSSE.ts
  Step 1.4  扩展 useUsageStatsStore (applyDelta/applyFullSnapshot)
  Step 1.5  修改 UsagePage (接入useUsageSSE，移除轮询)
  Step 1.6  修改 useProviderStats (移除独立轮询)

Phase 2 (后端) ─────────────────────────────────
  Step 2.1  新增 GET /usage/stream SSE端点
  Step 2.2  实现事件广播机制 (usage记录→subscribers)
  Step 2.3  实现 heartbeat + Last-Event-ID续传

Phase 3 (集成与测试) ───────────────────────────
  Step 3.1  端到端集成
  Step 3.2  降级场景测试

Phase 4 (优化) ─────────────────────────────────
  Step 4.1  visibilitychange连接管理
  Step 4.2  重连策略调优(指数退避)
  Step 4.3  监控SSE连接稳定性指标
  Step 4.4  大批量delta合并优化
```
