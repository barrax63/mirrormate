import { test, expect, EN_URL, JA_URL, JAPANESE } from "./fixtures";

test.describe("English server", () => {
  test("serves English UI text", async ({ page }) => {
    await page.goto("/control");

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("form input")).toHaveAttribute("placeholder", "Enter message...");
  });

  test("known bug: sends no Japanese to the LLM", async ({ request, mock }) => {
    const message = "hello in English";
    await request.post("/api/chat", {
      data: { messages: [{ role: "user", content: message }] },
    });
    const [llm] = await mock.llmRequestsFor(message);
    expect(llm.body.messages[0].content).toContain("Current time:");
    expect(llm.body.messages[0].content).not.toMatch(JAPANESE);

    test.fail(true, "The web_search and show_effect tool descriptions are always Japanese");
    expect(JSON.stringify(llm.body)).not.toMatch(JAPANESE);
  });
});

test.describe("Japanese server", () => {
  test.use({ baseURL: JA_URL });

  test("uses the Japanese wake word", async ({ request }) => {
    const response = await request.get("/api/wakeword");

    const { phrase } = await response.json();
    expect(phrase).toMatch(JAPANESE);
  });

  test("wakes on a transcript with Japanese punctuation", async ({ request, avatar, mock }) => {
    const { phrase } = await (await request.get("/api/wakeword")).json();

    await avatar.hear(`${phrase.replace(" ", "、")}。`);

    await expect(avatar.page.getByText("会話中")).toBeVisible();
    const [wakeWord] = await mock.localTranscriptions();
    expect(wakeWord.language).toBe("ja");

    await avatar.hear("今何時");
    const [speech] = await mock.transcriptions();
    expect(speech.languages).toEqual(["ja"]);
    expect(speech.keywords).toContain("ミラ");
  });

  test("gives the LLM a Japanese system prompt and rules", async ({ request, mock }) => {
    const message = "ただいま";
    const response = await request.post("/api/chat", {
      data: { messages: [{ role: "user", content: message }] },
    });
    expect(response.status()).toBe(200);

    const [llm] = await mock.llmRequestsFor(message);
    expect(llm.body.messages[0].content).toContain("あなたは");
    expect(llm.body.messages[0].content).toContain("音声で読み上げられます");
    expect(llm.body.messages[0].content).toContain("現在時刻");
    expect(llm.body.tools ?? []).toEqual([]);
  });

  test("keeps its own database", async ({ request }) => {
    const created = await request.post(`${EN_URL}/api/memories`, {
      data: { kind: "knowledge", title: "english only", content: "stored on the English server" },
    });
    expect(created.ok()).toBe(true);
    const titles = async (url: string) => {
      const { memories } = await (await request.get(`${url}/api/memories`)).json();
      return memories.map((memory: { title: string }) => memory.title);
    };

    expect(await titles(EN_URL)).toContain("english only");
    expect(await titles(JA_URL)).not.toContain("english only");
  });

  // The build is English, so these show that the locale applies at runtime
  test("serves <html lang=\"ja\">", async ({ page }) => {
    await page.goto("/control");

    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  });

  test("serves Japanese UI text", async ({ page }) => {
    await page.goto("/control");

    await expect(page.locator("form input")).toHaveAttribute("placeholder", "メッセージを入力...");
  });

  test("serves Japanese in the HTML itself, before any script runs", async ({ request }) => {
    for (const path of ["/", "/control"]) {
      expect(await (await request.get(path)).text()).toContain('<html lang="ja"');
    }
    expect(await (await request.get("/control")).text()).toContain('placeholder="メッセージを入力..."');
  });

  test("replies with the Japanese character's line when the LLM gives no text", async ({ request }) => {
    const response = await request.post("/api/chat", {
      data: { messages: [{ role: "user", content: "EMPTY_REPLY ください" }] },
    });

    expect((await response.json()).message).toBe("うーん、考えがまとまらなかったみたい。もう一回言ってくれる？");
  });

  test("/api/tts asks ElevenLabs for Japanese", async ({ request, mock }) => {
    const response = await request.post("/api/tts", { data: { text: "こんにちは" } });

    expect(response.status()).toBe(200);
    const [speech] = await mock.speech();
    expect(speech.body).toMatchObject({ text: "こんにちは", language_code: "ja" });
  });

  test("/api/stt/config reports Japanese", async ({ request }) => {
    const response = await request.get("/api/stt/config");

    expect(await response.json()).toMatchObject({ provider: "openai", language: "ja" });
  });
});
