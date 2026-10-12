import type { SystemStatus } from '../types';
import { MQTT_IMPL } from '../repositories';

interface Props {
  status: SystemStatus | null;
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600).toString().padStart(2, '0');
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const statusMap: Record<string, { label: string; color: string; dot: string }> = {
  connected:    { label: 'CONNECTED',    color: 'text-hud-green border-hud-green/50 bg-hud-green/10', dot: 'bg-hud-green' },
  connecting:   { label: 'CONNECTING…',  color: 'text-hud-yellow border-hud-yellow/50 bg-hud-yellow/10', dot: 'bg-hud-yellow' },
  disconnected: { label: 'DISCONNECTED', color: 'text-hud-red border-hud-red/50 bg-hud-red/10',       dot: 'bg-hud-red' },
};

export function SystemHeader({ status }: Props) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  const st = status ? statusMap[status.connectionStatus] : statusMap.disconnected;

  return (
    <header className="relative">
      <div className="hud-panel rounded-xl px-6 py-4 relative overflow-hidden">
        <div className="corner-tl" /><div className="corner-tr" /><div className="corner-bl" /><div className="corner-br" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-px bg-gradient-to-r from-transparent via-hud-cyan to-transparent opacity-80" />

        <div className="flex items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-5 min-w-0">
            <div className="shrink-0">
              <div className="w-12 h-12 rounded-xl bg-hud-cyan/10 border border-hud-cyan/50 flex items-center justify-center shadow-cyan-glow relative overflow-hidden">
                <svg viewBox="0 0 24 24" className="w-7 h-7 text-hud-cyan" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="9" y="2" width="6" height="18" rx="2.5" strokeLinejoin="round" />
                  <circle cx="12" cy="6.5" r="1.4" fill="currentColor" />
                  <circle cx="12" cy="11.5" r="1.4" fill="currentColor" />
                  <circle cx="12" cy="16.5" r="1.4" fill="currentColor" />
                  <path d="M5 22h14M10 22v1h4v-1" strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 bg-gradient-to-b from-hud-cyan/10 via-transparent to-transparent pointer-events-none" />
              </div>
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-hud-text text-glow-cyan tracking-widest">
                智能交通信号灯 · 实时监控中心
              </h1>
              <div className="flex items-center gap-3 mt-1 text-xs font-mono tracking-widest text-hud-text-muted flex-wrap">
                <span className="px-2 py-0.5 rounded bg-hud-cyan/10 border border-hud-cyan/30 text-hud-cyan">TRAFFIC-HUB v1.0</span>
                {import.meta.env.VITE_DATA_SOURCE === 'real' ? (
                  <>
                    <span className="px-2 py-0.5 rounded bg-hud-cyan/10 border border-hud-cyan/40 text-hud-cyan">MODE: REAL (MQTT)</span>
                    {MQTT_IMPL === 'native' ? (
                      <span className="px-2 py-0.5 rounded bg-hud-green/10 border border-hud-green/40 text-hud-green font-semibold">MQTT: NATIVE (原生 WS)</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-hud-yellow/10 border border-hud-yellow/40 text-hud-yellow">MQTT: mqtt.js</span>
                    )}
                  </>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-hud-red/10 border border-hud-red/40 text-hud-red">MODE: MOCK (本地演示)</span>
                )}
                <span>5G MQTT · QoS-1</span>
                <span className="hidden md:inline">{dateStr}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden lg:flex items-center gap-4 text-xs font-mono">
              <div className="text-right">
                <div className="text-hud-text-muted tracking-widest">UPTIME</div>
                <div className="text-hud-cyan text-sm mt-0.5">{status ? formatUptime(status.totalUptime) : '--:--:--'}</div>
              </div>
              <div className="w-px h-8 bg-hud-border/40" />
              <div className="text-right">
                <div className="text-hud-text-muted tracking-widest">MSG PROCESSED</div>
                <div className="text-hud-cyan text-sm mt-0.5">{status?.messagesProcessed ?? 0}</div>
              </div>
              <div className="w-px h-8 bg-hud-border/40" />
              <div className="text-right">
                <div className="text-hud-text-muted tracking-widest">5G SIGNAL</div>
                <div className="text-hud-cyan text-sm mt-0.5">{status?.signal5G ?? 0}%</div>
              </div>
              <div className="w-px h-8 bg-hud-border/40" />
              <div className="text-right">
                <div className="text-hud-text-muted tracking-widest">ROUTER IP</div>
                <div className="text-hud-cyan text-sm mt-0.5">{status?.routerIp ?? '--'}</div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className={`flex items-center gap-2 px-3 py-1 rounded-lg border text-xs font-mono tracking-widest ${st.color}`}>
                <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                {st.label}
              </div>
              <div className="text-right text-hud-cyan font-mono text-sm tracking-wider">
                {timeStr}
              </div>
              <div className="text-[10px] text-hud-text-muted tracking-widest font-mono">
                HEARTBEAT · {status?.lastHeartbeat ?? '--:--:--'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
