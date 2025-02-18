import argparse
import asyncio
import threading
import logging
import tkinter as tk
import random

from aiortc.contrib.signaling import add_signaling_arguments

from answer import (
    SimpleSignaling,
    CopyAndPasteSignaling,
    RTCPeerConnection,
    RTCConfiguration,
    RTCIceServer,
    MediaConsumer,
    run,
    run_tk_window,
)


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

    # CHANGED
    data_channel = pc.createDataChannel("angle")

    async def send_angle_data():
        angle = 90
        speed = 1.8

        # 2秒に一回くらい、逆回転になるようにする
        flag = False
        while True:
            if flag:
                angle = (angle - speed) % 360
            else:
                angle = (angle + speed) % 360

            if data_channel.readyState == "open":
                data_channel.send(str(angle))
            await asyncio.sleep(1 / 60)
            # 乱数で逆回転
            if random.random() < 1 / 120:
                flag = not flag


    recorder = MediaConsumer()

    # CHANGED
    # loop = asyncio.get_event_loop()
    loop = asyncio.new_event_loop()
    root = tk.Tk()

    # CHANGED
    def asyncio_thread():
        asyncio.set_event_loop(loop)

        task_run = loop.create_task(
            run(
                pc=pc,
                recorder=recorder,
                signaling=signaling,
                root=root
            )
        )
        task_angle = loop.create_task(send_angle_data())

        try:
            loop.run_until_complete(
                asyncio.gather(task_run, task_angle)
            )
        except KeyboardInterrupt:
            pass
        finally:
            for t in (task_run, task_angle):
                t.cancel()
            loop.run_until_complete(asyncio.gather(task_run, task_angle, return_exceptions=True))
            loop.run_until_complete(recorder.stop())
            loop.run_until_complete(signaling.close())
            loop.run_until_complete(pc.close())
            loop.close()

    # CHANGED
    # t = threading.Thread(target=asyncio_thread)
    t = threading.Thread(target=asyncio_thread, daemon=True)
    t.start()

    # Tk表示(メインスレッド)
    run_tk_window(root, recorder)

    # Tkクローズ時イベントループ停止
    loop.call_soon_threadsafe(loop.stop)
    t.join()

