// Replaces SpeechRecognition in the browser, where there is no real speech to recognize.
// Loaded as is, so it can't rely on anything from the test code. Follows what browsers
// do: start() throws if already started, and `end` fires asynchronously after stop() or
// abort(). Recognition stopping late is what exposes the cut-off bug in e2e/control.spec.ts.
window.__recognitions = [];

class StubRecognition {
  constructor() {
    this.lang = "";
    this.running = false;
    window.__recognitions.push(this);
  }

  start() {
    if (this.running) throw new DOMException("already started", "InvalidStateError");
    this.running = true;
    setTimeout(() => this.onstart?.(), 0);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    setTimeout(() => this.onend?.(), 200);
  }

  abort() {
    if (!this.running) return;
    this.running = false;
    setTimeout(() => this.onend?.(), 0);
  }
}

window.SpeechRecognition = StubRecognition;
window.webkitSpeechRecognition = StubRecognition;

// Delivers a final result to the recognizer that is listening, if there is one
window.__say = (text) => {
  const recognition = window.__recognitions.findLast((r) => r.running);
  if (!recognition) return false;
  recognition.onresult?.({
    resultIndex: 0,
    results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: text, confidence: 1 } } },
  });
  return true;
};
