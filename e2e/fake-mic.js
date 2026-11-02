// Replaces the microphone with a WebAudio tone, so the real recorder, its silence detection
// and /api/stt all run. Loaded as is, so it can't rely on anything from the test code.
const SPEECH_MS = 300;
// A real mic takes a moment to open, and an instant one would hide races in the recorder
const MIC_OPEN_MS = 100;
const recorders = [];
const streams = [];
const heldOpens = [];
const cameraStreams = [];
let micRequests = 0;
let cameraRequests = 0;

const NativeMediaRecorder = window.MediaRecorder;
window.MediaRecorder = class extends NativeMediaRecorder {
  constructor(...args) {
    super(...args);
    recorders.push(this);
  }
};

let context;
let tone;

// Pages on about:blank have no mediaDevices. The camera keeps Chromium's fake device.
if (navigator.mediaDevices) {
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints.audio) {
      // Counted, so tests can tell the camera never opened
      cameraRequests++;
      const stream = await getUserMedia(constraints);
      cameraStreams.push(stream);
      return stream;
    }
    micRequests++;
    await new Promise((resolve) => setTimeout(resolve, MIC_OPEN_MS));
    if (window.__micHeld) await new Promise((resolve) => heldOpens.push(resolve));
    if (!context) {
      context = new AudioContext();
      tone = context.createGain();
      tone.gain.value = 0;
      const oscillator = context.createOscillator();
      oscillator.connect(tone);
      oscillator.start();
    }
    // The recorder stops the tracks when it's done, so each recording needs its own stream
    const destination = context.createMediaStreamDestination();
    tone.connect(destination);
    streams.push(destination.stream);
    return destination.stream;
  };
}

window.__micListening = () => recorders.at(-1)?.state === "recording";

window.__liveRecorders = () => recorders.filter((recorder) => recorder.state === "recording").length;

window.__liveMicStreams = () =>
  streams.filter((stream) => stream.getTracks().some((track) => track.readyState === "live")).length;

window.__micRequests = () => micRequests;

window.__cameraRequests = () => cameraRequests;

window.__liveCameraTracks = () =>
  cameraStreams.flatMap((stream) => stream.getVideoTracks()).filter((track) => track.readyState === "live").length;

// While window.__micHeld is set, the mic stays opening until this is called
window.__releaseMic = () => {
  window.__micHeld = false;
  heldOpens.splice(0).forEach((open) => open());
};

// Makes a sound for the recorder that is listening, if there is one
window.__speak = () => {
  if (!window.__micListening()) return false;
  tone.gain.value = 0.5;
  setTimeout(() => {
    tone.gain.value = 0;
  }, SPEECH_MS);
  return true;
};
