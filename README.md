# Sentinel Traffic Control

双板协同智能交通灯控制系统。基于 Rockchip NPU + YOLOv8 边缘推理 + LoRa 无线协同 + RS485 Modbus 继电器 + MQTT 实时监控。

## 系统架构

```
┌─────────────── 板 A（主控）───────────────┐      LoRa       ┌─────────────── 板 B（从属）───────────────┐
│ 摄像头 → NPU 检测 Road A 车辆              │◄───────────────►│ 摄像头 → NPU 检测 Road B 车辆              │
│   ↓                                       │  B→A: DET:...   │   ↓                                       │
│ TrafficLightAllocator（Patience Score 决策）│  A→B: LIGHT:... │  跟随 A 板指令 / 断联时本地 fallback       │
│   ↓                                       │                 │   ↓                                       │
│ RS485 继电器（A 方向红绿灯）               │                 │  RS485 继电器（B 方向红绿灯）              │
└──────────────────────────────────────────┘                 └──────────────────────────────────────────┘
                    ↓ publisher.py（每 1s 上传真实灯态）                    ↓
                    └────────────────── MQTT (EMQX) ──────────────────────┘
                                            ↓
                               前端网页（frontend/）实时显示两路灯态
```

## 文件说明

| 文件 | 部署位置 | 说明 |
|------|---------|------|
| `traffic_master_safety_v2.py` | 板 A | 主控：NPU 检测 + 接收 B 数据 + 决策 + 发指令 + 继电器控制 + 写灯态 |
| `traffic_slave_safety_v2.py` | 板 B | 从属：NPU 检测 + 上报数据 + 跟随 A 指令 + fallback + 继电器控制 |
| `traffic_light_allocator.py` | 板 A | 核心决策器：Patience Score + 中位数滤波 + 状态机 |
| `relay_controller.py` | 两板 | RS485 继电器驱动 + `read_status()` 读真实灯态 |
| `publisher.py` | 两板 | 读真实灯态 → MQTT 发布（断线自动重连） |
| `frontend/` | 服务器 | 前端监控网页（React + TS + Vite + MQTT.js） |

## 状态机

```
GREEN_A → YELLOW_A → ALL_RED_A → RED_YELLOW_B → GREEN_B → YELLOW_B → ALL_RED_B → RED_YELLOW_A → 循环
```

- **红黄同亮过渡**（`RED_YELLOW_*`）：红转绿前，红灯保持亮起 + 黄灯叠加 2 秒，不先熄灭
- **Patience Score**：`车辆数 + 等待时间/10`，等得越久分数越高
- **切换条件**：对方路车数 ≥ 阈值（当前 1 辆）且 `对方 score > 本方 × 1.5` 持续 2 秒
- **强制切换**：单次绿灯最长 15 秒

## 关键参数

| 参数 | 值 |
|------|-----|
| 最小绿灯 | 8s |
| 最大绿灯 | 15s |
| 黄灯 | 3s |
| 全红 | 15s |
| 红黄同亮 | 2s |
| 换灯车数阈值 | 1 辆 |

## LoRa 通信协议

| 方向 | 格式 | 间隔 |
|------|------|------|
| B → A | `DET:car:2,motorcycle:0,bus:1,truck:1` | 737ms |
| A → B | `LIGHT:GREEN_A,25` | 511ms |

> 511ms / 737ms 质数间隔，避免半双工同频碰撞。

## MQTT 上报

- Broker：`129.226.138.87:1883`（EMQX）
- Topic：`traffic/light/<设备ID>/state`
- 设备 ID：板 A = `TL-SINGLE-001`，板 B = `TL-NEXT-002`
- 报文字段：`id` / `color`(green/yellow/red) / `remainingSeconds` / `isOnline`

## 容错设计

| 故障 | 行为 |
|------|------|
| 摄像头掉线 | 灯控照常运行，检测计数归零，退化为固定时序状态机 |
| 一边摄像头失效 | 两边 count 归零，对称固定时序 |
| LoRa 断联 | B 板本地 fallback 状态机，从最后状态无缝接续 |
| 继电器无响应 | `read_status()` 读不到 → `actual=null` → 上报 `isOnline=false` |
| publisher 断网 | 指数退避自动重连（1s→30s） |
| USB 串口漂移 | 使用 `/dev/serial/by-id/` 路径固定设备 |

## 运行

**板 A：**
```bash
cd Sentinel-Traffic-Control_A
python3 traffic_master_safety_v2.py
python3 publisher.py
```

**板 B：**
```bash
cd Sentinel-Traffic-Control_B
python3 traffic_slave_safety_v2.py
python3 publisher.py
```

开机自启动：主程序和 publisher 均已配置 `~/.config/autostart/*.desktop`。

## 硬件

- Rockchip RK3588 开发板 ×2（NPU 6 TOPS）
- LoRa 透传模块（FTDI FT232R，115200 波特率）
- RS485 Modbus 继电器模块（9600 波特率，4 通道：红/黄/绿/备用）
- USB 摄像头 / 海康网络摄像头（RTSP）
- YOLOv8n RKNN 模型

## 前端

前端源码在 `frontend/` 目录，详见 [frontend/README.md](frontend/README.md)。
