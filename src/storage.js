import fs from "fs";
import path from "path";
import { createDefaultState, loadState, normalizeState, saveState } from "./state.js";

const stateRowId = "default";

class FileStateStore {
  constructor(stateFile) {
    this.type = "file";
    this.stateFile = stateFile;
    this.lockFile = null;
    this.lockHandle = null;
  }

  async load() {
    return loadState(this.stateFile);
  }

  async save(state) {
    saveState(this.stateFile, state);
  }

  async close() {
    await this.releaseLock();
  }

  async acquireLock(lockFile) {
    if (!lockFile) return;
    const directory = path.dirname(lockFile);
    if (directory && directory !== "." && !fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    try {
      this.lockHandle = fs.openSync(lockFile, "wx");
      fs.writeFileSync(this.lockHandle, String(process.pid));
      this.lockFile = lockFile;
    } catch (error) {
      throw new Error(`Instance lain kemungkinan sedang berjalan. Lock file aktif: ${lockFile}`);
    }
  }

  async releaseLock() {
    if (this.lockHandle !== null) {
      fs.closeSync(this.lockHandle);
      this.lockHandle = null;
    }
    if (this.lockFile && fs.existsSync(this.lockFile)) {
      fs.unlinkSync(this.lockFile);
      this.lockFile = null;
    }
  }
}

class PostgresStateStore {
  constructor({ databaseUrl, stateFile }) {
    this.type = "postgres";
    this.stateFile = stateFile;
    this.databaseUrl = databaseUrl;
    this.client = null;
    this.ready = false;
  }

  async init() {
    if (this.ready) return;

    const { Client } = await import("pg");
    this.client = new Client({
      connectionString: this.databaseUrl,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
    });

    await this.client.connect();
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS bot_state (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    this.ready = true;
  }

  async load() {
    await this.init();

    const result = await this.client.query("SELECT data FROM bot_state WHERE id = $1", [stateRowId]);
    if (result.rows.length > 0) {
      return normalizeState(result.rows[0].data);
    }

    const initialState = loadState(this.stateFile);
    await this.save(initialState);
    return initialState;
  }

  async save(state) {
    await this.init();
    await this.client.query(
      `INSERT INTO bot_state (id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [stateRowId, normalizeState(state)]
    );
  }

  async close() {
    await this.releaseLock();
    if (this.ready) await this.client.end();
  }

  async acquireLock() {
    await this.init();
    const result = await this.client.query("SELECT pg_try_advisory_lock($1) AS locked", [774411]);
    if (!result.rows[0]?.locked) {
      throw new Error("Instance lain kemungkinan sedang berjalan. PostgreSQL advisory lock gagal.");
    }
  }

  async releaseLock() {
    if (this.ready) {
      await this.client.query("SELECT pg_advisory_unlock($1)", [774411]);
    }
  }
}

export function createStateStore(runtimeConfig) {
  if (runtimeConfig.databaseUrl) {
    return new PostgresStateStore({
      databaseUrl: runtimeConfig.databaseUrl,
      stateFile: runtimeConfig.stateFile
    });
  }

  return new FileStateStore(runtimeConfig.stateFile);
}

export { createDefaultState };
