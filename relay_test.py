#!/usr/bin/env python3
"""
Relay Test — 独立测试 RS485 继电器红绿灯接线

依次点亮 红 → 黄 → 绿 → 全灭，每灯亮 3 秒，
循环 3 轮后自动退出。确认 3 个灯接线正确后再接正式代码。

接线对照：
  Relay 0 = 红灯
  Relay 1 = 黄灯
  Relay 2 = 绿灯
  Relay 3 = 备用

用法：
  python relay_test.py
"""

import time
import sys
from relay_controller import RS485RelayController


# ── 配置 ──
RELAY_PORT = "/dev/ttyUSB1"   # RS485 串口（和 LoRa 的 /dev/ttyUSB0 区分）
RELAY_BAUDRATE = 9600
TEST_ROUNDS = 3                # 测试轮数
STEP_SECONDS = 3               # 每灯亮几秒


def main():
    print("=" * 50)
    print("  RS485 Relay Traffic Light Test")
    print("=" * 50)
    print(f"  Port: {RELAY_PORT}  Baud: {RELAY_BAUDRATE}")
    print(f"  Rounds: {TEST_ROUNDS}  Step: {STEP_SECONDS}s each")
    print("-" * 50)

    relay = RS485RelayController(port=RELAY_PORT, baudrate=RELAY_BAUDRATE)

    if not relay.open():
        print("[FAIL] Cannot open relay — check USB connection")
        sys.exit(1)

    try:
        for round_num in range(1, TEST_ROUNDS + 1):
            print(f"\n--- Round {round_num}/{TEST_ROUNDS} ---")

            print("  [RED]    → 红灯亮")
            relay.set_light("RED")
            time.sleep(STEP_SECONDS)

            print("  [YELLOW] → 黄灯亮")
            relay.set_light("YELLOW")
            time.sleep(STEP_SECONDS)

            print("  [GREEN]  → 绿灯亮")
            relay.set_light("GREEN")
            time.sleep(STEP_SECONDS)

            print("  [OFF]    → 全灭")
            relay.set_light("OFF")
            time.sleep(1)

        print("\n[PASS] All rounds complete — relay wiring OK")

    except KeyboardInterrupt:
        print("\n[STOP] User interrupt")
    finally:
        relay.close()
        print("[DONE] Relay closed")


if __name__ == "__main__":
    main()
