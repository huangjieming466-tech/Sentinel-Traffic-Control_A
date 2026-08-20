                           #!/usr/bin/env python3
"""
traffic_master.py - Board A Master Controller
=============================================
Runs on: 192.168.20.175 (hkcrc1)

This is the master traffic light controller. It:
  1. Detects vehicles on Road A via NPU (YOLOv8-RKNN)
  2. Receives Road B vehicle counts from Board B via LoRa
  3. Runs the TrafficLightAllocator state machine
  4. Sends light state commands to Board B via LoRa
  5. Displays Road A camera feed with traffic light overlay

LoRa Protocol:
  B → A:  DET:car:N,motorcycle:N,bus:N,truck:N
  A → B:  LIGHT:<STATE>,<REMAINING_SECONDS>
           e.g. LIGHT:GREEN_A,25
"""

import os
import sys
import threading
import time
import serial
from collections import deque

os.environ["GLOG_minloglevel"] = "3"
os.environ["RKNN_LOG_LEVEL"] = "0"
os.environ["QT_LOGGING_RULES"] = "*.warning=false"
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|timeout;5000000"
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|timeout;5000000"
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"

# Auto-detect DISPLAY from available X sockets
def _find_display():
    if os.environ.get("DISPLAY"):
        return
    import glob
    sockets = glob.glob("/tmp/.X11-unix/X*")
    for s in sorted(sockets):
        n = int(s.rsplit("X", 1)[-1])
        if n < 100:  # skip GDM sockets (X1024 etc)
            os.environ["DISPLAY"] = f":{n}"
            return
    os.environ["DISPLAY"] = ":0"  # fallback
_find_display()

import cv2
import numpy as np
from rknnlite.api import RKNNLite

# Import the allocator (same directory)
from traffic_light_allocator import TrafficLightAllocator, TrafficState
from relay_controller import RS485RelayController

# ──────────────────────────────────────────────
#  Configuration
# ──────────────────────────────────────────────

#CAMERA_SOURCE = 0
CAMERA_SOURCE = "rtsp://admin:HKcrc3130@192.168.1.64:554/h264/ch1/main/av_stream"

MODEL_PATH = "/home/hkcrc1/Sentinel-Traffic-Control_A/yolov8n.rknn"
SERIAL_PORT = "/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_BG041706-if00-port0"
BAUDRATE = 115200

# RS485 relay board for real traffic light output
# NOTE: LoRa uses /dev/ttyUSB0, so RS485 relay normally uses /dev/ttyUSB1
RELAY_PORT = "/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_BH002IVA-if00-port0"
RELAY_BAUDRATE = 9600

CONF_THRESHOLD = 0.15
IOU_THRESHOLD = 0.45

# Vehicle classes (COCO): car, motorcycle, bus, truck
TARGET_CLASS_IDS = [2, 3, 5, 7]
TARGET_CLASS_NAMES = ["car", "motorcycle", "bus", "truck"]

# How often to send LIGHT commands to Board B (seconds)
LIGHT_SEND_INTERVAL = 0.511

# Maximum age of Board B data before considering it stale (seconds)
B_DATA_TIMEOUT = 2.0

COCO_CLASSES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
    'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
    'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
    'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
    'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
    'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
    'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
    'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
    'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
    'hair drier', 'toothbrush'
]


# ──────────────────────────────────────────────
#  YOLOv8 Fast Post-Processor (from lora_detect_send.py)
# ──────────────────────────────────────────────

class YOLOv8_Fast_PostProcess:
    """Fast RKNN post-processor for YOLOv8 detection heads."""

    def __init__(self, conf_threshold=0.35, iou_threshold=0.45):
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold
        self.strides = [8, 16, 32]
        self.reg_max = 16
        self.classes = COCO_CLASSES

    def _softmax(self, x, axis=-1):
        e_x = np.exp(x - np.max(x, axis=axis, keepdims=True))
        return e_x / e_x.sum(axis=axis, keepdims=True)

    def process(self, outputs, ori_w, ori_h):
        all_boxes, all_confs, all_class_ids = [], [], []
        for i in range(3):
            stride = self.strides[i]
            box_head = np.squeeze(outputs[i * 3])
            cls_head = np.squeeze(outputs[i * 3 + 1])
            score_head = np.squeeze(outputs[i * 3 + 2])
            _, h, w = box_head.shape
            box_head = box_head.reshape(64, -1).T
            cls_head = cls_head.reshape(80, -1).T
            score_head = score_head.reshape(-1, 1)
            scores = cls_head * score_head
            max_scores = np.max(scores, axis=1)
            class_ids = np.argmax(scores, axis=1)
            keep_idx = max_scores > self.conf_threshold
            if not np.any(keep_idx):
                continue
            filtered_boxes_raw = box_head[keep_idx]
            filtered_scores = max_scores[keep_idx]
            filtered_class_ids = class_ids[keep_idx]
            num_kept = filtered_boxes_raw.shape[0]
            filtered_boxes_raw = filtered_boxes_raw.reshape(num_kept, 4, self.reg_max)
            filtered_boxes_raw = self._softmax(filtered_boxes_raw, axis=-1)
            acc_matrix = np.arange(self.reg_max, dtype=np.float32)
            box_decoded = np.sum(filtered_boxes_raw * acc_matrix, axis=-1) * stride
            grid_y, grid_x = np.indices((h, w), dtype=np.float32)
            grid_x = grid_x.flatten()[keep_idx]
            grid_y = grid_y.flatten()[keep_idx]
            anchor_x = (grid_x + 0.5) * stride
            anchor_y = (grid_y + 0.5) * stride
            x1 = anchor_x - box_decoded[:, 0]
            y1 = anchor_y - box_decoded[:, 1]
            x2 = anchor_x + box_decoded[:, 2]
            y2 = anchor_y + box_decoded[:, 3]
            rx1 = (x1 * (ori_w / 640.0)).astype(np.int32)
            ry1 = (y1 * (ori_h / 640.0)).astype(np.int32)
            rw = ((x2 - x1) * (ori_w / 640.0)).astype(np.int32)
            rh = ((y2 - y1) * (ori_h / 640.0)).astype(np.int32)
            all_boxes.extend(np.stack([rx1, ry1, rw, rh], axis=1).tolist())
            all_confs.extend(filtered_scores.astype(float).tolist())
            all_class_ids.extend(filtered_class_ids.tolist())
        indices = cv2.dnn.NMSBoxes(all_boxes, all_confs, self.conf_threshold, self.iou_threshold)
        results = []
        if len(indices) > 0:
            for i in indices.flatten():
                results.append({
                    'box': all_boxes[i],
                    'conf': all_confs[i],
                    'class': self.classes[all_class_ids[i]]
                })
        return results


# ──────────────────────────────────────────────
#  RTSP Stream Reader (threaded camera capture)
# ──────────────────────────────────────────────

class RTSPStreamReader:
    """Threaded video capture for smooth frame reading."""

    def __init__(self, capture):
        self.cap = capture
        self.ret = False
        self.frame = None
        self.stopped = False

    def start(self):
        threading.Thread(target=self.update, args=(), daemon=True).start()
        return self

    def update(self):
        while not self.stopped:
            if not self.cap.isOpened():
                break
            self.ret, self.frame = self.cap.read()
            if not self.ret:
                self.stopped = True

    def read_latest(self):
        return self.ret, self.frame

    def stop(self):
        self.stopped = True


# ──────────────────────────────────────────────
#  LoRa Communication (duplex: send LIGHT, receive DET)
# ──────────────────────────────────────────────

class LoRaDuplex:
    """
    Bidirectional LoRa serial communication.

    - Receives DET messages from Board B (background thread)
    - Sends LIGHT commands to Board B
    """

    def __init__(self, port, baudrate, timeout=2):
        self.port = port
        self.baudrate = baudrate
        self.ser = None
        self.running = False
        self._reconnecting = False

        # Latest received data from Board B
        self.lock = threading.Lock()
        self.b_counts = {name: 0 for name in TARGET_CLASS_NAMES}
        self.b_total = 0
        self.b_last_update = 0.0  # timestamp of last valid DET from B
        self.ack_count = 0
        self.last_ack_time = 0.0

    def _reconnect(self):
        """Reconnect serial after USB unplug/replug (I/O error)."""
        if self._reconnecting:
            return
        self._reconnecting = True
        if self.ser:
            try:
                self.ser.close()
            except Exception:
                pass
            self.ser = None
        delay = 2.0
        while self.running:
            try:
                self.ser = serial.Serial(self.port, self.baudrate, timeout=2)
                print(f"[LoRa] Reconnected to {self.port}")
                break
            except Exception as e:
                print(f"[LoRa] Reconnect failed, retry in {delay:.0f}s: {e}")
                time.sleep(delay)
                delay = min(delay * 2, 10.0)
        self._reconnecting = False

    def open(self):
        try:
            self.ser = serial.Serial(self.port, self.baudrate, timeout=2)
            print(f"[LoRa] Serial {self.port} opened (baudrate={self.baudrate})")
            return True
        except Exception as e:
            print(f"[LoRa] Error: cannot open serial {self.port}: {e}")
            return False

    def start_receiver(self):
        """Start background thread to listen for Board B messages."""
        self.running = True
        t = threading.Thread(target=self._receive_loop, daemon=True)
        t.start()
        print("[LoRa] Receiver thread started")

    def _receive_loop(self):
        while self.running:
            try:
                if self.ser and self.ser.in_waiting > 0:
                    raw = self.ser.readline()
                    if raw:
                        msg = raw.decode('utf-8', errors='ignore').strip()
                        self._handle_message(msg)
            except Exception as e:
                if 'Input/output error' in str(e) or 'Errno 5' in str(e):
                    print(f"  [LoRa] I/O error, reconnecting...")
                    self._reconnect()
                else:
                    print(f"  [LoRa] receive error: {e}")
            time.sleep(0.05)

    def _handle_message(self, msg):
        """Parse incoming messages from Board B."""
        if msg.startswith("DET:"):
            # Board B is sending its detection results
            # Format: DET:car:3,motorcycle:1,bus:0,truck:2
            data = msg[4:]
            pairs = data.split(",")
            with self.lock:
                total = 0
                for pair in pairs:
                    if ":" in pair:
                        cls_name, count_str = pair.split(":", 1)
                        try:
                            count = int(count_str)
                        except ValueError:
                            count = 0
                        if cls_name in self.b_counts:
                            self.b_counts[cls_name] = count
                            total += count
                self.b_total = total
                self.b_last_update = time.time()
        elif msg == "ACK":
            self.last_ack_time = time.time()
            self.ack_count += 1
        elif msg.startswith("PING"):
            self._send_raw("PONG")
        else:
            # Unknown message, ignore silently
            pass

    def send_light_command(self, state, remaining):
        """
        Send traffic light state to Board B.
        Format: LIGHT:<STATE>,<REMAINING>
        Example: LIGHT:GREEN_A,25
        """
        msg = f"LIGHT:{state.name},{remaining:.0f}"
        self._send_raw(msg)

    def _send_raw(self, message):
        """Send a raw string over LoRa serial."""
        if self.ser:
            try:
                data = (message + "\n").encode('utf-8')
                self.ser.write(data)
                return True
            except Exception as e:
                if 'Input/output error' in str(e) or 'Errno 5' in str(e):
                    print(f"  [LoRa] I/O error on send, reconnecting...")
                    self._reconnect()
                else:
                    print(f"  [LoRa] send failed: {e}")
                return False
        return False

    def get_b_data(self):
        """Thread-safe read of Board B's latest detection data."""
        with self.lock:
            return dict(self.b_counts), self.b_total, self.b_last_update

    def is_b_data_fresh(self):
        """Check if Board B data is recent enough."""
        with self.lock:
            if self.b_last_update == 0.0:
                return False
            return (time.time() - self.b_last_update) < B_DATA_TIMEOUT

    def close(self):
        self.running = False
        if self.ser:
            self.ser.close()
            print("[LoRa] serial closed")



# ──────────────────────────────────────────────
#  Visualization
# ──────────────────────────────────────────────

def draw_traffic_light(frame, x, y, color, radius=30):
    """Draw a simulated traffic light circle."""
    cv2.circle(frame, (x, y), radius, color, -1)
    cv2.circle(frame, (x, y), radius, (255, 255, 255), 2)


def draw_master_display(frame, detections, class_counts, total_count,
                         allocator, b_counts, b_total, b_fresh, fps):
    """
    Draw the master control panel overlay on the frame.

    Layout (left side, top to bottom):
      - Detection summary
      - Traffic light state
      - Board B remote data
    """
    h, w = frame.shape[:2]

    # ── Left panel background ──
    panel_w = 240
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (panel_w, h), (40, 40, 40), -1)
    cv2.addWeighted(overlay, 0.5, frame, 0.5, 0, frame)

    y = 30
    font = cv2.FONT_HERSHEY_SIMPLEX

    # ── Title ──
    cv2.putText(frame, "MASTER (Board A)", (10, y), font, 0.7, (0, 255, 255), 2)
    y += 30

    # ── Road A detection ──
    cv2.putText(frame, "--- Road A (Local) ---", (10, y), font, 0.5, (200, 200, 200), 1)
    y += 22
    for cls_name in TARGET_CLASS_NAMES:
        cnt = class_counts.get(cls_name, 0)
        cv2.putText(frame, f"  {cls_name}: {cnt}", (10, y), font, 0.5, (255, 255, 255), 1)
        y += 20
    cv2.putText(frame, f"  TOTAL: {total_count}", (10, y), font, 0.6, (0, 255, 0), 1)
    y += 28

    # ── Road B detection (from LoRa) ──
    cv2.putText(frame, "--- Road B (Remote) ---", (10, y), font, 0.5, (200, 200, 200), 1)
    y += 22
    if b_fresh:
        for cls_name in TARGET_CLASS_NAMES:
            cnt = b_counts.get(cls_name, 0)
            cv2.putText(frame, f"  {cls_name}: {cnt}", (10, y), font, 0.5, (255, 255, 255), 1)
            y += 20
        cv2.putText(frame, f"  TOTAL: {b_total}", (10, y), font, 0.6, (0, 255, 0), 1)
    else:
        cv2.putText(frame, "  NO DATA", (10, y), font, 0.5, (0, 0, 255), 1)
    y += 28

    # ── Light state ──
    state = allocator.current_state
    cv2.putText(frame, "--- Light State ---", (10, y), font, 0.5, (200, 200, 200), 1)
    y += 22
    cv2.putText(frame, f"  {state.name}", (10, y), font, 0.6, (0, 255, 255), 2)
    y += 24
    cv2.putText(frame, f"  Remaining: {allocator.remaining_time:.1f}s", (10, y), font, 0.5, (255, 255, 255), 1)
    y += 22
    cv2.putText(frame, f"  Switches: {allocator.total_switches}", (10, y), font, 0.5, (200, 200, 200), 1)
    y += 22
    cv2.putText(frame, f"  Reason: {allocator.last_switch_reason}", (10, y), font, 0.4, (180, 180, 180), 1)
    y += 28

    # ── FPS ──
    cv2.putText(frame, f"FPS: {fps:.1f}", (10, h - 15), font, 0.5, (0, 255, 0), 1)

    # ── Right side: Traffic lights ──
    light_x = w - 60
    light_y = 80

    # Status text (computed first for positioning)
    a_status = "GO" if allocator.is_green_a else ("YIELD" if allocator.current_state == TrafficState.YELLOW_A else "STOP")
    b_status = "GO" if allocator.is_green_b else ("YIELD" if allocator.current_state == TrafficState.YELLOW_B else "STOP")
    a_color = (0, 255, 0) if allocator.is_green_a else (0, 255, 255) if allocator.current_state == TrafficState.YELLOW_A else (0, 0, 255)
    b_color = (0, 255, 0) if allocator.is_green_b else (0, 255, 255) if allocator.current_state == TrafficState.YELLOW_B else (0, 0, 255)

    # Road A: label left of circle, status below circle
    cv2.putText(frame, "A", (light_x - 35, light_y + 8), font, 0.8, (255, 255, 255), 2)
    draw_traffic_light(frame, light_x, light_y, allocator.color_a, 25)
    cv2.putText(frame, a_status, (light_x - 20, light_y + 48), font, 0.5, a_color, 2)

    # Road B: label left of circle, status below circle
    cv2.putText(frame, "B", (light_x - 35, light_y + 82), font, 0.8, (255, 255, 255), 2)
    draw_traffic_light(frame, light_x, light_y + 70, allocator.color_b, 25)
    cv2.putText(frame, b_status, (light_x - 20, light_y + 118), font, 0.5, b_color, 2)

    return frame


# ──────────────────────────────────────────────
#  Main
# ──────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Traffic Master Controller (Board A)")
    print("  Road A: local NPU detection")
    print("  Road B: LoRa remote data from Board B")
    print("=" * 60)

    # ── 1. Init NPU ──
    print("[NPU] Loading RKNN model...")
    rknn = RKNNLite()
    ret = rknn.load_rknn(MODEL_PATH)
    if ret != 0:
        print(f"[NPU] model load failed, ret={ret}")
        sys.exit(ret)
    rknn.init_runtime()
    print("[NPU] NPU ready")

    post_processor = YOLOv8_Fast_PostProcess(
        conf_threshold=CONF_THRESHOLD, iou_threshold=IOU_THRESHOLD)

    # ── 2. Init Camera ──
    print(f"[CAM] Opening camera: {CAMERA_SOURCE}")
    cap = cv2.VideoCapture(CAMERA_SOURCE)
    if not cap.isOpened():
        print(f"[CAM] Error: cannot open camera {CAMERA_SOURCE}")
        rknn.release()
        sys.exit(1)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    stream_reader = RTSPStreamReader(cap).start()
    time.sleep(1.0)
    print("[CAM] Camera ready")

    # ── 3. Init LoRa ──
    print("[LoRa] Initializing serial...")
    lora = LoRaDuplex(SERIAL_PORT, BAUDRATE)
    if not lora.open():
        print("[LoRa] ERROR: Check LoRa module connection")
        cap.release()
        rknn.release()
        sys.exit(1)
    lora.start_receiver()
    print("[LoRa] Duplex communication ready")

    # ── 4. Init Allocator ──
    allocator = TrafficLightAllocator()
    print("[Allocator] Traffic light state machine ready")

    # ── 4.5 Init RS485 Relay Output ──
    relay = RS485RelayController(RELAY_PORT, RELAY_BAUDRATE)
    if not relay.open():
        print("[Relay] ERROR: Check RS485 relay board connection")
        lora.close()
        stream_reader.stop()
        cap.release()
        rknn.release()
        relay = None
    else:
        print("[Relay] A-side traffic light output ready")

    # ── 5. Main Loop ──
    frame_count = 0
    last_light_send = 0
    fps = 0.0
    fps_smooth = deque(maxlen=30)

    print("\n[MAIN] Starting traffic control loop (Ctrl+C to exit)")
    print("-" * 60)

    try:
        while True:
            frame_start = time.time()

            # ── Read camera ──
            ret, frame = stream_reader.read_latest()
            if not ret or frame is None:
                time.sleep(0.01)
                continue
            frame_count += 1
            ori_h, ori_w = frame.shape[:2]

            # ── NPU inference ──
            img = cv2.resize(frame, (640, 640))
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            img = np.expand_dims(img, axis=0)
            outputs = rknn.inference(inputs=[img])
            detections = post_processor.process(outputs, ori_w, ori_h)

            # ── Count Road A vehicles ──
            class_counts = {name: 0 for name in TARGET_CLASS_NAMES}
            for det in detections:
                cls_name = det['class']
                conf_score = det['conf']
                if cls_name in class_counts:
                    class_counts[cls_name] += 1
                    # Draw bounding box
                    x, y_b, w_box, h_box = det['box']
                    label = f"{cls_name} {conf_score:.2f}"
                    cv2.rectangle(frame, (x, y_b), (x + w_box, y_b + h_box), (0, 255, 0), 2)
                    cv2.putText(frame, label, (x, max(y_b - 10, 20)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            count_a = sum(class_counts.values())

            # ── Get Road B data from LoRa ──
            b_counts, count_b, b_last_update = lora.get_b_data()
            b_fresh = lora.is_b_data_fresh()

            # When B data is stale, reset count_b = 0.
            # Pure MAX_GREEN_TIME state machine, no congestion guesses.

            # ── Reset B data when stale ──
            if not b_fresh:
                count_b = 0

            # ── Run allocator ──
            state, remaining, color_a, color_b, is_green_a, is_green_b, score_a, score_b = \
                allocator.update(count_a, count_b)

            # ── Drive A-side real traffic light through RS485 relay ──
            if state == TrafficState.GREEN_A:
                if relay is not None: relay.set_light("GREEN")
            elif state == TrafficState.YELLOW_A:
                if relay is not None: relay.set_light("YELLOW")
            elif state == TrafficState.RED_YELLOW_A:
                if relay is not None: relay.set_light("RED_YELLOW")
            else:
                if relay is not None: relay.set_light("RED")

            # ── Send light command to Board B (periodic) ──
            now = time.time()
            if now - last_light_send > LIGHT_SEND_INTERVAL:
                lora.send_light_command(state, remaining)
                last_light_send = now

            # ── Draw master display ──
            frame = draw_master_display(
                frame, detections, class_counts, count_a,
                allocator, b_counts, count_b, b_fresh, fps)

            # ── Show ──
            show_frame = cv2.resize(frame, (1280, 720))
            cv2.imshow("Traffic Master (Board A)", show_frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break
            elif key == ord('r'):
                # Manual reset
                allocator.reset()
                print("[MAIN] Allocator manually reset")

            # ── FPS ──
            elapsed = time.time() - frame_start
            if elapsed > 0:
                fps_smooth.append(1.0 / elapsed)
            fps = np.mean(fps_smooth) if fps_smooth else 0

            # ── Status print (every 30 frames) ──
            if frame_count % 30 == 0:
                b_info = f"B_total={count_b}" if b_fresh else "B=NO_DATA"
                print(f"  [{state.name}] A_count={count_a} {b_info} "
                      f"remaining={remaining:.1f}s FPS={fps:.1f}")

    except KeyboardInterrupt:
        print("\n[MAIN] User interrupt")
    finally:
        if relay is not None: relay.close()
        lora.close()
        stream_reader.stop()
        cap.release()
        rknn.release()
        cv2.destroyAllWindows()
        print("[MAIN] Resources released, exiting")


if __name__ == '__main__':
    main()
