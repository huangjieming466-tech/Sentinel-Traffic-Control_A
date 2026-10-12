import mqtt, { type MqttClient } from 'mqtt';
import type { LightColor, MessageLog, SystemStatus, TrafficLightState } from '../types';
import type {
  ITrafficLightRepository,
  LightStateCallback,
  MessageCallback,
  StatusCallback,
} from './ITrafficLightRepository';

const WS_URL_PATH = import.meta.env.VITE_MQTT_WS_URL ?? '/mqtt';
const TOPIC_STATE = 'traffic/light/+/state';
const STATE_TOPIC_RE = /^traffic\/light\/([^/]+)\/state$/;

const DEFAULT_LIGHT_NAME = '现场信号灯';
const LIGHT_OFFLINE_TIMEOUT_MS = 30_000;

// 如果 MQTT 一上来还没消息，先预置这几个灯占位（ID 跟香橙派 publisher.py 里 LIGHT_ID 对应上）
const PRESET_LIGHT_IDS: string[] = (
  import.meta.env.VITE_PRESET_LIGHT_IDS ?? 'TL-SINGLE-001'
).split(',').map((s: string) => s.trim()).filter(Boolean);

type IncomingState = Partial<TrafficLightState> & {
  color?: LightColor | string | null;
  actual?: string | null;
  id?: string;
  remainingSeconds?: number;
  totalSeconds?: number;
  signalStrength?: number;
  isOnline?: boolean;
  lastUpdated?: string;
};

const colorLevel: Record<LightColor, MessageLog['level']> = {
  red:    'warning',
  yellow: 'warning',
  green:  'success',
  red_yellow: 'warning',
  off: 'info',
  unknown: 'warning',
};

function nowISO(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function uid(prefix = 'msg'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export class RealTrafficLightRepository implements ITrafficLightRepository {
  private client: MqttClient | null = null;
  private lights = new Map<string, TrafficLightState>();
  private lastSeen = new Map<string, number>();
  private messages: MessageLog[] = [];
  private lightSubs = new Map<string, Set<LightStateCallback>>();
  private allLightSubs = new Set<LightStateCallback>();
  private messageSubs = new Set<MessageCallback>();
  private statusSubs = new Set<StatusCallback>();
  private startedAt = Date.now();
  private processed = 0;
  private systemStatus: SystemStatus = {
    totalUptime: 0,
    messagesProcessed: 0,
    connectionStatus: 'disconnected',
    lastHeartbeat: '-',
    routerIp: import.meta.env.VITE_ROUTER_IP ?? '129.226.138.87',
    signal5G: 0,
  };
  private offlineTimer: number | null = null;

  constructor() {
    this.ensurePresetLights();
    this.offlineTimer = window.setInterval(() => this.checkOffline(), 5000);
    window.setInterval(() => this.tickUptime(), 1000);
  }

  private ensurePresetLights(): void {
    PRESET_LIGHT_IDS.forEach((id, idx) => {
      if (this.lights.has(id)) return;
      const state: TrafficLightState = {
        id,
        name: DEFAULT_LIGHT_NAME,
        direction: idx % 2 === 0 ? 'north_south' : 'east_west',
        color: 'unknown',
        remainingSeconds: 0,
        totalSeconds: 0,
        isOnline: false,
        lastUpdated: '-',
        signalStrength: 0,
      };
      this.lights.set(id, state);
    });
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host  = window.location.host;
    const url   = `${proto}://${host}${WS_URL_PATH}`;

    this.pushMessage({
      type: 'connection',
      level: 'info',
      content: `[DIAG] 正在建立 MQTT WebSocket → ${url}  (clean=true, protocol=mqtt 3.1.1)`,
    });

    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      const to = window.setTimeout(() => {
        if (resolved) return;
        this.pushMessage({
          type: 'connection',
          level: 'warning',
          content: '[DIAG] 连接超时 (8s 未收到 CONNACK)，进入重连循环',
        });
        reject(new Error('connect timeout'));
      }, 10_000);

      const client = mqtt.connect(url, {
        clean: true,
        connectTimeout: 10_000,
        reconnectPeriod: 3_000,
        keepalive: 15,
        resubscribe: true,
        protocolVersion: 4,
        clientId: `web-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      });
      this.client = client;

      client.on('connect', (packet) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(to);
        this.setStatus('connected');
        this.pushMessage({
          type: 'connection',
          level: 'success',
          content: `[DIAG] ✅ CONNACK sessionPresent=${(packet as any)?.sessionPresent ?? false} → 订阅 ${TOPIC_STATE} QoS=1`,
        });
        client.subscribe(TOPIC_STATE, { qos: 1 }, (err, granted) => {
          if (err) {
            this.pushMessage({
              type: 'connection',
              level: 'error',
              content: `[DIAG] ❌ SUBSCRIBE 发送失败: ${err.message}  (检查 ACL/匿名权限)`,
            });
            return;
          }
          const failed = granted?.filter((g: any) => (g.qos ?? 0x80) === 0x80) ?? [];
          if (failed.length > 0) {
            this.pushMessage({
              type: 'connection',
              level: 'error',
              content: `[DIAG] ❌ SUBACK granted=0x80 (订阅被拒): ${JSON.stringify(granted)} → 请去 EMQX 开允许订阅或允许匿名`,
            });
          } else {
            this.pushMessage({
              type: 'connection',
              level: 'success',
              content: `[DIAG] ✅ SUBACK granted=${JSON.stringify(granted)} → 等待 PUBLISH，页面灯会立即更新`,
            });
          }
        });
        resolve();
      });

      client.on('reconnect', () => {
        this.setStatus('connecting');
        this.pushMessage({
          type: 'connection',
          level: 'info',
          content: '[DIAG] ↺ 自动重连中...',
        });
      });

      client.on('close', () => {
        if (!resolved) return;
        this.setStatus('disconnected');
        this.pushMessage({
          type: 'connection',
          level: 'warning',
          content: '[DIAG] WebSocket 已关闭，3s 后自动重连',
        });
      });

      client.on('error', (err) => {
        this.pushMessage({
          type: 'connection',
          level: 'error',
          content: `[DIAG] MQTT Error: ${(err as Error).message}`,
        });
      });

      client.on('end', () => {
        this.pushMessage({
          type: 'connection',
          level: 'warning',
          content: '[DIAG] client.end()',
        });
      });

      client.on('message', (topic, payload, packet) => {
        this.pushMessage({
          type: 'info',
          level: 'debug',
          content: `[DIAG] 📥 RAW MSG topic=${topic} bytes=${payload.length} qos=${packet.qos} retain=${packet.retain}`,
        });
        const m = STATE_TOPIC_RE.exec(topic);
        if (!m) return;
        const topicId = m[1];
        let parsed: IncomingState;
        try {
          parsed = JSON.parse(payload.toString()) as IncomingState;
        } catch (e) {
          this.pushMessage({
            type: 'warning',
            level: 'error',
            lightId: topicId,
            content: `收到非法 JSON: ${(e as Error).message}  raw=${payload.toString().slice(0, 120)}`,
          });
          return;
        }
        this.handleState(topicId, parsed);
      });
    }).catch(() => { /* timeout reject 不影响 reconnect 继续 */ });
  }

  disconnect(): void {
    if (this.offlineTimer) {
      clearInterval(this.offlineTimer);
      this.offlineTimer = null;
    }
    this.client?.end(true);
    this.client = null;
    this.setStatus('disconnected');
  }

  private handleState(topicId: string, raw: IncomingState): void {
    const id = raw.id ?? topicId;
    const color: LightColor =
      raw.actual === 'RED' ? 'red' :
      raw.actual === 'YELLOW' ? 'yellow' :
      raw.actual === 'GREEN' ? 'green' :
      raw.actual === 'RED_YELLOW' ? 'red_yellow' :
      raw.actual === 'OFF' ? 'off' : 'unknown';

    const prev = this.lights.get(id);
    const prevColor = prev?.color;

    const remaining = typeof raw.remainingSeconds === 'number' ? raw.remainingSeconds : (prev?.remainingSeconds ?? 0);
    const reportedTotal = typeof raw.totalSeconds === 'number' && raw.totalSeconds > 0 ? raw.totalSeconds : 0;
    // The publishers currently send totalSeconds=0. Infer this phase length from
    // the first countdown seen, and reset when the color or countdown restarts.
    const phaseRestarted = !prev || prev.color !== color || remaining > prev.remainingSeconds + 1;
    const inferredTotal = phaseRestarted ? remaining : Math.max(prev?.totalSeconds ?? 0, remaining);
    const total = reportedTotal > 0 ? reportedTotal : inferredTotal;

    const state: TrafficLightState = {
      id,
      name:               prev?.name               ?? DEFAULT_LIGHT_NAME,
      direction:          prev?.direction          ?? 'north_south',
      color,
      remainingSeconds:   Math.max(0, Math.trunc(remaining)),
      totalSeconds:       Math.max(0, Math.trunc(total)),
      isOnline:           raw.isOnline !== false,
      lastUpdated:        nowISO(),
      signalStrength:     typeof raw.signalStrength === 'number' ? raw.signalStrength : (prev?.signalStrength ?? 80),
    };

    this.lights.set(id, state);
    this.lastSeen.set(id, Date.now());
    this.processed += 1;
    this.systemStatus.lastHeartbeat  = state.lastUpdated;
    this.systemStatus.signal5G       = Math.max(this.systemStatus.signal5G, state.signalStrength);
    this.systemStatus.messagesProcessed = this.processed;

    this.notifyLight(id, state);

    const justCameOnline = prev && !prev.isOnline;
    if (justCameOnline) {
      this.pushMessage({
        type: 'connection',
        level: 'success',
        lightId: id,
        lightName: state.name,
        content: `设备重新上线，当前 ${color.toUpperCase()} ${state.remainingSeconds}s`,
      });
    }

    if (!prevColor || prevColor !== state.color) {
      const zh = { red: '红灯', yellow: '黄灯', green: '绿灯', red_yellow: '红黄灯', off: '全灭', unknown: '反馈不可用' }[state.color];
      this.pushMessage({
        type: 'state_change',
        level: colorLevel[state.color],
        lightId: id,
        lightName: state.name,
        content: `继电器反馈：${zh}（${state.color.toUpperCase()}），倒计时 ${state.remainingSeconds}s / ${state.totalSeconds}s`,
      });
    }
  }

  private checkOffline(): void {
    const now = Date.now();
    for (const [id, state] of this.lights) {
      const last = this.lastSeen.get(id) ?? 0;
      if (state.isOnline && now - last > LIGHT_OFFLINE_TIMEOUT_MS) {
        const offline: TrafficLightState = { ...state, isOnline: false, color: 'unknown' };
        this.lights.set(id, offline);
        this.notifyLight(id, offline);
        this.pushMessage({
          type: 'warning',
          level: 'error',
          lightId: id,
          lightName: state.name,
          content: `设备超时未上报（>${Math.round(LIGHT_OFFLINE_TIMEOUT_MS / 1000)}s），已标记离线`,
        });
      }
    }
  }

  private tickUptime(): void {
    this.systemStatus.totalUptime = Math.floor((Date.now() - this.startedAt) / 1000);
    this.notifyStatus();
  }

  private notifyLight(id: string, state: TrafficLightState): void {
    this.lightSubs.get(id)?.forEach((cb) => {
      try { cb(state); } catch { /* ignore */ }
    });
    this.allLightSubs.forEach((cb) => {
      try { cb(state); } catch { /* ignore */ }
    });
  }

  private notifyStatus(): void {
    this.statusSubs.forEach((cb) => {
      try { cb({ ...this.systemStatus }); } catch { /* ignore */ }
    });
  }

  private setStatus(s: SystemStatus['connectionStatus']): void {
    this.systemStatus.connectionStatus = s;
    this.notifyStatus();
    this.pushMessage({
      type: 'connection',
      level: s === 'connected' ? 'success' : s === 'connecting' ? 'info' : 'error',
      content:
        s === 'connected'    ? '数据通道已连接' :
        s === 'connecting'   ? '正在建立数据通道…' :
                               '数据通道已断开',
    });
  }

  private pushMessage(partial: Omit<MessageLog, 'id' | 'timestamp'>): void {
    const msg: MessageLog = {
      id: uid(),
      timestamp: nowISO(),
      ...partial,
    };
    this.messages.unshift(msg);
    if (this.messages.length > 500) this.messages.length = 500;
    this.messageSubs.forEach((cb) => {
      try { cb(msg); } catch { /* ignore */ }
    });
  }

  // ---------- public API ----------
  async getLights(): Promise<TrafficLightState[]> {
    this.ensurePresetLights();
    return Array.from(this.lights.values());
  }
  async getMessages(limit = 200): Promise<MessageLog[]> {
    return this.messages.slice(0, limit);
  }
  async getSystemStatus(): Promise<SystemStatus> {
    return { ...this.systemStatus };
  }

  subscribeLightState(lightId: string, callback: LightStateCallback): () => void {
    if (!this.lightSubs.has(lightId)) this.lightSubs.set(lightId, new Set());
    this.lightSubs.get(lightId)!.add(callback);
    const existing = this.lights.get(lightId);
    if (existing) queueMicrotask(() => callback(existing));
    return () => this.lightSubs.get(lightId)?.delete(callback);
  }

  subscribeAllLights(callback: LightStateCallback): () => void {
    this.allLightSubs.add(callback);
    for (const s of this.lights.values()) queueMicrotask(() => callback(s));
    return () => this.allLightSubs.delete(callback);
  }

  subscribeMessages(callback: MessageCallback): () => void {
    this.messageSubs.add(callback);
    for (const m of this.messages) queueMicrotask(() => callback(m));
    return () => this.messageSubs.delete(callback);
  }

  subscribeSystemStatus(callback: StatusCallback): () => void {
    this.statusSubs.add(callback);
    queueMicrotask(() => callback({ ...this.systemStatus }));
    return () => this.statusSubs.delete(callback);
  }
}
