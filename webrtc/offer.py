import argparse
import asyncio
import logging
import math
import cv2
import numpy
import json
from av import VideoFrame

from aiortc import (
    RTCIceCandidate,
    RTCPeerConnection,
    RTCConfiguration,
    RTCIceServer,
    RTCSessionDescription,
    VideoStreamTrack,
)
from aiortc.rtcrtpsender import RTCRtpSender
from aiortc.contrib.signaling import add_signaling_arguments, BYE

from utils import SimpleSignaling, CopyAndPasteSignaling


import aiortc.mediastreams
FPS = 240
aiortc.mediastreams.VIDEO_PTIME = 1 / FPS  # monkey patch


class FlagVideoStreamTrack(VideoStreamTrack):
    def __init__(self):
        super().__init__()  # don't forget this!
        self.counter = 0
        height, width = 480, 640

        # generate flag
        data_bgr = numpy.hstack(
            [
                self._create_rectangle(width=213, height=480, color=(255, 0, 0)),   # blue
                self._create_rectangle(width=214, height=480, color=(255, 255, 255)), # white
                self._create_rectangle(width=213, height=480, color=(0, 0, 255)),   # red
            ]
        )

        # shrink and center it
        M = numpy.float32([[0.5, 0, width / 4], [0, 0.5, height / 4]])
        data_bgr = cv2.warpAffine(data_bgr, M, (width, height))

        # compute animation
        omega = 2 * math.pi / height
        id_x = numpy.tile(numpy.array(range(width), dtype=numpy.float32), (height, 1))
        id_y = numpy.tile(
            numpy.array(range(height), dtype=numpy.float32), (width, 1)
        ).transpose()

        self.frames = []
        for k in range(FPS):
            phase = 2 * k * math.pi / FPS
            map_x = id_x + 10 * numpy.cos(omega * id_x + phase)
            map_y = id_y + 10 * numpy.sin(omega * id_x + phase)
            frame_bgr = cv2.remap(data_bgr, map_x, map_y, cv2.INTER_LINEAR)

            # draw frame numbers
            text = str(k)
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 2.0
            color = (0, 0, 0) # black
            thickness = 2
            text_size, _ = cv2.getTextSize(text, font, font_scale, thickness)
            text_w, text_h = text_size
            text_x = (width - text_w) // 2
            text_y = (height + text_h) // 2

            cv2.putText(frame_bgr, text, (text_x, text_y), font, font_scale, color, thickness)
            self.frames.append(
                VideoFrame.from_ndarray(frame_bgr, format="bgr24")
            )

    async def recv(self):
        pts, time_base = await self.next_timestamp()
        frame = self.frames[self.counter % FPS]
        frame.pts = pts
        frame.time_base = time_base
        self.counter += 1
        return frame

    def _create_rectangle(self, width, height, color):
        data_bgr = numpy.zeros((height, width, 3), numpy.uint8)
        data_bgr[:, :] = color
        return data_bgr


async def run(pc, signaling):
    def force_codec(pc, sender, forced_codec):
        kind = forced_codec.split("/")[0]
        codecs = RTCRtpSender.getCapabilities(kind).codecs
        transceiver = next(t for t in pc.getTransceivers() if t.sender == sender)
        transceiver.setCodecPreferences(
            [codec for codec in codecs if codec.mimeType == forced_codec]
        )

    # 送信用映像トラック追加
    video_sender = pc.addTrack(FlagVideoStreamTrack())
    force_codec(pc, video_sender, "video/VP8")

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

    @pc.on("datachannel")
    def on_datachannel(channel):
        if channel.label.startswith("data_"):
            @channel.on("message")
            def on_message(message):
                print(channel.label, "<", message)

    data_channel = pc.createDataChannel("data_py2")

    @data_channel.on("open")
    def on_open():
        data_channel.send("Hello from Python!")

    # signaling の接続開始
    await signaling.connect()

    # Offer作成と送信
    await pc.setLocalDescription(await pc.createOffer())
    await signaling.send(pc.localDescription)

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
            # 相手からAnswer受信
            await pc.setRemoteDescription(obj)

        elif isinstance(obj, RTCIceCandidate):
            await pc.addIceCandidate(obj)

        elif obj is BYE:
            print("Exiting")
            break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Offer side")
    parser.add_argument("--verbose", "-v", action="count")
    parser.add_argument("--session", default="test")
    add_signaling_arguments(parser)
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG)

    if args.signaling == "copy-and-paste":
        signaling = CopyAndPasteSignaling()
    else:
        signaling = SimpleSignaling("offer", args.session, args.signaling_host, args.signaling_port)

    pc = RTCPeerConnection(
        RTCConfiguration(
            iceServers=[
                RTCIceServer(
                    urls="stun:stun.l.google.com:19302"
                )
            ]
        )
    )

    loop = asyncio.get_event_loop()

    try:
        loop.run_until_complete(
            run(
                pc=pc,
                signaling=signaling,
            )
        )
    except KeyboardInterrupt:
        pass
    finally:
        loop.run_until_complete(signaling.close())
        loop.run_until_complete(pc.close())

