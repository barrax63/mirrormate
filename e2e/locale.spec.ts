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
      data: { messages: [{ role: "user", content: message }], withAudio: false },
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

    await expect(avatar.page.getByText("In Conversation")).toBeVisible();
    const [recording] = await mock.transcriptions();
    expect(recording.language).toBe("ja");
  });

  test("gives the LLM a Japanese system prompt and rules", async ({ request, mock }) => {
    const message = "ただいま";
    const response = await request.post("/api/chat", {
      data: { messages: [{ role: "user", content: message }], withAudio: false },
    });
    expect(response.status()).toBe(200);

    const [llm] = await mock.llmRequestsFor(message);
    expect(llm.body.messages[0].content).toContain("あなたは");
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

  test("known bug: serves <html lang=\"ja\">", async ({ page }) => {
    await page.goto("/control");
    await expect(page.locator("html")).toHaveAttribute("lang", /.+/);

    test.fail(true, "Pages are prerendered in the locale used at build time");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja", { timeout: 2000 });
  });

  test("known bug: serves Japanese UI text", async ({ page }) => {
    await page.goto("/control");
    await expect(page.locator("form input")).toHaveAttribute("placeholder", /.+/);

    test.fail(true, "Pages are prerendered in the locale used at build time");
    await expect(page.locator("form input")).toHaveAttribute("placeholder", "メッセージを入力...", {
      timeout: 2000,
    });
  });

  test("/api/stt/config reports ja-JP", async ({ request }) => {
    const response = await request.get("/api/stt/config");

    expect(await response.json()).toMatchObject({ provider: "openai", language: "ja-JP" });
  });
});
