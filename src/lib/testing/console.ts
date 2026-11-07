import { inspect } from "node:util";
import { vi } from "vitest";

/**
 * Everything written so far to the console methods that the test spies on, as one string. Logs
 * must not hold what was said, heard or seen, and tests check that against this.
 */
export function consoleOutput(): string {
  return [console.log, console.info, console.warn, console.error]
    .filter((method) => vi.isMockFunction(method))
    .flatMap((method) => vi.mocked(method).mock.calls)
    .map((args) => args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 5 }))).join(" "))
    .join("\n");
}
