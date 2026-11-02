import { describe, it, expect } from "vitest";
import { DEFAULT_HISTORY_LIMIT, historyLimitFrom, trimHistory } from "./history";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

describe("trimHistory", () => {
  it("keeps the last messages, up to the limit", () => {
    const messages = [user("1"), assistant("2"), user("3"), assistant("4"), user("5")];

    expect(trimHistory(messages, 3)).toEqual([user("3"), assistant("4"), user("5")]);
  });

  it("drops a reply whose question was cut off", () => {
    const messages = [user("1"), assistant("2"), user("3"), assistant("4"), user("5")];

    expect(trimHistory(messages, 4)).toEqual([user("3"), assistant("4"), user("5")]);
  });

  it("leaves a conversation within the limit alone", () => {
    const messages = [user("1"), assistant("2"), user("3")];

    expect(trimHistory(messages, 20)).toEqual(messages);
  });
});

describe("historyLimitFrom", () => {
  it("uses a whole number of at least 1", () => {
    expect(historyLimitFrom(1)).toBe(1);
    expect(historyLimitFrom(40)).toBe(40);
  });

  it.each([undefined, null, 0, -5, 2.5, "10", Number.NaN])("falls back to 20 for %j", (value) => {
    expect(historyLimitFrom(value)).toBe(DEFAULT_HISTORY_LIMIT);
    expect(DEFAULT_HISTORY_LIMIT).toBe(20);
  });
});
