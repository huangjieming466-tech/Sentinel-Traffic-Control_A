import { useEffect, useState } from 'react';
import type { TrafficLightState } from '../types';

interface Props {
  light: TrafficLightState;
}

const colorLabel: Record<string, string> = {
  red: '红灯',
  yellow: '黄灯',
  green: '绿灯',
  red_yellow: '红黄灯',
  off: '全灭',
  unknown: '反馈不可用',
};

const colorTextClass: Record<string, string> = {
  red: 'text-hud-red text-glow-red',
  yellow: 'text-hud-yellow text-glow-yellow',
  green: 'text-hud-green text-glow-green',
  red_yellow: 'text-hud-red text-glow-red',
  off: 'text-hud-text-muted',
  unknown: 'text-hud-text-muted',
};

const colorHex: Record<string, string> = {
  red: '#ef4444',
  yellow: '#facc15',
  green: '#22c55e',
  red_yellow: '#ef4444',
  off: '#64748b',
  unknown: '#64748b',
};

function formatUptime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function TrafficLightDisplay({ light }: Props) {
  const nowColor = light.color;
  const progress = light.totalSeconds > 0 ? (light.remainingSeconds / light.totalSeconds) * 100 : 0;
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setClockTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="hud-panel rounded-xl p-6 relative">
      <div className="corner-tl" /><div className="corner-tr" /><div className="corner-bl" /><div className="corner-br" />

      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-hud-green" />
          <span className="text-hud-cyan text-sm tracking-[0.25em] font-mono">ID: {light.id}</span>
        </div>
        <div className="text-right">
          <div className="text-xs text-hud-text-muted tracking-widest">5G 信号</div>
          <div className="flex items-center gap-1.5 justify-end mt-1">
            {[1, 2, 3, 4, 5].map((i) => {
              const threshold = 40 + (i - 1) * 12;
              const on = light.signalStrength >= threshold;
              return (
                <div
                  key={i}
                  className={`w-1.5 rounded-sm transition-all ${on ? 'bg-hud-cyan shadow-[0_0_6px_rgba(34,211,238,0.8)]' : 'bg-hud-text-muted/30'}`}
                  style={{ height: `${4 + i * 3}px` }}
                />
              );
            })}
            <span className="ml-2 text-sm font-mono text-hud-cyan">{light.signalStrength}%</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-8">
        <div className="relative flex items-center justify-center" style={{ minHeight: 220 }}>
          <div className="relative flex flex-col items-center gap-3 py-6 px-8 rounded-2xl" style={{ background: 'rgba(2, 6, 23, 0.6)', border: '1px solid rgba(14, 116, 144, 0.35)' }}>
            <div className="w-[90px] flex flex-col gap-3">
              <div className={`lamp red ${nowColor === 'red' || nowColor === 'red_yellow' ? 'active' : ''}`} />
              <div className={`lamp yellow ${nowColor === 'yellow' || nowColor === 'red_yellow' ? 'active' : ''}`} />
              <div className={`lamp green ${nowColor === 'green' ? 'active' : ''}`} />
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-4 min-w-[220px]">
          <div>
            <div className="text-xs text-hud-text-muted tracking-[0.3em] mb-1">RELAY FEEDBACK</div>
            <div className={`text-4xl font-bold font-mono tracking-wider ${colorTextClass[nowColor]}`}>
              {nowColor.toUpperCase()}
              <span className="ml-3 text-xl text-hud-text-dim">{colorLabel[nowColor]}</span>
            </div>
          </div>

          <div>
            <div className="text-xs text-hud-text-muted tracking-[0.3em] mb-1">REMAINING</div>
            <div className={`text-6xl font-bold font-mono ${colorTextClass[nowColor]}`}>
              {nowColor === 'unknown' ? '--' : light.remainingSeconds.toString().padStart(2, '0')}
              <span className="text-2xl ml-1 opacity-70">s</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-hud-text-muted/20 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-1000 ease-linear"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${colorHex[nowColor]}dd, ${colorHex[nowColor]}66)`,
                  boxShadow: `0 0 8px ${colorHex[nowColor]}88`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-hud-text-muted mt-1 tracking-widest">
              <span>0s</span>
              <span>TOTAL {light.totalSeconds}s</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 text-xs font-mono">
            <div className="p-2.5 rounded-lg border border-hud-border/40 bg-hud-bg/60 flex items-center justify-between">
              <div className="text-hud-text-muted tracking-widest">STATUS</div>
              <div className={`text-sm font-semibold ${light.isOnline && nowColor !== 'unknown' ? 'text-hud-green' : 'text-hud-red'}`}>
                {!light.isOnline ? '○ OFFLINE' : nowColor === 'unknown' ? '○ 反馈不可用' : '● ONLINE'}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border border-hud-border/40 bg-hud-bg/60 flex items-center justify-between">
              <div>
                <div className="text-hud-text-muted tracking-widest mb-0.5">LAST UPDATE</div>
                <div className="text-hud-cyan text-sm">{light.lastUpdated}</div>
              </div>
              <div className="text-right">
                <div className="text-hud-text-muted tracking-widest mb-0.5">CLOCK</div>
                <div className="text-hud-cyan text-sm">{formatUptime(Math.floor(clockTick))}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
