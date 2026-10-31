import { test, expect, AvatarPage } from "./fixtures";

test.describe("Other pages", () => {
  test("/control/memory lists stored memories", async ({ page, request }) => {
    await request.post("/api/chat", {
      data: { messages: [{ role: "user", content: "this is REMEMBER_listing" }], withAudio: false },
    });
    await expect
      .poll(async () => JSON.stringify(await (await request.get("/api/memories")).json()))
      .toContain("mock memory listing");

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/control/memory");

    await expect(page.getByText("mock memory listing")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("/control/vision renders", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/control/vision");

    await expect(page.getByRole("heading", { name: "Vision Test" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("/demo renders the animation state", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/demo");

    await expect(page.getByText("Current:")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the avatar page only leaves this machine for its web fonts", async ({ page, mock }) => {
    const outside: string[] = [];
    page.on("request", (request) => {
      const { protocol, hostname } = new URL(request.url());
      if (protocol.startsWith("http") && !["127.0.0.1", "fonts.googleapis.com"].includes(hostname)) {
        outside.push(request.url());
      }
    });
    const avatar = new AvatarPage(page);

    await avatar.open();

    expect(outside).toEqual([]);
    expect(await mock.log("unknown")).toEqual([]);
    expect(avatar.errors).toEqual([]);
  });
});
