import type { MessageLog, SystemStatus, TrafficLightState } from '../types';
import type { ITrafficLightRepository, LightStateCallback, MessageCallback, StatusCallback } from './ITrafficLightRepository';

type LightPhase = 'red' | 'yellow' | 'green';

interface LightRuntime {
  state: TrafficLightState;
  phase: LightPhase;
  timer: number;
  sequence: Array<{ color: LightPhase; duration: number }>;
  sequenceIndex: number;
}

const DURATIONS = {
  green: 22,
  yellow: 3,
  red: 25,
};

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function pad(n: number, len = 2): string {
  return n.toString().padStart(len, '0');
}

function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export class MockTrafficLightRepository implements ITrafficLightRepository {
  private runtimes: Map<string, LightRuntime>;
  private lightSubs: Map<string, Set<LightStateCallback>> = new Map();
  private allLightSubs: Set<LightStateCallback> = new Set();
  private messageSubs: Set<MessageCallback> = new Set();
  private statusSubs: Set<StatusCallback> = new Set();
  private messages: MessageLog[] = [];
  private tickHandle: number | null = null;
  private startTime = Date.now();
  private messageCount = 0;
  private systemStatus: SystemStatus = {
    totalUptime: 0,
    messagesProcessed: 0,
    connectionStatus: 'disconnected',
    lastHeartbeat: formatTime(new Date()),
    routerIp: '192.168.5G.1',
    signal5G: 0,
  };

  constructor() {
    const light1: LightRuntime = {
      state: {
        id: 'LIGHT-NS-01',
        name: '南北向主路信号灯',
        direction: 'north_south',
        color: 'green',
        remainingSeconds: DURATIONS.green,
        totalSeconds: DURATIONS.green,
        isOnline: true,
        lastUpdated: formatTime(new Date()),
        signalStrength: 94,
      },
      phase: 'green',
      timer: DURATIONS.green,
      sequence: [
        { color: 'green', duration: DURATIONS.green },
        { color: 'yellow', duration: DURATIONS.yellow },
        { color: 'red', duration: DURATIONS.red },
      ],
      sequenceIndex: 0,
    };

    const light2: LightRuntime = {
      state: {
        id: 'LIGHT-EW-02',
        name: '东西向支路信号灯',
        direction: 'east_west',
        color: 'red',
        remainingSeconds: DURATIONS.red,
        totalSeconds: DURATIONS.red,
        isOnline: true,
        lastUpdated: formatTime(new Date()),
        signalStrength: 91,
      },
      phase: 'red',
      timer: DURATIONS.red,
      sequence: [
        { color: 'red', duration: DURATIONS.red },
        { color: 'green', duration: DURATIONS.green },
        { color: 'yellow', duration: DURATIONS.yellow },
      ],
      sequenceIndex: 0,
    };

    this.runtimes = new Map([
      [light1.state.id, light1],
      [light2.state.id, light2],
    ]);

    this.seedMessages();
  }

  private seedMessages(): void {
    const now = Date.now();
    const initial: MessageLog[] = [
      {
        id: genId(),
        timestamp: formatTime(new Date(now - 18000)),
        type: 'connection',
        content: '5G 路由握手成功，建立 MQTT 会话 (clientId: traffic-hub-prod)',
        level: 'success',
      },
      {
        id: genId(),
        timestamp: formatTime(new Date(now - 17500)),
        type: 'connection',
        lightId: 'LIGHT-NS-01',
        lightName: '南北向主路信号灯',
        content: '设备上线：SN#A8472-F2，固件 v3.2.1，信号 -58dBm',
        level: 'success',
      },
      {
        id: genId(),
        timestamp: formatTime(new Date(now - 17000)),
        type: 'connection',
        lightId: 'LIGHT-EW-02',
        lightName: '东西向支路信号灯',
        content: '设备上线：SN#A8472-F3，固件 v3.2.1，信号 -61dBm',
        level: 'success',
      },
      {
        id: genId(),
        timestamp: formatTime(new Date(now - 16000)),
        type: 'decision',
        content: '调度策略加载：对称放行模式（南北22s / 东西22s）',
        level: 'info',
      },
      {
        id: genId(),
        timestamp: formatTime(new Date(now - 15000)),
        type: 'state_change',
        lightId: 'LIGHT-NS-01',
        lightName: '南北向主路信号灯',
        content: '灯色切换：GREEN [22s] 判定为南北向主路通行',
        level: 'success',
      },
      {
        id: genId(),
        timestamp: formatTime(new Date(now - 14800)),
        type: 'state_change',
        lightId: 'LIGHT-EW-02',
        lightName: '东西向支路信号灯',
        content: '灯色切换：RED [25s] 判定为东西向支路等待',
        level: 'info',
      },
    ];
    this.messages = initial;
    this.messageCount = initial.length;
  }

  private emitLight(rt: LightRuntime): void {
    const subs = this.lightSubs.get(rt.state.id);
    if (subs) subs.forEach((cb) => { try { cb(rt.state); } catch {} });
    this.allLightSubs.forEach((cb) => { try { cb(rt.state); } catch {} });
  }

  private emitMessage(msg: MessageLog): void {
    this.messages.unshift(msg);
    if (this.messages.length > 200) this.messages.length = 200;
    this.messageSubs.forEach((cb) => { try { cb(msg); } catch {} });
  }

  private emitStatus(): void {
    this.statusSubs.forEach((cb) => { try { cb(this.systemStatus); } catch {} });
  }

  private pushMessage(partial: Omit<MessageLog, 'id' | 'timestamp'>): void {
    const msg: MessageLog = {
      ...partial,
      id: genId(),
      timestamp: formatTime(new Date()),
    };
    this.messageCount += 1;
    this.systemStatus.messagesProcessed = this.messageCount;
    this.emitMessage(msg);
    this.emitStatus();
  }

  private tick(): void {
    const now = new Date();
    this.systemStatus.totalUptime = Math.floor((Date.now() - this.startTime) / 1000);
    this.systemStatus.lastHeartbeat = formatTime(now);
    this.systemStatus.signal5G = 88 + Math.floor(Math.random() * 8);

    for (const rt of this.runtimes.values()) {
      rt.timer -= 1;
      if (rt.timer <= 0) {
        rt.sequenceIndex = (rt.sequenceIndex + 1) % rt.sequence.length;
        const nextStep = rt.sequence[rt.sequenceIndex];
        rt.phase = nextStep.color;
        rt.timer = nextStep.duration;

        const prevColor = rt.state.color;
        rt.state.color = nextStep.color;
        rt.state.totalSeconds = nextStep.duration;
        rt.state.remainingSeconds = nextStep.duration;
        rt.state.lastUpdated = formatTime(now);
        rt.state.signalStrength = 85 + Math.floor(Math.random() * 12);

        const colorZh = { red: 'RED', yellow: 'YELLOW', green: 'GREEN' }[nextStep.color];
        const dirZh = rt.state.direction === 'north_south' ? '南北向' : '东西向';
        const decision =
          nextStep.color === 'green' ? `判定为${dirZh}通行` :
          nextStep.color === 'yellow' ? `判定为${dirZh}警示减速` :
          `判定为${dirZh}等待`;

        this.pushMessage({
          type: 'state_change',
          lightId: rt.state.id,
          lightName: rt.state.name,
          content: `灯色切换：${prevColor.toUpperCase()} → ${colorZh} [${nextStep.duration}s] ${decision}`,
          level: nextStep.color === 'yellow' ? 'warning' : nextStep.color === 'green' ? 'success' : 'info',
        });

        if (rt.sequenceIndex === 0) {
          this.pushMessage({
            type: 'decision',
            content: `调度器：新一轮相位轮换完成，冲突检查通过 (lock=NONE)`,
            level: 'info',
          });
        }
      } else {
        rt.state.remainingSeconds = rt.timer;
      }
      rt.state.signalStrength = Math.max(80, rt.state.signalStrength + (Math.random() > 0.5 ? 1 : -1));
      this.emitLight(rt);
    }

    this.emitStatus();

    if (Math.random() < 0.12) {
      const notes = [
        { content: '摄像头流量检测：主路排队 4 辆 / 支路 1 辆，按当前策略运行', level: 'info' as const },
        { content: '5G 链路延迟 23ms，抖动 1.2ms，通道质量优秀', level: 'success' as const },
        { content: '心跳保活 OK，下次同步在 30s 后', level: 'debug' as const },
        { content: '电源模块：AC220V 23.1W，电池备用待机 98%', level: 'info' as const },
      ];
      const pick = notes[Math.floor(Math.random() * notes.length)];
      this.pushMessage({ type: 'info', content: pick.content, level: pick.level });
    }
  }

  async connect(): Promise<void> {
    if (this.tickHandle != null) return;
    this.systemStatus.connectionStatus = 'connecting';
    this.emitStatus();
    await new Promise((r) => setTimeout(r, 600));
    this.systemStatus.connectionStatus = 'connected';
    this.emitStatus();
    this.pushMessage({
      type: 'connection',
      content: '前端已连接至本地 Mock 服务。切换到真实 5G MQTT/WebSocket 数据源请替换 Repository 实现。',
      level: 'info',
    });
    this.tickHandle = window.setInterval(() => this.tick(), 1000);
  }

  disconnect(): void {
    if (this.tickHandle != null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.systemStatus.connectionStatus = 'disconnected';
    this.emitStatus();
  }

  async getLights(): Promise<TrafficLightState[]> {
    return Array.from(this.runtimes.values()).map((rt) => ({ ...rt.state }));
  }

  async getMessages(limit = 100): Promise<MessageLog[]> {
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
    const rt = this.runtimes.get(lightId);
    if (rt) callback(rt.state);
    return () => set?.delete(callback);
  }

  subscribeAllLights(callback: LightStateCallback): () => void {
    this.allLightSubs.add(callback);
    for (const rt of this.runtimes.values()) callback(rt.state);
    return () => this.allLightSubs.delete(callback);
  }

  subscribeMessages(callback: MessageCallback): () => void {
    this.messageSubs.add(callback);
    for (const m of this.messages) callback(m);
    return () => this.messageSubs.delete(callback);
  }

  subscribeSystemStatus(callback: StatusCallback): () => void {
    this.statusSubs.add(callback);
    callback(this.systemStatus);
    return () => this.statusSubs.delete(callback);
  }
}

