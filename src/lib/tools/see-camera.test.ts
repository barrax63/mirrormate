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

  describe("in English mode", () => {
    it("reports a missing image in English", async () => {
      expect(await seeCameraTool.execute({})).toBe("No camera image is available. The user's camera may be off.");
    });

    it("reports a missing VLM provider in English", async () => {
      mocks.getVLMProvider.mockReturnValue(null);

      expect(await seeCameraTool.execute({}, { image: IMAGE })).not.toMatch(JAPANESE);
    });

    it("reports a VLM failure in English", async () => {
      mocks.analyzeImage.mockRejectedValue(new Error("model not found"));

      expect(await seeCameraTool.execute({}, { image: IMAGE })).not.toMatch(JAPANESE);
    });

    it("asks the VLM for an English description", async () => {
      mocks.analyzeImage.mockResolvedValue("A person");

      await seeCameraTool.execute({}, { image: IMAGE });

      expect(mocks.analyzeImage.mock.calls[0][1]).toContain("in 2-3 sentences in English.");
    });
  });

  describe("in Japanese mode", () => {
    beforeEach(() => {
      vi.stubEnv("LOCALE", "ja");
    });

    it("reports a missing image in Japanese", async () => {
      expect(await seeCameraTool.execute({})).toBe(
        "カメラ画像が利用できません。ユーザーのカメラが有効になっていない可能性があります。"
      );
    });

    it("asks the VLM for a Japanese description", async () => {
      mocks.analyzeImage.mockResolvedValue("人");

      await seeCameraTool.execute({}, { image: IMAGE });

      expect(mocks.analyzeImage.mock.calls[0][1]).toContain("in 2-3 sentences in Japanese.");
    });
  });
});
