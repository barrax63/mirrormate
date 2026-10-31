import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { seeCameraTool } from "./see-camera";

const mocks = vi.hoisted(() => ({
  analyzeImage: vi.fn(),
  getVLMProvider: vi.fn(),
}));

vi.mock("@/lib/vlm", () => ({ getVLMProvider: mocks.getVLMProvider }));

const JAPANESE = /[぀-ヿ㐀-鿿]/;
const IMAGE = "data:image/jpeg;base64,AAAA";

describe("seeCameraTool", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("LOCALE", "en");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getVLMProvider.mockReturnValue({ analyzeImage: mocks.analyzeImage });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends the image and focus to the VLM and returns its description", async () => {
    mocks.analyzeImage.mockResolvedValue("A person holding a mug");

    const result = await seeCameraTool.execute({ focus: "their hands" }, { image: IMAGE });

    expect(result).toBe("A person holding a mug");
    expect(mocks.analyzeImage).toHaveBeenCalledWith(IMAGE, expect.stringContaining("Focus on: their hands"));
  });

  it("doesn't call the VLM without an image", async () => {
    await seeCameraTool.execute({});

    expect(mocks.analyzeImage).not.toHaveBeenCalled();
  });

  // Known bug: the messages and the requested reply language are always Japanese.
  // Remove .fails when they follow the locale.
  describe("in English mode", () => {
    it.fails("reports a missing image in English", async () => {
      expect(await seeCameraTool.execute({})).not.toMatch(JAPANESE);
    });

    it.fails("reports a missing VLM provider in English", async () => {
      mocks.getVLMProvider.mockReturnValue(null);

      expect(await seeCameraTool.execute({}, { image: IMAGE })).not.toMatch(JAPANESE);
    });

    it.fails("reports a VLM failure in English", async () => {
      mocks.analyzeImage.mockRejectedValue(new Error("model not found"));

      expect(await seeCameraTool.execute({}, { image: IMAGE })).not.toMatch(JAPANESE);
    });

    it.fails("doesn't ask the VLM for a Japanese description", async () => {
      mocks.analyzeImage.mockResolvedValue("A person");

      await seeCameraTool.execute({}, { image: IMAGE });

      expect(mocks.analyzeImage.mock.calls[0][1]).not.toContain("Japanese");
    });
  });
});
