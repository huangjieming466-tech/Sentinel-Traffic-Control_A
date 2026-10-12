import type { TrafficLightState, MessageLog, SystemStatus } from '../types';

export type LightStateCallback = (state: TrafficLightState) => void;
export type MessageCallback = (message: MessageLog) => void;
export type StatusCallback = (status: SystemStatus) => void;

export interface ITrafficLightRepository {
  getLights(): Promise<TrafficLightState[]>;
  getMessages(limit?: number): Promise<MessageLog[]>;
  getSystemStatus(): Promise<SystemStatus>;
  subscribeLightState(lightId: string, callback: LightStateCallback): () => void;
  subscribeAllLights(callback: LightStateCallback): () => void;
  subscribeMessages(callback: MessageCallback): () => void;
  subscribeSystemStatus(callback: StatusCallback): () => void;
  connect(): Promise<void>;
  disconnect(): void;
}
