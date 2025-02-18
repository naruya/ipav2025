import argparse
import asyncio
import logging
import threading
import queue
import time
from PIL import Image, ImageTk
import cv2
import tkinter as tk
import json

from aiortc import (
    RTCIceCandidate,
    RTCPeerConnection,
    RTCConfiguration,
    RTCIceServer,
    RTCSessionDescription,
)
from aiortc.contrib.signaling import add_signaling_arguments, BYE

from utils import SimpleSignaling, CopyAndPasteSignaling


class MediaConsumer:
    def __init__(self) -> None:
        self.__tracks = {}
        self.frame_queue = queue.Queue()

    def addTrack(self, track):
        if track not in self.__tracks:
            self.__tracks[track] = None

    async def start(self) -> None:
        for track, task in self.__tracks.items():
            if task is None:
                self.__tracks[track] = asyncio.ensure_future(self._display_frames(track))

    async def stop(self) -> None:
        for task in self.__tracks.values():
            if task is not None:
                task.cancel()
        self.__tracks = {}

    async def _display_frames(self, track):
        while True:
            try:
                frame = await track.recv()
            except Exception as e:
                print("Frame receiving stopped:", e)
                break

            img = frame.to_ndarray(format="bgr24")
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(img)
            # 最新フレームのみキープ
            while not self.frame_queue.empty():
                self.frame_queue.get_nowait()
            self.frame_queue.put(pil_img)

    def empty(self):
        return self.frame_queue.empty()

    def get_nowait(self):
        return self.frame_queue.get_nowait()


async def run(pc, recorder, signaling, root):
    @pc.on("track")
    def on_track(track):
        print("Receiving %s" % track.kind)
        if track.kind == "video":
            recorder.addTrack(track)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        print("Connection state is %s" % pc.connectionState)
        if pc.connectionState == "connected":
            print("Connection established")
        if pc.connectionState == "disconnected":
            print("Connection disconnected")
            await signaling.disconnect()
        if pc.connectionState == "closed":
            print("Connection closed")
            await signaling.disconnect()

    # TODO: Assign to other listeners
    # receive sample
    @pc.on("datachannel")
    def on_datachannel(channel):
        if channel.label == "test_js":
            @channel.on("message")
            def on_message(message):
                print(channel.label, "<", message)

    # send sample
    data_channel = pc.createDataChannel("test_py")

    @data_channel.on("open")
    def on_open():
        data_channel.send("Hello from Python!")

    # signaling の接続開始
    await signaling.connect()

    while True:
        try:
            obj = await signaling.receive()
        except json.decoder.JSONDecodeError as e:
            print(e)
            print("****************************************************")
            print("*** This may be due to a small N_TTY_BUF_SIZE.   ***")
            print("*** A simple solution is to set a short OFFER.   ***")
            print("****************************************************")
            raise

        if isinstance(obj, RTCSessionDescription):
            await pc.setRemoteDescription(obj)
            await recorder.start()

            # Answer返す
            await pc.setLocalDescription(await pc.createAnswer())
            await signaling.send(pc.localDescription)

        elif isinstance(obj, RTCIceCandidate):
            await pc.addIceCandidate(obj)

        elif obj is BYE:
            print("Exiting")
            root.after(0, root.destroy)
            break


def run_tk_window(root, recorder):
    root.title("Viewer")
    label = tk.Label(root)
    label.pack()

    fps_label = tk.Label(root, text="FPS: --")
    fps_label.pack()

    frame_count = 0
    last_time = time.time()

    def update_label():
        nonlocal frame_count, last_time
        if not recorder.empty():
            pil_img = recorder.get_nowait()
            tk_img = ImageTk.PhotoImage(pil_img)
            label.config(image=tk_img)
            label.image = tk_img

            # FPS計測
            frame_count += 1
            now = time.time()
            elapsed = now - last_time
            if elapsed >= 1.0:
                fps = frame_count / elapsed
                fps_label.config(text=f"FPS: {fps:.2f}")
                frame_count = 0
                last_time = now

        label.after(1, update_label)

    update_label()
    root.mainloop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Answer side")
    parser.add_argument("--verbose", "-v", action="count")
    parser.add_argument("--session", default="test")
    add_signaling_arguments(parser)
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG)

    if args.signaling == "copy-and-paste":
        signaling = CopyAndPasteSignaling()
    else:
        signaling = SimpleSignaling("answer", args.session, args.signaling_host, args.signaling_port)

    pc = RTCPeerConnection(
        RTCConfiguration(
            iceServers=[
                RTCIceServer(
                    urls="stun:stun.l.google.com:19302"
                )
            ]
        )
    )

    recorder = MediaConsumer()

    loop = asyncio.get_event_loop()
    root = tk.Tk()

    def asyncio_thread():
        try:
            loop.run_until_complete(
                run(
                    pc=pc,
                    recorder=recorder,
                    signaling=signaling,
                    root=root
                )
            )
        except KeyboardInterrupt:
            pass
        finally:
            loop.run_until_complete(recorder.stop())
            loop.run_until_complete(signaling.close())
            loop.run_until_complete(pc.close())

    t = threading.Thread(target=asyncio_thread)
    t.start()

    # Tk表示(メインスレッド)
    run_tk_window(root, recorder)

    # Tkクローズ時イベントループ停止
    loop.call_soon_threadsafe(loop.stop)
    t.join()

