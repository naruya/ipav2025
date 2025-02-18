export class Recorder {
  constructor(renderer) {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported("video/webm")) {
      console.warn("MediaRecorder or video/webm is not supported on this browser.");
      this.isSupported = false;
      return;
    }
    this.isSupported = true;

    const stream = renderer.domElement.captureStream(60);
    const options = { mimeType: "video/webm" };
    const mediaRecorder = new MediaRecorder(stream, options);
    let recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = "recording.webm";
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
      recordedChunks = [];
    };

    this.mediaRecorder = mediaRecorder;
    this.recordedChunks = recordedChunks;
  }

  startRecording() {
    if (!this.isSupported) return;

    console.log("start recording");
    this.recordedChunks = [];
    this.mediaRecorder.start();
  }

  stopRecording() {
    if (!this.isSupported) return;

    console.log("stop recording");
    this.mediaRecorder.stop();
  }
}