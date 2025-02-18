# https://github.com/aiortc/aiortc/blob/main/src/aiortc/contrib/signaling.py

import asyncio
import requests
import sys
import json

from aiortc import (
    RTCIceCandidate,
    RTCSessionDescription,
)
from aiortc.sdp import (
    candidate_from_sdp,
    candidate_to_sdp
)
from aiortc.contrib.signaling import BYE


class SimpleSignaling:
    def __init__(self, type_, session_id, host, port):
        self.type = type_
        self.session_id = session_id
        self.server_url = f"{host}:{port}"
        self._sdp = None
        self._candidate = None
        self.closed = False

    async def connect(self):
        pass

    async def close(self):
        pass

    async def receive(self):
        while True:
            await asyncio.sleep(1)

            if (self.closed):
                return BYE

            _type = "answer" if self.type == "offer" else "offer"
            res = requests.get(
                f"{self.server_url}/signaling/{self.session_id}?type={_type}"
            )
            if res.status_code == 404:
                print("connecting...")
                continue

            res.raise_for_status()

            data = res.json()
            message = None
            if (data.get("sdp") and data["sdp"] != self._sdp):
                self._sdp = data["sdp"]
                message = data["sdp"]
            elif (data.get("candidate") and data["candidate"] != self._candidate):
                self._candidate = data["candidate"]
                message = data["candidate"]
            if message:
                return object_from_string(message)

    # todo: sending ice candidates is not implemented
    async def send(self, descr):
        res = requests.post(
            f"{self.server_url}/signaling/{self.session_id}?type={self.type}",
            json=object_to_string(descr, True)
        )

    async def disconnect(self):
        res = requests.delete(f"{self.server_url}/signaling/{self.session_id}")
        res.raise_for_status()
        self.closed = True


class CopyAndPasteSignaling:
    def __init__(self):
        self._read_pipe = sys.stdin
        self._read_transport = None
        self._reader = None
        self._write_pipe = sys.stdout

    async def connect(self):
        loop = asyncio.get_event_loop()
        self._reader = asyncio.StreamReader(loop=loop)
        self._read_transport, _ = await loop.connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(self._reader), self._read_pipe
        )

    async def close(self):
        if self._reader is not None:
            await self.send(BYE)
            self._read_transport.close()
            self._reader = None

    async def receive(self):
        print("-- Please enter a message from remote party --")
        data = await self._reader.readline()
        message = data.decode(self._read_pipe.encoding).strip()
        print()

        if not message:
            return object_from_string({})
        else:
            return object_from_string(json.loads(message))

    async def send(self, descr):
        print("-- Please send this message to the remote party --")
        message = object_to_string(descr)
        self._write_pipe.write(json.dumps(message, sort_keys=True) + "\n")
        self._write_pipe.flush()
        print()

    async def disconnect(self):
        await self.close()


def object_from_string(message):
    if "type" in message and message["type"] in ["answer", "offer"]:
            return RTCSessionDescription(**message)
    elif "candidate" in message:
        candidate = candidate_from_sdp(message["candidate"].split(":", 1)[1])
        candidate.sdpMid = message["sdpMid"]
        candidate.sdpMLineIndex = message["sdpMLineIndex"]
        return candidate
    elif "type" in message and message["type"] == "bye":
        return BYE


def object_to_string(obj, nest=False):
    if isinstance(obj, RTCSessionDescription):
        message = {"type": obj.type, "sdp": obj.sdp}
        if nest:
            message["sdp"] = {"type": obj.type, "sdp": obj.sdp}
    # elif isinstance(obj, RTCIceCandidate):
    #     message = {
    #         "candidate": "candidate:" + candidate_to_sdp(obj),
    #         "id": obj.sdpMid,
    #         "label": obj.sdpMLineIndex,
    #     }
    else:
        assert obj is BYE
        message = {"type": "bye"}
    return message
