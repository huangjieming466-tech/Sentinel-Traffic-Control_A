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
  state?: string;
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
function hex(arr: Uint8Array, n = 16): string {
  return Array.from(arr.subarray(0, n))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

export class NativeMqttRepository implements ITrafficLightRepository {
  private ws: WebSocket | null = null;
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
  private destroyed = false;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private pingTimer: any = null;
  private lastPacketId = 1;
  private lastDownlinkAt = 0;
  private offlineTimer: number | null = null;
  private uptimeTimer: number | null = null;

  constructor() {
    this.pushMessage({
      type: 'info', level: 'debug',
      content: `[DBG-N] NativeMqttRepository constructor 被调用，预置ID=[${PRESET_LIGHT_IDS.join(',')}]`,
    });
    this.ensurePresetLights();
    this.offlineTimer = window.setInterval(() => this.checkOffline(), 5000);
    this.uptimeTimer = window.setInterval(() => this.tickUptime(), 1000);
    // Connection lifecycle is owned by useRepoConnection; do not open a second socket here.
  }

  async getLights(): Promise<TrafficLightState[]> {
    return Array.from(this.lights.values());
  }
  async getMessages(limit = 200): Promise<MessageLog[]> {
    return this.messages.slice(0, limit);
  }
  async getSystemStatus(): Promise<SystemStatus> {
    return { ...this.systemStatus };
  }
  subscribeLightState(lightId: string, callback: LightStateCallback): () => void {
    let set = this.lightSubs.get(lightId);
    if (!set) {
      set = new Set();
      this.lightSubs.set(lightId, set);
    }
    set.add(callback);
    const cur = this.lights.get(lightId);
    if (cur) callback(cur);
    return () => {
      set?.delete(callback);
      if (set?.size === 0) this.lightSubs.delete(lightId);
    };
  }
  subscribeAllLights(callback: LightStateCallback): () => void {
    this.allLightSubs.add(callback);
    for (const s of this.lights.values()) callback(s);
    return () => this.allLightSubs.delete(callback);
  }
  subscribeMessages(callback: MessageCallback): () => void {
    this.messageSubs.add(callback);
    for (const m of this.messages) callback(m);
    return () => this.messageSubs.delete(callback);
  }
  subscribeSystemStatus(callback: StatusCallback): () => void {
    this.statusSubs.add(callback);
    callback({ ...this.systemStatus });
    return () => this.statusSubs.delete(callback);
  }

  async connect(): Promise<void> {
    this.destroyed = false;
    if (!this.offlineTimer) this.offlineTimer = window.setInterval(() => this.checkOffline(), 5000);
    if (!this.uptimeTimer) this.uptimeTimer = window.setInterval(() => this.tickUptime(), 1000);
    this.setStatus('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host  = window.location.host;
    const url   = `${proto}://${host}${WS_URL_PATH}`;
    this.pushMessage({
      type: 'connection', level: 'info',
      content: `[DBG-N] connect() 被调用 → 最终 WS URL = ${url}`,
    });
    try {
      await this._connectOnce(url);
    } catch {
      /* 失败继续重连 */
    }
  }

  disconnect(): void {
    this.destroyed = true;
    this.clearTimers();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.setStatus('disconnected');
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

  private _connectOnce(url: string): Promise<void> {
    return new Promise<void>((resolve0) => {
      this._openOne(url, resolve0);
    });
  }

  private _openOne(url: string, resolveOnce: (v: void) => void) {
    if (this.destroyed) return;
    this.pushMessage({
      type: 'info', level: 'debug',
      content: `[DBG-N] _openOne 开始 new WebSocket(${url})，readyState 后续会走 onopen`,
    });
    try { this.ws?.close(); } catch { /* ignore */ }
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolveOnce(); } };
    const timer = setTimeout(() => {
      this.pushMessage({
        type: 'connection', level: 'warning',
        content: '[DBG-N] ⚠️ 12s 未收到 CONNACK，主动断开重连（EMQX 可能拒绝了 CONNECT 包，检查编码）',
      });
      try { ws.close(); } catch { /* ignore */ }
      finish();
    }, 12000);

    ws.onopen = () => {
      const clientId = `web-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const pkt = this._encodeConnect(clientId, 15, true);
      this.pushMessage({
        type: 'connection', level: 'info',
        content: `[DBG-N] ✅ WS onopen → 101 OK，发送 CONNECT ${pkt.length}B，hex 首20B=${hex(pkt, 20)}，clientId=${clientId}`,
      });
      this._send(pkt);
    };
    ws.onclose = (ev) => {
      const isCurrentSocket = this.ws === ws;
      finish();
      if (isCurrentSocket) {
        this.ws = null;
        this.setStatus('disconnected');
        this.stopPing();
        for (const [id, s] of this.lights.entries()) {
          s.isOnline = false;
          s.color = 'unknown';
          s.lastUpdated = nowISO();
          this.notifyLight(id, s);
        }
      }
      this.pushMessage({
        type: 'connection', level: 'warning',
        content: '[DBG-N] WS onclose code=' + ev.code + ' reason=' + (ev.reason || '(空)') + (isCurrentSocket && !this.destroyed ? '，3s 后重连' : '，忽略旧连接'),
      });
      if (isCurrentSocket && !this.destroyed) this.scheduleReconnect(url, resolveOnce);
    };    ws.onerror = () => {
      this.pushMessage({
        type: 'connection', level: 'error',
        content: '[DBG-N] WS onerror 触发（浏览器网络层错误）',
      });
    };
    ws.onmessage = (ev: MessageEvent) => {
      const buf = ev.data as ArrayBuffer;
      const u8 = new Uint8Array(buf);
      this.lastDownlinkAt = Date.now();
      this.pushMessage({
        type: 'info', level: 'debug',
        content: `[DBG-N] 📥 WS onmessage ${u8.length}B，hex 首20B=${hex(u8, 20)}`,
      });
      try {
        this.dispatchMqttAll(u8);
        // CONNACK confirms the connection; cancel the setup timeout.
        if (this.ws === ws && this.systemStatus.connectionStatus === 'connected') finish();
      } catch (e) {
        this.pushMessage({
          type: 'warning', level: 'error',
          content: `[DBG-N] ❌ 解包错误: ${(e as Error).message} len=${buf.byteLength}`,
        });
      }
    };
  }

  private scheduleReconnect(url: string, resolveOnce: (v: void) => void) {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.min(2 ** this.reconnectAttempts, 16), 5000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.setStatus('connecting');
      this._openOne(url, resolveOnce);
    }, delay);
  }

  private _send(bytes: Uint8Array) {
    if (!this.ws || this.ws.readyState !== 1) {
      this.pushMessage({
        type: 'warning', level: 'warning',
        content: `[DBG-N] ⚠️ _send 跳过，ws 不存在或 readyState!=1（当前 ${this.ws?.readyState ?? 'null'}）`,
      });
      return;
    }
    try {
      this.ws.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (e) {
      this.pushMessage({
        type: 'connection', level: 'error',
        content: `[DBG-N] ❌ _send 抛错: ${(e as Error).message}`,
      });
    }
  }
  private _encodeVarInt(n: number): number[] {
    const out: number[] = [];
    let x = n;
    do {
      let b = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) b |= 0x80;
      out.push(b);
    } while (x > 0);
    return out;
  }
  private _encodeUtf8(s: string): number[] {
    const arr = new TextEncoder().encode(s);
    return [(arr.length >> 8) & 0xff, arr.length & 0xff, ...Array.from(arr)];
  }
  private _encodeConnect(clientId: string, keepAlive: number, clean: boolean): Uint8Array {
    const protocol = this._encodeUtf8('MQTT');
    const flags = clean ? 0x02 : 0x00;
    const variableHeader = [...protocol, 4, flags, (keepAlive >> 8) & 0xff, keepAlive & 0xff];
    const payload = this._encodeUtf8(clientId);
    const remainingLen = variableHeader.length + payload.length;
    return new Uint8Array([0x10, ...this._encodeVarInt(remainingLen), ...variableHeader, ...payload]);
  }
  private _encodeSubscribe(topic: string, qos: 0 | 1 | 2): Uint8Array {
    this.lastPacketId = (this.lastPacketId + 1) & 0xffff || 1;
    const pktId = this.lastPacketId;
    const topicBytes = this._encodeUtf8(topic);
    const varHead = [(pktId >> 8) & 0xff, pktId & 0xff];
    const payload = [...topicBytes, qos & 0x03];
    const remLen = varHead.length + payload.length;
    return new Uint8Array([0x82, ...this._encodeVarInt(remLen), ...varHead, ...payload]);
  }
  private _encodePing(): Uint8Array { return new Uint8Array([0xc0, 0x00]); }

  private _decodeVarInt(buf: Uint8Array, off: number): { value: number; next: number } {
    let mul = 1, v = 0, i = off, b: number;
    do {
      if (i >= buf.length) throw new Error('varint truncated');
      b = buf[i++];
      v += (b & 0x7f) * mul;
      mul *= 128;
      if (mul > 128 * 128 * 128) throw new Error('varint overflow');
    } while ((b & 0x80) !== 0);
    return { value: v, next: i };
  }
  private _decodeUtf8(buf: Uint8Array, off: number): { value: string; next: number } {
    if (off + 2 > buf.length) throw new Error('bad utf8 prefix');
    const len = (buf[off] << 8) | buf[off + 1];
    if (off + 2 + len > buf.length) throw new Error('utf8 body too short len=' + len);
    const s = new TextDecoder('utf8').decode(buf.subarray(off + 2, off + 2 + len));
    return { value: s, next: off + 2 + len };
  }
  private dispatchMqttAll(bytes: Uint8Array) {
    let pos = 0;
    let pktIdx = 0;
    while (pos < bytes.length) {
      pktIdx++;
      const first = bytes[pos++];
      const type = (first >> 4) & 0x0f;
      const { value: remLen, next } = this._decodeVarInt(bytes, pos);
      pos = next;
      const end = pos + remLen;
      if (end > bytes.length) throw new Error(`packet #${pktIdx} truncated type=${type} remLen=${remLen} left=${bytes.length - pos}`);
      const body = bytes.subarray(pos, end);
      pos = end;
      this.pushMessage({
        type: 'info', level: 'debug',
        content: `[DBG-N] 包#${pktIdx} type=${type} (2=CONNACK 3=PUBLISH 9=SUBACK 13=PINGRESP) remLen=${remLen}B bodyHex=${hex(body, 24)}`,
      });
      this.handlePacket(type, body, first);
    }
  }
  private handlePacket(type: number, body: Uint8Array, firstByte: number) {
    switch (type) {
      case 2: {
        const rc = body[1];
        const sp = (body[0] & 1) === 1;
        if (rc === 0) {
          this.reconnectAttempts = 0;
          this.setStatus('connected');
          const sub = this._encodeSubscribe(TOPIC_STATE, 1);
          this.pushMessage({
            type: 'connection', level: 'success',
            content: `[DBG-N] ✅ CONNACK rc=0 sessionPresent=${sp} → 发送 SUBSCRIBE ${sub.length}B topic=${TOPIC_STATE} QoS=1，hex=${hex(sub, 24)}`,
          });
          this._send(sub);
          this.startPing();
        } else {
          this.pushMessage({
            type: 'connection', level: 'error',
            content: `[DBG-N] ❌ CONNACK rc=${rc} (1=协议 2=clientId 3=服务不可用 4=账号错 5=未授权)`,
          });
        }
        break;
      }
      case 9: {
        const pktId = (body[0] << 8) | body[1];
        const granted = Array.from(body.slice(2));
        const failed = granted.some((r) => r === 0x80);
        this.pushMessage({
          type: 'connection', level: failed ? 'error' : 'success',
          content: failed
            ? `[DBG-N] ❌ SUBACK pktId=${pktId} granted=${JSON.stringify(granted)} (0x80=被拒→EMQX ACL)`
            : `[DBG-N] ✅ SUBACK pktId=${pktId} granted=[${granted.join(',')}] → 马上会收到 retain+新 PUBLISH`,
        });
        break;
      }
      case 3: this.handlePublish(body, firstByte); break;
      case 13:
        this.pushMessage({ type: 'info', level: 'debug', content: '[DBG-N] PINGRESP 收到，WS 链路存活' });
        break;
      default:
        this.pushMessage({ type: 'info', level: 'debug', content: `[DBG-N] 忽略未处理 MQTT type=${type}` });
        break;
    }
  }
  private handlePublish(body: Uint8Array, firstByte: number) {
    let p = 0;
    const { value: topic, next } = this._decodeUtf8(body, p);
    p = next;
    const qos = (firstByte >> 1) & 0x03;
    if (qos === 3) throw new Error('invalid PUBLISH QoS=3');
    if (qos > 1) throw new Error('unsupported PUBLISH QoS=' + qos);
    if (qos === 1) {
      if (p + 2 > body.length) throw new Error('PUBLISH packet identifier truncated');
      const packetId = (body[p] << 8) | body[p + 1];
      p += 2;
      // QoS 1 adds a two-byte packet identifier after the topic. Acknowledge
      // the delivery, then parse JSON from the actual payload bytes.
      this._send(new Uint8Array([0x40, 0x02, (packetId >> 8) & 0xff, packetId & 0xff]));
    }
    const payloadRaw = body.subarray(p);
    const payload = new TextDecoder('utf8').decode(payloadRaw);
    this.pushMessage({
      type: 'info', level: 'debug',
      content: `[DBG-N] 📨 PUBLISH topic=[${topic}] payloadLen=${payload.length} payloadPreview=${payload.slice(0, 80)}`,
    });
    const m = STATE_TOPIC_RE.exec(topic);
    if (!m) {
      this.pushMessage({
        type: 'warning', level: 'warning',
        content: `[DBG-N] ⚠️ topic 不匹配正则 ${STATE_TOPIC_RE.source} → 忽略`,
      });
      return;
    }
    let parsed: IncomingState;
    try {
      parsed = JSON.parse(payload) as IncomingState;
    } catch (e) {
      this.pushMessage({
        type: 'warning', level: 'error', lightId: m[1],
        content: `[DBG-N] ❌ JSON.parse 失败: ${(e as Error).message} raw=${payload.slice(0, 120)}`,
      });
      return;
    }
    this.pushMessage({
      type: 'info', level: 'debug', lightId: m[1],
      content: `[DBG-N] ✅ JSON 解析 OK id=${parsed.id ?? '(无)'} color=${JSON.stringify(parsed.color)} remain=${parsed.remainingSeconds} online=${parsed.isOnline}`,
    });
    this.handleState(m[1], parsed);
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

    const presetIdx = PRESET_LIGHT_IDS.indexOf(id);
    const state: TrafficLightState = {
      id,
      name:               prev?.name               ?? DEFAULT_LIGHT_NAME,
      direction:          prev?.direction          ?? (presetIdx >= 0 ? (presetIdx % 2 === 0 ? 'north_south' : 'east_west') : 'north_south'),
      color,
      remainingSeconds:   Math.max(0, Math.trunc(remaining)),
      totalSeconds:       Math.max(0, Math.trunc(total)),
      isOnline: raw.isOnline !== false,
      lastUpdated:        nowISO(),
      signalStrength:     typeof raw.signalStrength === 'number' ? raw.signalStrength : (prev?.signalStrength ?? 80),
    };
    this.lights.set(id, state);
    this.lastSeen.set(id, Date.now());
    this.processed += 1;
    this.systemStatus.lastHeartbeat = state.lastUpdated;
    this.systemStatus.signal5G = Math.max(this.systemStatus.signal5G, state.signalStrength);
    this.systemStatus.messagesProcessed = this.processed;
    this.notifyLight(id, state);
    this.pushMessage({
      type: 'info', level: 'debug', lightId: id,
      content: `[DBG-N] 💡 UI 更新: ${id} ONLINE=true color=${color} remain=${state.remainingSeconds}s prev.online=${prev?.isOnline ?? '(预置)'} prev.color=${prevColor ?? '(预置)'}`,
    });

    const justCameOnline = prev && !prev.isOnline;
    if (justCameOnline || !prev) {
      this.pushMessage({
        type: 'connection', level: 'success', lightId: id, lightName: state.name,
        content: `设备上线，当前 ${color.toUpperCase()} ${state.remainingSeconds}s`,
      });
    }
    if (!prevColor || prevColor !== state.color) {
      const zh = { red: '红灯', yellow: '黄灯', green: '绿灯', red_yellow: '红黄灯', off: '全灭', unknown: '反馈不可用' }[state.color];
      this.pushMessage({
        type: 'state_change', level: colorLevel[state.color],
        lightId: id, lightName: state.name,
        content: `继电器反馈：${zh}（${state.color.toUpperCase()}），倒计时 ${state.remainingSeconds}s / ${state.totalSeconds}s`,
      });
    }
  }
  private checkOffline(): void {
    const now = Date.now();
    for (const [id, state] of this.lights) {
      const last = this.lastSeen.get(id) ?? 0;
      if (state.isOnline && now - last > LIGHT_OFFLINE_TIMEOUT_MS) {
        const next: TrafficLightState = { ...state, isOnline: false, color: 'unknown' };
        this.lights.set(id, next);
        this.notifyLight(id, next);
        this.pushMessage({
          type: 'warning', level: 'error', lightId: id, lightName: state.name,
          content: '设备超时离线 (>30s 无心跳)',
        });
      }
    }
  }
  private tickUptime() {
    this.systemStatus.totalUptime = Math.floor((Date.now() - this.startedAt) / 1000);
    this.notifyStatus();
  }

  private startPing() {
    this.stopPing();
    this.lastDownlinkAt = Date.now();
    this.pingTimer = setInterval(() => {
      if (this.systemStatus.connectionStatus !== 'connected') return;
      this._send(this._encodePing());
      if (Date.now() - this.lastDownlinkAt > 45000) {
        this.pushMessage({
          type: 'connection', level: 'warning',
          content: '[DBG-N] 45s 无下行 → 断开以重连',
        });
        try { this.ws?.close(); } catch { /* ignore */ }
      }
    }, 15000);
  }
  private stopPing() { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; } }
  private clearTimers() {
    this.stopPing();
    if (this.offlineTimer) { clearInterval(this.offlineTimer); this.offlineTimer = null; }
    if (this.uptimeTimer)  { clearInterval(this.uptimeTimer);  this.uptimeTimer  = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }
  private setStatus(s: SystemStatus['connectionStatus']) {
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
  private notifyLight(id: string, s: TrafficLightState): void {
    for (const fn of this.allLightSubs) try { fn(s); } catch { /* ignore */ }
    const set = this.lightSubs.get(id);
    if (set) for (const fn of set) try { fn(s); } catch { /* ignore */ }
  }
  private notifyStatus(): void {
    const snap = { ...this.systemStatus };
    for (const fn of this.statusSubs) try { fn(snap); } catch { /* ignore */ }
  }
  private pushMessage(p: Omit<MessageLog, 'id' | 'timestamp'>): void {
    const full: MessageLog = { ...p, id: uid(), timestamp: nowISO() };
    this.messages.unshift(full);
    if (this.messages.length > 200) this.messages.length = 200;
    for (const fn of this.messageSubs) try { fn(full); } catch { /* ignore */ }
  }
}
