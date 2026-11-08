import { describe, it, expect } from "vitest";
import { LiveTranscript } from "./transcript";

describe("LiveTranscript", () => {
  it("joins deltas from the same side into one turn, and starts a new turn on the other side", () => {
    const transcript = new LiveTranscript();

    expect(transcript.add("user", " What time")).toBe("What time");
    expect(transcript.add("user", " is it?")).toBe("What time is it?");
    expect(transcript.add("assistant", " It's")).toBe("It's");
    expect(transcript.add("assistant", " 7:06.")).toBe("It's 7:06.");
    expect(transcript.add("user", " Thanks!")).toBe("Thanks!");

    expect(transcript.messages()).toEqual([
      { role: "user", content: "What time is it?" },
      { role: "assistant", content: "It's 7:06." },
      { role: "user", content: "Thanks!" },
    ]);
  });

  it("splits a turn the other side spoke over, and leaves out turns without text", () => {
    const transcript = new LiveTranscript();

    transcript.add("user", "What time");
    transcript.add("assistant", " ");
    transcript.add("user", " is it?");

    expect(transcript.messages()).toEqual([
      { role: "user", content: "What time" },
      { role: "user", content: "is it?" },
    ]);
  });
});
