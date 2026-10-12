import { useEffect, useMemo, useState } from 'react';
import { createTrafficLightRepository } from '../repositories';
import type { ITrafficLightRepository } from '../repositories';
import type { MessageLog, SystemStatus, TrafficLightState } from '../types';

let sharedRepository: ITrafficLightRepository | null = null;

export function useTrafficLightRepository(): ITrafficLightRepository {
  if (sharedRepository == null) {
    sharedRepository = createTrafficLightRepository();
  }
  return sharedRepository;
}

export function useTrafficLights() {
  const repo = useTrafficLightRepository();
  const [lights, setLights] = useState<Record<string, TrafficLightState>>({});

  useEffect(() => {
    let cancelled = false;
    repo.getLights().then((list) => {
      if (cancelled) return;
      const map: Record<string, TrafficLightState> = {};
      list.forEach((l) => (map[l.id] = l));
      setLights((prev) => ({ ...prev, ...map }));
    });
    const unsub = repo.subscribeAllLights((state) => {
      setLights((prev) => ({ ...prev, [state.id]: { ...state } }));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [repo]);

  const lightList = useMemo(() => Object.values(lights), [lights]);
  return { lights, lightList };
}

export function useMessageLog(limit = 100) {
  const repo = useTrafficLightRepository();
  const [messages, setMessages] = useState<MessageLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    repo.getMessages(limit).then((list) => {
      if (!cancelled) setMessages(list);
    });
    const queue: MessageLog[] = [];
    let pending = false;
    const flush = () => {
      pending = false;
      const batch = queue.splice(0);
      setMessages((prev) => {
        const seen = new Set<string>();
        const next: MessageLog[] = [];
        for (const m of [...batch.reverse(), ...prev]) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            next.push(m);
            if (next.length >= limit) break;
          }
        }
        return next;
      });
    };
    const unsub = repo.subscribeMessages((msg) => {
      queue.push(msg);
      if (!pending) {
        pending = true;
        queueMicrotask(flush);
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [repo, limit]);

  return messages;
}

export function useSystemStatus() {
  const repo = useTrafficLightRepository();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  useEffect(() => {
    repo.getSystemStatus().then((s) => setStatus(s));
    return repo.subscribeSystemStatus((s) => setStatus({ ...s }));
  }, [repo]);
  return status;
}

export function useRepoConnection() {
  const repo = useTrafficLightRepository();
  useEffect(() => {
    repo.connect();
    return () => repo.disconnect();
  }, [repo]);
}
