// Replaces the microphone with a WebAudio tone, so the real recorder, its silence detection
// and /api/stt all run. Loaded as is, so it can't rely on anything from the test code.
const SPEECH_MS = 300;
// A real mic takes a moment to open, and an instant one would hide races in the recorder
const MIC_OPEN_MS = 100;
const recorders = [];

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
    if (!constraints.audio) return getUserMedia(constraints);
    await new Promise((resolve) => setTimeout(resolve, MIC_OPEN_MS));
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
    return destination.stream;
  };
}

window.__micListening = () => recorders.at(-1)?.state === "recording";

window.__liveRecorders = () => recorders.filter((recorder) => recorder.state === "recording").length;

// Makes a sound for the recorder that is listening, if there is one
window.__speak = () => {
  if (!window.__micListening()) return false;
  tone.gain.value = 0.5;
  setTimeout(() => {
    tone.gain.value = 0;
  }, SPEECH_MS);
  return true;
};
