import { MockTrafficLightRepository } from './MockTrafficLightRepository';
import { RealTrafficLightRepository } from './RealTrafficLightRepository';
import { NativeMqttRepository } from './NativeMqttRepository';
import type { ITrafficLightRepository } from './ITrafficLightRepository';

export * from './ITrafficLightRepository';
export * from './MockTrafficLightRepository';
export * from './RealTrafficLightRepository';
export * from './NativeMqttRepository';

export const MQTT_IMPL = (() => {
  const v = (import.meta.env.VITE_MQTT_IMPL as string | undefined)?.toLowerCase() ?? 'native';
  if (v === 'mqttjs') return 'mqttjs';
  return 'native';
})();

export const createTrafficLightRepository = (): ITrafficLightRepository => {
  const useMock = import.meta.env.VITE_DATA_SOURCE !== 'real';
  if (useMock) {
    return new MockTrafficLightRepository();
  }
  // 默认用「原生 WebSocket + 手写 MQTT 协议栈」绕开 mqtt.js 在 Nginx 反代 EMQX WS 下的状态机死锁
  // 要切回 mqtt.js 把 .env.production 的 VITE_MQTT_IMPL 改成 mqttjs 再 build 即可
  if (MQTT_IMPL === 'native') return new NativeMqttRepository();
  return new RealTrafficLightRepository();
};
