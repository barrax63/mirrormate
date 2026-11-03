import type { Page } from "@playwright/test";
import { test, expect, type Failure } from "./fixtures";

// The mock answers as OpenAI and ElevenLabs do when a key is wrong, the account is out of
// credit, requests are rate limited or the service fails. Both pages should say which, and
// nothing should be asked again on every utterance while waiting can't help.

/** Waits for the reason in the list of errors on each page */
async function expectReason(pages: { page: Page }[], reason: string) {
  for (const { page } of pages) {
    await expect(page.getByRole("status").getByText(reason)).toBeVisible();
  }
}

interface Case {
  name: string;
  failure: Failure;
  reason: string;
  backsOff: boolean;
}

test.describe("Voice input failures", () => {
  const cases: Case[] = [
    { name: "a rejected key", failure: { status: 401 }, reason: "Voice input: OpenAI rejected the API key.", backsOff: true },
    {
      name: "a rate limit",
      failure: { status: 429, code: "rate_limit_exceeded" },
      reason: "Voice input: OpenAI is limiting requests. Trying again later.",
      backsOff: true,
    },
    {
      name: "no credit",
      failure: { status: 429, code: "insufficient_quota" },
      reason: "Voice input: OpenAI is out of credit.",
      backsOff: true,
    },
    {
      name: "a server error",
      failure: { status: 500 },
      reason: "Voice input: OpenAI returned an error. The server log has details.",
      backsOff: false,
    },
  ];

  for (const { name, failure, reason, backsOff } of cases) {
    test(`says so for ${name}, and ${backsOff ? "waits" : "tries again on the next utterance"}`, async ({
      avatar,
      control,
      mock,
    }) => {
      await avatar.wakeUp();
      await mock.fail("transcription", failure);

      await avatar.hear("what time is it", { failing: true });
      await expectReason([avatar, control], reason);

      await avatar.say("are you there");
      if (backsOff) {
        await avatar.waitForLog("Not sending audio: speech failed");
      } else {
        await expect.poll(async () => (await mock.transcriptions()).length).toBe(2);
      }
      await avatar.page.waitForTimeout(1000);
      expect(await mock.transcriptions()).toHaveLength(backsOff ? 1 : 2);
      expect(avatar.postsTo("/api/chat")).toEqual([]);
    });
  }

  test("waits only as long as a rate limit asks", async ({ avatar, mock }) => {
    await avatar.wakeUp();
    await mock.fail("transcription", { status: 429, code: "rate_limit_exceeded", retryAfter: 1 });

    await avatar.hear("what time is it", { failing: true });
    await avatar.page.waitForTimeout(1500);
    await avatar.hear("are you there", { failing: true });

    expect(await mock.transcriptions()).toHaveLength(2);
  });

  test("says so when local Whisper fails, and tries again on the next utterance", async ({ avatar, control, mock }) => {
    await mock.fail("localWhisper", { status: 500 });

    await avatar.hear("hey mira", { failing: true });
    await expectReason([avatar, control], "Wake word: Local Whisper returned an error. The server log has details.");

    await avatar.hear("hey mira", { failing: true });
    await avatar.page.waitForTimeout(1000);
    expect(await mock.localTranscriptions()).toHaveLength(2);
    expect(await mock.transcriptions()).toEqual([]);
  });
});

test.describe("Reply failures", () => {
  const cases: Case[] = [
    { name: "a rejected key", failure: { status: 401 }, reason: "Replies: OpenAI rejected the API key.", backsOff: true },
    {
      name: "a rate limit",
      failure: { status: 429, code: "rate_limit_exceeded" },
      reason: "Replies: OpenAI is limiting requests. Trying again later.",
      backsOff: true,
    },
    {
      name: "no credit",
      failure: { status: 429, code: "insufficient_quota" },
      reason: "Replies: OpenAI is out of credit.",
      backsOff: true,
    },
    {
      name: "the project's spending limit",
      failure: { status: 429, code: "project_spend_limit_exceeded" },
      reason: "Replies: OpenAI reached the monthly spending limit set for it.",
      backsOff: true,
    },
    {
      name: "a server error",
      failure: { status: 500 },
      reason: "Replies: OpenAI returned an error. The server log has details.",
      backsOff: false,
    },
  ];

  for (const { name, failure, reason } of cases) {
    test(`says so on both pages for ${name} on /control, which asks each time it's sent something`, async ({
      avatar,
      control,
      mock,
    }) => {
      await mock.fail("chat", failure);

      await control.send("hello");
      await expectReason([avatar, control], reason);
      // The conversation on /control says so too
      await expect(control.page.locator("p", { hasText: reason })).toBeVisible();

      await control.send("hello again");
      await expect.poll(async () => (await mock.log("llm")).length).toBe(2);
      await control.page.waitForTimeout(1000);
      expect(await mock.log("llm")).toHaveLength(2);
    });
  }

  for (const { name, failure, reason, backsOff } of cases) {
    test(`says so for ${name} on the avatar page, and ${backsOff ? "waits" : "asks again"} on the next utterance`, async ({
      avatar,
      control,
      mock,
    }) => {
      await avatar.wakeUp();
      await mock.fail("chat", failure);

      await avatar.hear("hello");
      await expectReason([avatar, control], reason);

      await avatar.hear("hello again");
      if (backsOff) {
        await avatar.waitForLog("Not asking for a reply");
      } else {
        await avatar.waitForPost("/api/chat", 2);
      }
      await avatar.page.waitForTimeout(1000);
      expect(avatar.postsTo("/api/chat")).toHaveLength(backsOff ? 1 : 2);
      expect(await mock.log("llm")).toHaveLength(backsOff ? 1 : 2);
    });
  }

  test("clears the reason on both pages once a reply works again", async ({ avatar, control, mock }) => {
    const reason = "Replies: OpenAI returned an error. The server log has details.";
    await mock.fail("chat", { status: 500 });
    await control.send("hello");
    await expectReason([avatar, control], reason);

    await mock.fail("chat", { status: null });
    await control.send("hello again");

    for (const { page } of [avatar, control]) {
      await expect(page.getByRole("status").getByText(reason)).toBeHidden();
    }
  });

  test("says so when the app's own server can't be reached", async ({ avatar, control }) => {
    await control.page.route("**/api/chat", (route) => route.abort());

    await control.send("hello");

    await expectReason([avatar, control], "Replies: The server can't be reached.");
  });
});

test.describe("Speech output failures", () => {
  const cases: Case[] = [
    {
      name: "a rejected key",
      failure: { status: 401, code: "invalid_api_key" },
      reason: "Speech: ElevenLabs rejected the API key.",
      backsOff: true,
    },
    {
      name: "a missing permission",
      failure: { status: 401, code: "missing_permissions" },
      reason: "Speech: The ElevenLabs API key lacks a permission this needs.",
      backsOff: true,
    },
    {
      name: "no credit",
      failure: { status: 401, code: "quota_exceeded" },
      reason: "Speech: ElevenLabs is out of credit.",
      backsOff: true,
    },
    {
      name: "a rate limit",
      failure: { status: 429 },
      reason: "Speech: ElevenLabs is limiting requests. Trying again later.",
      backsOff: true,
    },
    {
      name: "a server error",
      failure: { status: 500 },
      reason: "Speech: ElevenLabs returned an error. The server log has details.",
      backsOff: false,
    },
  ];

  for (const { name, failure, reason, backsOff } of cases) {
    test(`says so for ${name}, and ${backsOff ? "waits" : "asks again"} for the next reply`, async ({
      avatar,
      control,
      mock,
    }) => {
      await mock.fail("speech", failure);

      await control.send("hello");
      await expectReason([avatar, control], reason);
      // The reply is still shown
      await expect(avatar.page.getByText("mock reply to: hello")).toBeVisible();

      await control.send("hello again");
      if (backsOff) {
        await avatar.waitForLog("Not asking for speech");
      } else {
        await expect.poll(async () => (await mock.speech()).length).toBe(2);
      }
      await avatar.page.waitForTimeout(1000);
      expect(await mock.speech()).toHaveLength(backsOff ? 1 : 2);
    });
  }

  test("says so when the voice preview on /control fails", async ({ avatar, control, mock }) => {
    await mock.fail("speech", { status: 401, code: "quota_exceeded" });

    await control.selectVoice("Lily");
    await control.page.getByRole("button", { name: "Preview" }).click();

    await expectReason([avatar, control], "Speech: ElevenLabs is out of credit.");
  });
});
