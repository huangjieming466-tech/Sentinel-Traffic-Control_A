# Traffic Light 前端监控

实时显示 A / B 两路红绿灯状态的监控网页。通过 MQTT over WebSocket 订阅开发板上报的灯态数据，浏览器直接渲染，无需后端服务。

## 技术栈

- React 19 + TypeScript
- Vite（构建）
- Tailwind CSS（样式）
- MQTT.js（订阅 EMQX）

## 功能

- 实时显示灯色（红 / 黄 / 绿）与倒计时（remainingSeconds）
- 多灯支持（`VITE_PRESET_LIGHT_IDS` 配置，预置 + 动态出现）
- 设备离线检测（30s 无数据标记 OFFLINE）
- 连接状态 / 消息日志 / 信号强度显示

## 环境变量（.env）

| 变量 | 说明 |
|------|------|
| `VITE_DATA_SOURCE` | `mock`（本地模拟数据）/ `real`（真实 MQTT） |
| `VITE_MQTT_WS_URL` | MQTT WebSocket 路径，默认 `/mqtt`（经 Nginx 代理到 EMQX 8083） |
| `VITE_ROUTER_IP` | 服务器 IP，默认 `129.226.138.87` |
| `VITE_PRESET_LIGHT_IDS` | 预置设备 ID 列表（逗号分隔），如 `TL-SINGLE-001,TL-NEXT-002` |

## MQTT 订阅

- 订阅 topic：`traffic/light/+/state`（`+` 匹配任意设备 ID）
- 消息字段：

```json
{
  "id": "TL-SINGLE-001",
  "color": "green",
  "remainingSeconds": 14,
  "totalSeconds": 0,
  "isOnline": true
}
```

## 开发

```bash
npm install
npm run dev
```

开发默认 `VITE_DATA_SOURCE=mock`（本地模拟，不需要连 MQTT）。要连真实 MQTT，改 `.env.development` 为 `real`。

## 构建 & 部署

```bash
npm run build          # 产物输出到 dist/
```

把 `dist/` 下的静态文件部署到服务器 Nginx 目录（当前为 `/var/www/traffic-static/traffic/`），配合 Nginx 的 `/mqtt` 反向代理到 EMQX 8083。

## 目录结构

```
src/
  App.tsx                       # 应用入口
  components/
    IntersectionOverview.tsx    # 路口总览
    TrafficLightDisplay.tsx     # 单个红绿灯卡片（灯色+倒计时）
    MessageFeed.tsx             # 消息日志
    SystemHeader.tsx            # 系统状态头
  hooks/useTrafficLight.ts      # 订阅 store 的 React hook
  repositories/
    NativeMqttRepository.ts     # 真实 MQTT 数据源
    RealTrafficLightRepository.ts
    MockTrafficLightRepository.ts  # 模拟数据源
  types/index.ts
```
