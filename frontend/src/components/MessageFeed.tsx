import { useEffect, useRef, useState } from 'react';
import type { MessageLog } from '../types';

interface Props {
  messages: MessageLog[];
}

const levelStyle: Record<string, { dot: string; label: string; text: string; bg: string }> = {
  debug:   { dot: 'bg-hud-text-muted', label: 'DBG', text: 'text-slate-400',    bg: 'bg-slate-700/20' },
  info:    { dot: 'bg-hud-cyan',        label: 'INF', text: 'text-hud-text-dim', bg: 'bg-cyan-500/5' },
  success: { dot: 'bg-hud-green',       label: 'OK ', text: 'text-hud-green',    bg: 'bg-green-500/5' },
  warning: { dot: 'bg-hud-yellow',      label: 'WRN', text: 'text-hud-yellow',   bg: 'bg-yellow-500/5' },
  error:   { dot: 'bg-hud-red',         label: 'ERR', text: 'text-hud-red',      bg: 'bg-red-500/5' },
};

const typeLabel: Record<string, string> = {
  state_change: 'STATE',
  decision:     'DECIDE',
  connection:   'LINK',
  warning:      'WARN',
  info:         'INFO',
};

export function MessageFeed({ messages }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevLenRef = useRef(0);
  const [filter, setFilter] = useState<'all' | 'state_change' | 'decision' | 'connection' | 'info'>('all');

  const filtered = filter === 'all' ? messages : messages.filter((m) => m.type === filter);

  useEffect(() => {
    if (!autoScroll) return;
    if (filtered.length !== prevLenRef.current) {
      prevLenRef.current = filtered.length;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }, [filtered, autoScroll]);

  const counts = {
    all: messages.length,
    state_change: messages.filter((m) => m.type === 'state_change').length,
    decision: messages.filter((m) => m.type === 'decision').length,
    connection: messages.filter((m) => m.type === 'connection').length,
    info: messages.filter((m) => m.type === 'info').length,
  };

  return (
    <div className="hud-panel rounded-xl flex flex-col relative h-full">
      <div className="corner-tl" /><div className="corner-tr" /><div className="corner-bl" /><div className="corner-br" />

      <div className="flex items-center justify-between px-5 py-3 border-b border-hud-border/40">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-hud-cyan" />
            </span>
            <h3 className="text-hud-cyan text-sm font-semibold tracking-[0.3em]">EVENT STREAM</h3>
          </div>
          <span className="px-2 py-0.5 rounded bg-hud-cyan/10 border border-hud-cyan/30 text-hud-cyan text-[10px] font-mono tracking-widest">
            {filtered.length} ENTRIES
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs text-hud-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-cyan-500 w-3.5 h-3.5"
          />
          AUTO SCROLL
        </label>
      </div>

      <div className="flex items-center gap-1 px-5 py-2 border-b border-hud-border/20 overflow-x-auto">
        {([
          ['all', 'ALL'],
          ['state_change', '灯色切换'],
          ['decision', '调度判定'],
          ['connection', '连接状态'],
          ['info', '系统信息'],
        ] as const).map(([key, label]) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1 rounded-md text-[11px] font-mono tracking-wider whitespace-nowrap transition-all ${
                active
                  ? 'bg-hud-cyan/20 text-hud-cyan border border-hud-cyan/50 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                  : 'text-hud-text-muted hover:text-hud-text-dim border border-transparent hover:border-hud-border/40'
              }`}
            >
              {label}
              <span className="ml-1.5 opacity-70">{counts[key]}</span>
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="message-scroll flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-center text-hud-text-muted text-xs py-12 tracking-widest">—— 暂无事件 ——</div>
        )}
        {filtered.map((m, idx) => {
          const s = levelStyle[m.level];
          const firstSeen = idx === 0;
          return (
            <div
              key={m.id}
              className={`group relative rounded-lg px-3 py-2.5 border border-transparent ${s.bg} transition-all ${
                firstSeen ? 'ring-1 ring-hud-cyan/40' : 'hover:border-hud-border/40'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center pt-1">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  <span className="w-px flex-1 mt-1.5 bg-hud-border/30" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono tracking-widest">
                    <span className="text-hud-text-muted">{m.timestamp}</span>
                    <span className={`px-1.5 py-0.5 rounded ${s.bg} border border-hud-border/30 ${s.text}`}>{s.label}</span>
                    <span className="px-1.5 py-0.5 rounded bg-hud-bg/60 border border-hud-border/30 text-hud-cyan">
                      {typeLabel[m.type] ?? m.type.toUpperCase()}
                    </span>
                    {m.lightId && (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/5 border border-cyan-500/20 text-hud-text-dim">
                        {m.lightId}
                      </span>
                    )}
                    {m.lightName && (
                      <span className="text-hud-text-muted truncate max-w-[180px]">{m.lightName}</span>
                    )}
                  </div>
                  <div className={`mt-1 text-sm leading-relaxed ${s.text}`}>
                    {m.content}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 py-2 border-t border-hud-border/30 flex items-center justify-between text-[10px] font-mono text-hud-text-muted tracking-widest">
        <span>TOTAL: {messages.length}</span>
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-hud-green" />
          LIVE FEED · WS-MQTT BRIDGE
        </span>
      </div>
    </div>
  );
}
