import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDb, resetDb, userSettings, users } from "./index";

// What initializeSchema created before voices came from ElevenLabs
const SCHEMA_WITH_SPEAKER_ID = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    speaker_id INTEGER,
    character_id TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);
`;

describe("user_settings", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mirrormate-db-"));
    dbPath = path.join(dir, "test.db");
    vi.stubEnv("DATABASE_PATH", dbPath);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    resetDb();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function columns() {
    resetDb();
    const sqlite = new Database(dbPath);
    const names = (sqlite.prepare("PRAGMA table_info(user_settings)").all() as { name: string }[]).map((c) => c.name);
    sqlite.close();
    return names;
  }

  it("replaces the old speaker number with an empty voice, and keeps the character", async () => {
    const old = new Database(dbPath);
    old.exec(SCHEMA_WITH_SPEAKER_ID);
    old.prepare("INSERT INTO users (id, created_at) VALUES ('default-user', 1700000000)").run();
    old
      .prepare(
        "INSERT INTO user_settings (id, user_id, speaker_id, character_id, updated_at) VALUES ('s1', 'default-user', 2, 'luna', 1700000000)"
      )
      .run();
    old.close();

    const [settings] = await getDb().select().from(userSettings);

    expect(settings).toMatchObject({ userId: "default-user", voice: null, characterId: "luna" });
    expect(columns()).toEqual(["id", "user_id", "character_id", "updated_at", "voice"]);
  });

  it("starts again cleanly on a database that's already migrated", async () => {
    const old = new Database(dbPath);
    old.exec(SCHEMA_WITH_SPEAKER_ID);
    old.close();
    getDb();
    resetDb();

    const db = getDb();
    await db.insert(users).values({ id: "u1", createdAt: new Date() });
    await db.insert(userSettings).values({ id: "s1", userId: "u1", voice: "voice-id", updatedAt: new Date() });

    expect(columns()).toEqual(["id", "user_id", "character_id", "updated_at", "voice"]);
  });

  it("creates new databases with a voice column", () => {
    getDb();

    expect(columns()).toEqual(["id", "user_id", "voice", "character_id", "updated_at"]);
  });
});
