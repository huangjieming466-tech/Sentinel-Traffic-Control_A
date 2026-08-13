#!/usr/bin/env python3
import serial
import time


class RS485RelayController:
    """
    4-channel RS485 Modbus relay controller.
    Relay mapping:
        relay 0 = red
        relay 1 = yellow
        relay 2 = green
        relay 3 = spare
    """

    RELAY_COMMANDS = {
        0: {
            True:  bytes.fromhex("01 05 00 00 FF 00 8C 3A"),
            False: bytes.fromhex("01 05 00 00 00 00 CD CA"),
        },
        1: {
            True:  bytes.fromhex("01 05 00 01 FF 00 DD FA"),
            False: bytes.fromhex("01 05 00 01 00 00 9C 0A"),
        },
        2: {
            True:  bytes.fromhex("01 05 00 02 FF 00 2D FA"),
            False: bytes.fromhex("01 05 00 02 00 00 6C 0A"),
        },
        3: {
            True:  bytes.fromhex("01 05 00 03 FF 00 7C 3A"),
            False: bytes.fromhex("01 05 00 03 00 00 3D CA"),
        },
    }

    def __init__(self, port="/dev/ttyUSB1", baudrate=9600, timeout=0.5):
        self.port = port
        self.baudrate = baudrate
        self.timeout = timeout
        self.ser = None
        self.last_state = None

    def open(self):
        try:
            self.ser = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                bytesize=8,
                parity=serial.PARITY_NONE,
                stopbits=1,
                timeout=self.timeout
            )
            print(f"[Relay] RS485 relay opened on {self.port}, baudrate={self.baudrate}")
            self.all_off()
            return True
        except Exception as e:
            print(f"[Relay] Failed to open RS485 relay: {e}")
            return False

    def close(self):
        try:
            self.all_off()
            if self.ser:
                self.ser.close()
                print("[Relay] RS485 relay closed")
        except Exception as e:
            print(f"[Relay] Close error: {e}")

    def _write_cmd(self, cmd):
        if not self.ser:
            return False
        try:
            self.ser.write(cmd)
            self.ser.flush()
            time.sleep(0.03)
            return True
        except Exception as e:
            print(f"[Relay] Write failed: {e}")
            return False

    def set_relay(self, relay_id, on):
        cmd = self.RELAY_COMMANDS[relay_id][on]
        return self._write_cmd(cmd)

    def all_off(self):
        self.set_relay(0, False)
        self.set_relay(1, False)
        self.set_relay(2, False)
        self.set_relay(3, False)

    def set_light(self, color):
        """
        color:
            "RED"
            "YELLOW"
            "GREEN"
            "OFF"
        """
        if color == self.last_state:
            return

        # 先全关，避免红黄绿同时亮
        self.all_off()

        if color == "RED":
            self.set_relay(0, True)
        elif color == "YELLOW":
            self.set_relay(1, True)
        elif color == "GREEN":
            self.set_relay(2, True)
        elif color == "OFF":
            pass
        else:
            print(f"[Relay] Unknown light color: {color}")
            self.set_relay(0, True)

        self.last_state = color