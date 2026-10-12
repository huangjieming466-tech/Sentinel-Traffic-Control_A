import type { TrafficLightState } from '../types';

interface Props {
  lights: TrafficLightState[];
}

export function IntersectionOverview({ lights }: Props) {
  const ns = lights.find((l) => l.direction === 'north_south');
  const ew = lights.find((l) => l.direction === 'east_west');

  const colorMap: Record<string, string> = {
    red: '#ef4444',
    yellow: '#facc15',
    green: '#22c55e',
    red_yellow: '#ef4444',
    off: '#64748b',
    unknown: '#64748b',
  };

  return (
    <div className="hud-panel rounded-xl p-6 relative">
      <div className="corner-tl" /><div className="corner-tr" /><div className="corner-bl" /><div className="corner-br" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-hud-cyan text-sm font-semibold tracking-[0.3em]">路口概览 · TOPOLOGY</h3>
        <span className="text-[10px] font-mono text-hud-text-muted tracking-widest">INTERSECTION #A-07</span>
      </div>

      <div className="relative mx-auto" style={{ width: 360, height: 360 }}>
        <svg viewBox="0 0 360 360" className="absolute inset-0 w-full h-full">
          <defs>
            <pattern id="grid-overview" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(34,211,238,0.08)" strokeWidth="1" />
            </pattern>
            <radialGradient id="road-glow">
              <stop offset="0%" stopColor="rgba(34,211,238,0.15)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          <rect width="360" height="360" fill="url(#grid-overview)" />
          <circle cx="180" cy="180" r="140" fill="url(#road-glow)" />

          <rect x="140" y="0" width="80" height="360" fill="rgba(30,41,59,0.95)" stroke="rgba(14,116,144,0.5)" strokeWidth="1" />
          <rect x="0" y="140" width="360" height="80" fill="rgba(30,41,59,0.95)" stroke="rgba(14,116,144,0.5)" strokeWidth="1" />

          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={`lane-n-${i}`}>
              <line x1={175} y1={i * 55 + 10} x2={175} y2={i * 55 + 35} stroke="#facc15" strokeWidth="2" strokeDasharray="0" opacity="0.85" />
              <line x1={185} y1={i * 55 + 10} x2={185} y2={i * 55 + 35} stroke="#facc15" strokeWidth="2" strokeDasharray="0" opacity="0.85" />
            </g>
          ))}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <g key={`lane-e-${i}`}>
              <line x1={i * 55 + 10} y1={175} x2={i * 55 + 35} y2={175} stroke="#facc15" strokeWidth="2" strokeDasharray="0" opacity="0.85" />
              <line x1={i * 55 + 10} y1={185} x2={i * 55 + 35} y2={185} stroke="#facc15" strokeWidth="2" strokeDasharray="0" opacity="0.85" />
            </g>
          ))}

          <circle cx="180" cy="180" r="44" fill="none" stroke="rgba(34,211,238,0.4)" strokeWidth="1" strokeDasharray="3 5" />
          <circle cx="180" cy="180" r="30" fill="rgba(8,16,32,0.8)" stroke="rgba(34,211,238,0.6)" strokeWidth="1" />
          <text x="180" y="177" textAnchor="middle" fill="#22d3ee" fontSize="9" fontFamily="monospace" letterSpacing="2">CENTER</text>
          <text x="180" y="191" textAnchor="middle" fill="#67e8f9" fontSize="10" fontFamily="monospace" fontWeight="600">A-07</text>
        </svg>

        {ns && (
          <>
            <div className="absolute left-1/2 -translate-x-1/2 top-2 flex flex-col items-center">
              <div
                className="w-7 h-14 rounded-md border-2 flex flex-col gap-1 p-1 shadow-lg"
                style={{
                  background: 'rgba(8,16,32,0.95)',
                  borderColor: colorMap[ns.color] + '99',
                  boxShadow: `0 0 12px ${colorMap[ns.color]}55`,
                }}
              >
                {(['red', 'yellow', 'green'] as const).map((c) => (
                  <div
                    key={c}
                    className="flex-1 rounded-full"
                    style={{
                      background: (ns.color === c || (ns.color === 'red_yellow' && (c === 'red' || c === 'yellow'))) ? colorMap[c] : 'rgba(71,85,105,0.4)',
                      boxShadow: (ns.color === c || (ns.color === 'red_yellow' && (c === 'red' || c === 'yellow'))) ? `0 0 8px ${colorMap[c]}` : 'none',
                    }}
                  />
                ))}
              </div>
              <div className="mt-1.5 px-2 py-0.5 rounded text-[10px] font-mono tracking-widest" style={{ background: `${colorMap[ns.color]}22`, color: colorMap[ns.color], border: `1px solid ${colorMap[ns.color]}66` }}>
                N · {ns.color === 'unknown' ? '--' : ns.remainingSeconds + 's'}
              </div>
            </div>

            <div className="absolute left-1/2 -translate-x-1/2 bottom-2 flex flex-col items-center">
              <div className="mb-1.5 px-2 py-0.5 rounded text-[10px] font-mono tracking-widest" style={{ background: `${colorMap[ns.color]}22`, color: colorMap[ns.color], border: `1px solid ${colorMap[ns.color]}66` }}>
                S · {ns.color === 'unknown' ? '--' : ns.remainingSeconds + 's'}
              </div>
              <div
                className="w-7 h-14 rounded-md border-2 flex flex-col gap-1 p-1 shadow-lg"
                style={{
                  background: 'rgba(8,16,32,0.95)',
                  borderColor: colorMap[ns.color] + '99',
                  boxShadow: `0 0 12px ${colorMap[ns.color]}55`,
                }}
              >
                {(['red', 'yellow', 'green'] as const).map((c) => (
                  <div
                    key={c}
                    className="flex-1 rounded-full"
                    style={{
                      background: (ns.color === c || (ns.color === 'red_yellow' && (c === 'red' || c === 'yellow'))) ? colorMap[c] : 'rgba(71,85,105,0.4)',
                      boxShadow: (ns.color === c || (ns.color === 'red_yellow' && (c === 'red' || c === 'yellow'))) ? `0 0 8px ${colorMap[c]}` : 'none',
                    }}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {ew && (
          <>
            <div className="absolute top-1/2 -translate-y-1/2 left-2 flex flex-row items-center">
              <div
                className="h-7 w-14 rounded-md border-2 flex flex-row gap-1 p-1 shadow-lg"
                style={{
                  background: 'rgba(8,16,32,0.95)',
                  borderColor: colorMap[ew.color] + '99',
                  boxShadow: `0 0 12px ${colorMap[ew.color]}55`,
                }}
              >
                {(['red', 'yellow', 'green'] as const).map((c) => (
                  <div
                    key={c}
                    className="flex-1 rounded-full"
                    style={{
                      background: (ew.color === c || (ew.color === 'red_yellow' && (c === 'red' || c === 'yellow'))) ? colorMap[c] : 'rgba(71,85,105,0.4)',
                      boxShadow: (ew.color === c || (ew.color === 'red_yellow' && (c === 'red' || c === 'yellow'))) ? `0 0 8px ${colorMap[c]}` : 'none',
                    }}
                  />
                ))}
              </div>
              <div className="ml-1.5 px-2 py-0.5 rounded text-[10px] font-mono tracking-widest whitespace-nowrap" style={{ background: `${colorMap[ew.color]}22`, color: colorMap[ew.color], border: `1px solid ${colorMap[ew.color]}66` }}>
                W · {ew.color === 'unknown' ? '--' : ew.remainingSeconds + 's'}
              </div>
            </div>

            <div className="absolute top-1/2 -translate-y-1/2 right-2 flex flex-row items-center">
              <div className="mr-1.5 px-2 py-0.5 rounded text-[10px] font-mono tracking-widest whitespace-nowrap" style={{ background: `${colorMap[ew.color]}22`, color: colorMap[ew.color], border: `1px solid ${colorMap[ew.color]}66` }}>
                E · {ew.color === 'unknown' ? '--' : ew.remainingSeconds + 's'}
              </div>
              <div
                className="h-7 w-14 rounded-md border-2 flex flex-row gap-1 p-1 shadow-lg"
                style={{
                  background: 'rgba(8,16,32,0.95)',
                  borderColor: colorMap[ew.color] + '99',
                  boxShadow: `0 0 12px ${colorMap[ew.color]}55`,
                }}
              >
                {(['red', 'yellow', 'green'] as const).map((c) => (
                  <div
                    key={c}
                    className="flex-1 rounded-full"
                    style={{
                      background: (ew.color === c || (ew.color === 'red_yellow' && (c === 'red' || c === 'yellow'))) ? colorMap[c] : 'rgba(71,85,105,0.4)',
                      boxShadow: (ew.color === c || (ew.color === 'red_yellow' && (c === 'red' || c === 'yellow'))) ? `0 0 8px ${colorMap[c]}` : 'none',
                    }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-mono">
        <div className="p-3 rounded-lg border border-hud-border/40 bg-hud-bg/60 flex items-center justify-between">
          <div>
            <div className="text-hud-text-muted tracking-widest">NS 通行状态</div>
            <div className="mt-1 text-hud-cyan text-sm font-semibold">
              {ns?.color === 'green' ? '● 允许通行' : ns?.color === 'yellow' ? '▲ 警示减速' : ns?.color === 'red' || ns?.color === 'red_yellow' ? '■ 停车等待' : ns?.color === 'off' ? '○ 全灭' : '○ 反馈不可用'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold" style={{ color: ns ? colorMap[ns.color] : '#64748b', textShadow: `0 0 10px ${ns ? colorMap[ns.color] + '66' : 'transparent'}` }}>
              {ns?.color === 'unknown' ? '--' : ns?.remainingSeconds ?? 0}
            </div>
            <div className="text-[10px] text-hud-text-muted tracking-widest">SECONDS</div>
          </div>
        </div>
        <div className="p-3 rounded-lg border border-hud-border/40 bg-hud-bg/60 flex items-center justify-between">
          <div>
            <div className="text-hud-text-muted tracking-widest">EW 通行状态</div>
            <div className="mt-1 text-hud-cyan text-sm font-semibold">
              {ew?.color === 'green' ? '● 允许通行' : ew?.color === 'yellow' ? '▲ 警示减速' : ew?.color === 'red' || ew?.color === 'red_yellow' ? '■ 停车等待' : ew?.color === 'off' ? '○ 全灭' : '○ 反馈不可用'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold" style={{ color: ew ? colorMap[ew.color] : '#64748b', textShadow: `0 0 10px ${ew ? colorMap[ew.color] + '66' : 'transparent'}` }}>
              {ew?.color === 'unknown' ? '--' : ew?.remainingSeconds ?? 0}
            </div>
            <div className="text-[10px] text-hud-text-muted tracking-widest">SECONDS</div>
          </div>
        </div>
      </div>
    </div>
  );
}
