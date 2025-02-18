async function simpleSignaling(pc, canvas, signalingHost, signalingPort, sessionId) {
  startButton.disabled = true;
  applyAnswerButton.disabled = true;

  // gather ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      // Append candidate to text area if needed.
      const cand = JSON.stringify(event.candidate);
      iceCandidatesTextArea.value = cand;

      // todo: answer.candidate is not supported
      fetch(`${signalingHost}:${signalingPort}/signaling/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'offer', candidate: event.candidate })
      });
    }
  };

  pc.onconnectionstatechange = (event) => {
    console.log('Connection state change:', pc.connectionState);
    if (pc.connectionState === 'disconnected') {
      fetch(`${signalingHost}:${signalingPort}/signaling/${sessionId}`, {
        method: 'DELETE'
      });
    }
    if (pc.connectionState === 'closed') {
      fetch(`${signalingHost}:${signalingPort}/signaling/${sessionId}`, {
        method: 'DELETE'
      });
    }
  }

  // capture from the three.js renderer's canvas
  const stream = canvas.captureStream(60);
  const track = stream.getVideoTracks()[0];
  const sender = pc.addTrack(track, stream);

  // codec restriction for shortening the offer SDP
  // For reduction of offer strings (< N_TTY_BUF_SIZE?, 4KB)
  await pc.createOffer();
  // an offer must be create or transceiver must be finalized
  const videoTransceiver = pc.getTransceivers().find(t => t.sender === sender);
  if (videoTransceiver) {
    const capabilities = RTCRtpSender.getCapabilities('video');
    // use VP8 only
    const preferredCodecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/vp8');
    videoTransceiver.setCodecPreferences(preferredCodecs);
  }

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // show offer SDP to user
  const offerSdp = JSON.stringify(pc.localDescription);
  offerSdpTextArea.value = offerSdp;

  // サーバにOfferを送信
  await fetch(`${signalingHost}:${signalingPort}/signaling/${sessionId}?type=offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'offer', sdp: pc.localDescription })
  });

  async function waitForAnswer() {
    console.log('Waiting for answer...');
    for (;;) {
      const resp = await fetch(`${signalingHost}:${signalingPort}/signaling/${sessionId}?type=answer`);
      if (resp.ok) {
        const answer = await resp.json();
        // todo: answer.candidate is not supported
        await pc.setRemoteDescription(answer.sdp);
        answerSdpTextArea.value = JSON.stringify(answer.sdp);
        console.log('Answer received, connection established');
        break;
      }
      // 一定時間待って再トライ
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  waitForAnswer();
}


async function copyAndPasteSignaling(pc, canvas, signalingHost, signalingPort, sessionId) {

  // Copy and Paste
  startButton.addEventListener('click', async () => {
    // gather ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Append candidate to text area if needed.
        const cand = JSON.stringify(event.candidate);
        iceCandidatesTextArea.value = cand;
      }
    };

    pc.onconnectionstatechange = (event) => {
      console.log('Connection state change:', pc.connectionState);
      // TODO
      // if (pc.connectionState === 'disconnected') {}
      // if (pc.connectionState === 'closed') {}
    }

    // capture from the three.js renderer's canvas
    const stream = canvas.captureStream(60);
    const track = stream.getVideoTracks()[0];
    const sender = pc.addTrack(track, stream);

    // codec restriction for shortening the offer SDP
    // For reduction of offer strings (< N_TTY_BUF_SIZE?, 4KB)
    await pc.createOffer();
    // an offer must be create or transceiver must be finalized
    const videoTransceiver = pc.getTransceivers().find(t => t.sender === sender);
    if (videoTransceiver) {
      const capabilities = RTCRtpSender.getCapabilities('video');
      // use VP8 only
      const preferredCodecs = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/vp8');
      videoTransceiver.setCodecPreferences(preferredCodecs);
    }

    // create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // show offer SDP to user
    const offerSdp = JSON.stringify(pc.localDescription);
    offerSdpTextArea.value = offerSdp;
  });

  applyAnswerButton.addEventListener('click', async () => {
    if (!pc) {
      alert("No RTCPeerConnection. Create Offer first.");
      return;
    }
    const answer = JSON.parse(answerSdpTextArea.value.trim());
    await pc.setRemoteDescription(answer);
  });
}


const startButton = document.getElementById('startButton');
const offerSdpTextArea = document.getElementById('offerSdp');
const answerSdpTextArea = document.getElementById('answerSdp');
const iceCandidatesTextArea = document.getElementById('iceCandidates');
const applyAnswerButton = document.getElementById('applyAnswerButton');


export function startWebRTC(signaling, signalingHost, signalingPort, sessionId, canvas) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  pc.channelListeners = new Map();

  pc.addChannelListener = (label, callback) => {
    pc.channelListeners.set(label, callback);
  }

  pc.ondatachannel = (event) => {
    const channel = event.channel;
    for (const [label, callback] of pc.channelListeners) {
      if (channel.label === label) {
        channel.onmessage = callback;
      }
    }
  };

  // receive sample
  pc.addChannelListener('test_py', (e) => {
    console.log(e.target.label, '<', e.data);
  });

  // send sample
  const channel = pc.createDataChannel('test_js');
  channel.onopen = () => {
    channel.send('Hello from JavaScript!');
  };

  if (signaling === 'auto') {
    simpleSignaling(pc, canvas, signalingHost, signalingPort, sessionId);
  } else if (signaling === 'copypaste') {
    copyAndPasteSignaling(pc, canvas, signalingHost, signalingPort, sessionId);
  }
  return pc;
}
