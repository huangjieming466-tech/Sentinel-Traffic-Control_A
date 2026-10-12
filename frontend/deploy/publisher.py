import paho.mqtt.client as mqtt
import time
import json
import random
import signal
import sys

# ======================================================================
# 智能红绿灯 · 上报脚本（香橙派 Orange Pi 3588 / 任意 Linux 板卡）
# 只发一个字段 color：red / yellow / green
# 部署位置：香橙派 ~/traffic-light/publisher.py
# 运行依赖：pip3 install paho-mqtt
# ======================================================================

# ==================== 【请根据实际情况修改这里】 ====================
MQTT_SERVER   = "129.226.138.87"   # 服务器公网 IP（不用改）
MQTT_PORT     = 1883                # MQTT TCP 端口（不用改）
LIGHT_ID      = "TL-SINGLE-001"     # 设备唯一 ID，固定不变
TOPIC         = f"traffic/light/{LIGHT_ID}/state"
# ====================================================================

client = mqtt.Client(client_id=LIGHT_ID, clean_session=False)


def on_connect(_c, _userdata, _flags, rc):
    code = {
        0: "连接成功",
        1: "协议版本错误",
        2: "Client ID 非法",
        3: "服务器不可用",
        4: "用户名/密码错误",
        5: "未授权",
    }.get(rc, f"未知错误 rc={rc}")
    print(f"[MQTT] {code} (rc={rc})")


def on_disconnect(_c, _userdata, rc):
    if rc == 0:
        print("[MQTT] 正常断开")
    else:
        print(f"[MQTT] 异常断开 rc={rc}，3 秒后自动重连...")


client.on_connect    = on_connect
client.on_disconnect = on_disconnect
client.connect_async(MQTT_SERVER, MQTT_PORT, keepalive=15)
client.loop_start()


# ---------- 灯色模拟：绿 -> 黄 -> 红 循环 ----------
# 【真实场景下删除这个块，直接从 GPIO/变量给 current_color 赋值】
PHASES = [
    ("green",  22),
    ("yellow",  3),
    ("red",    25),
]
phase_idx = 0
sec_left  = PHASES[phase_idx][1]
last_color: str | None = None


def sigint_handler(_signum, _frame):
    print("\n[EXIT] 正在断开 MQTT ...")
    client.loop_stop()
    client.disconnect()
    sys.exit(0)


signal.signal(signal.SIGINT,  sigint_handler)
signal.signal(signal.SIGTERM, sigint_handler)

print(f"[启动] 设备 ID  = {LIGHT_ID}")
print(f"[启动] Topic    = {TOPIC}")
print(f"[启动] Broker   = {MQTT_SERVER}:{MQTT_PORT}")
print(f"[启动] Ctrl + C 退出\n")

while True:
    # ==================================================================
    # 【真实场景下：在这里改写 current_color / total_sec 的来源】
    #   示例 1 - 直接赋值：
    #       current_color = "green"      # 或 "red" / "yellow"
    #       total_sec     = 22
    #
    #   示例 2 - 读 3 个 GPIO（BCM 编号，高电平=亮）：
    #       import RPi.GPIO as GPIO
    #       GPIO.setmode(GPIO.BCM)
    #       r, y, g = GPIO.input(17), GPIO.input(27), GPIO.input(22)
    #       if   g == 1: current_color, total_sec = "green",  22
    #       elif y == 1: current_color, total_sec = "yellow", 3
    #       else:        current_color, total_sec = "red",    25
    # ==================================================================
    current_color, total_sec = PHASES[phase_idx]
    remaining = max(1, sec_left)

    payload = {
        "id":               LIGHT_ID,
        "color":            current_color,
        "remainingSeconds": remaining,
        "totalSeconds":     total_sec,
        "signalStrength":   random.randint(65, 95),   # 无真实读数就写固定值 80
        "isOnline":         True,
    }

    try:
        info = client.publish(
            TOPIC,
            json.dumps(payload, ensure_ascii=False),
            qos=1,
            retain=True,           # 浏览器刚连上来就能拿到最后一次状态
        )
        if info.rc == mqtt.MQTT_ERR_SUCCESS:
            if current_color != last_color:
                print(f"🚦 变灯 → {current_color.upper():<6s}  倒计时 {remaining:>2d}/{total_sec}s  "
                      f"msg_id={info.mid}  t={time.strftime('%H:%M:%S')}")
            else:
                print(f"   · heartbeat  color={current_color:<6s}  "
                      f"倒计时 {remaining:>2d}/{total_sec}s  t={time.strftime('%H:%M:%S')}")
        else:
            print(f"[ERR] 发布失败 rc={info.rc}")
    except Exception as e:
        print(f"[ERR] 发布异常: {e}")

    last_color = current_color
    time.sleep(1)

    # ---------- 本地倒计时（真实场景下如自己管变灯，直接删掉这个块）----------
    sec_left -= 1
    if sec_left <= 0:
        phase_idx = (phase_idx + 1) % len(PHASES)
        sec_left  = PHASES[phase_idx][1]
    # --------------------------------------------------------------------
