// Replaces the microphone with a WebAudio tone, so the real recorder, its silence detection
// and /api/stt all run. Loaded as is, so it can't rely on anything from the test code.
//
// What is "said" into the mic is kept as a timeline. Each recording ends with a line naming
// the words said while it recorded, which the fake transcription services in
// e2e/mock-backends.mjs answer with. A word cut off by the start or end of a recording is
// missing from it, as it would be from a real transcript.
const SPEECH_MS = 300;
// A real mic takes a moment to open, and an instant one would hide races in the recorder
const MIC_OPEN_MS = 100;
// Also in e2e/mock-backends.mjs and e2e/fixtures.ts
const TRANSCRIPT_MARK = "\nMOCK-TRANSCRIPT:";
const recorders = [];
const streams = [];
const heldOpens = [];
const cameraStreams = [];
const utterances = [];
let micRequests = 0;
let cameraRequests = 0;
let speaking = 0;

/** Words said entirely between these two times, from Date.now() */
function wordsBetween(from, to) {
  return utterances
    .flatMap(({ words, startedAt, endedAt }) => {
      const slot = (endedAt - startedAt) / words.length;
      return words.filter((_, i) => startedAt + i * slot >= from && startedAt + (i + 1) * slot <= to);
    })
    .join(" ");
}

const NativeMediaRecorder = window.MediaRecorder;
window.MediaRecorder = class extends NativeMediaRecorder {
  constructor(...args) {
    super(...args);
    this.startedAt = null;
    this.stoppedAt = null;
    recorders.push(this);
  }

  start(...args) {
    this.startedAt = Date.now();
    return super.start(...args);
  }

  stop() {
    if (this.state !== "inactive") this.stoppedAt = Date.now();
    return super.stop();
  }

  // The last data arrives just before stop, so this adds the words after it
  set onstop(handler) {
    super.onstop =
      handler &&
      ((event) => {
        const words = wordsBetween(this.startedAt, this.stoppedAt ?? Date.now());
        this.ondataavailable?.({ data: new Blob([TRANSCRIPT_MARK + JSON.stringify(words)]) });
        return handler.call(this, event);
      });
  }

  get onstop() {
    return super.onstop;
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

// Every recording so far, oldest first, with what was said during it
window.__recordings = () =>
  recorders.map((recorder) => ({
    startedAt: recorder.startedAt,
    stoppedAt: recorder.stoppedAt,
    words: wordsBetween(recorder.startedAt, recorder.stoppedAt ?? Date.now()),
  }));

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

// Says these words over this many milliseconds, if a recorder is listening. With no words, it's
// a sound that recordings hold but transcripts leave out.
window.__speak = (text = "", ms = SPEECH_MS) => {
  if (!window.__micListening()) return false;
  const startedAt = Date.now();
  utterances.push({ words: text.split(/\s+/).filter(Boolean), startedAt, endedAt: startedAt + ms });
  speaking++;
  tone.gain.value = 0.5;
  setTimeout(() => {
    if (--speaking === 0) tone.gain.value = 0;
  }, ms);
  return true;
};
