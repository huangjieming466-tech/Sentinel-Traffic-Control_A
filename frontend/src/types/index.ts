export type LightColor = 'red' | 'yellow' | 'green' | 'red_yellow' | 'off' | 'unknown';

export interface TrafficLightState {
  id: string;
  name: string;
  direction: 'north_south' | 'east_west';
  color: LightColor;
  remainingSeconds: number;
  totalSeconds: number;
  isOnline: boolean;
  lastUpdated: string;
  signalStrength: number;
}

export interface MessageLog {
  id: string;
  timestamp: string;
  type: 'state_change' | 'decision' | 'connection' | 'warning' | 'info';
  lightId?: string;
  lightName?: string;
  content: string;
  level: 'debug' | 'info' | 'success' | 'warning' | 'error';
}

export interface SystemStatus {
  totalUptime: number;
  messagesProcessed: number;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
  lastHeartbeat: string;
  routerIp: string;
  signal5G: number;
}
