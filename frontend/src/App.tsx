import { useEffect, useState } from 'react';
import './index.css';
import { SystemHeader } from './components/SystemHeader';
import { TrafficLightDisplay } from './components/TrafficLightDisplay';
import { MessageFeed } from './components/MessageFeed';
import { useMessageLog, useRepoConnection, useSystemStatus, useTrafficLights } from './hooks/useTrafficLight';

function App() {
  useRepoConnection();
  const { lightList } = useTrafficLights();
  const messages = useMessageLog(150);
  const status = useSystemStatus();
  const [clock, setClock] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setClock((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  void clock;

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden hud-bg">
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 radial-bg pointer-events-none" />

      <div className="relative z-10 mx-auto px-4 lg:px-8 py-5 max-w-[1600px] min-h-screen flex flex-col gap-5">
        <SystemHeader status={status} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1">
          <div className="lg:col-span-8 flex flex-col gap-5">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {lightList.map((light) => (
                <TrafficLightDisplay key={light.id} light={light} />
              ))}
            </div>
          </div>

          <div className="lg:col-span-4 min-h-[600px] max-h-[calc(100vh-200px)] lg:sticky lg:top-5">
            <MessageFeed messages={messages} />
          </div>
        </div>

        <footer className="pt-2 pb-4 flex flex-wrap items-center justify-between gap-3 text-[10px] font-mono text-hud-text-muted tracking-widest">
          <div className="flex items-center gap-4">
            <span>© 2026 SMART TRAFFIC HUB</span>
            <span className="px-2 py-0.5 rounded border border-hud-border/40">DATA-SOURCE: 5G MQTT</span>
          </div>
          <div className="flex items-center gap-4">
            <span>SHA256-CHECKSUM OK</span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-hud-green" />
              SYS · NOMINAL
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
