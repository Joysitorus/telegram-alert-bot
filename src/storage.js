import fs from "fs";
import path from "path";
import { createDefaultState, loadState, normalizeState, saveState } from "./state.js";

const stateRowId = "default";

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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
    this.syncedLessonIds = new Set();
    this.syncedLessonStats = new Map();
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
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS bot_lessons (
        id text PRIMARY KEY,
        source text,
        symbol text,
        timeframe text,
        direction text,
        outcome text,
        success boolean,
        realized_r double precision,
        opened_at bigint,
        closed_at bigint,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS bot_lesson_stats (
        id text PRIMARY KEY,
        scope text,
        key text,
        samples integer,
        wins integer,
        losses integer,
        win_rate double precision,
        avg_r double precision,
        current_losing_streak integer,
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
    const normalizedState = normalizeState(state);
    await this.client.query(
      `INSERT INTO bot_state (id, data, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [stateRowId, normalizedState]
    );
    await this.saveLessons(normalizedState);
  }

  async saveLessons(state) {
    const lessons = state.research?.lessons || [];
    const stats = Object.entries(state.research?.lessonStats || {});

    for (const lesson of lessons) {
      if (this.syncedLessonIds.has(lesson.id)) continue;
      await this.client.query(
        `INSERT INTO bot_lessons (
          id, source, symbol, timeframe, direction, outcome, success, realized_r, opened_at, closed_at, data, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        ON CONFLICT (id)
        DO UPDATE SET
          source = EXCLUDED.source,
          symbol = EXCLUDED.symbol,
          timeframe = EXCLUDED.timeframe,
          direction = EXCLUDED.direction,
          outcome = EXCLUDED.outcome,
          success = EXCLUDED.success,
          realized_r = EXCLUDED.realized_r,
          opened_at = EXCLUDED.opened_at,
          closed_at = EXCLUDED.closed_at,
          data = EXCLUDED.data,
          updated_at = now()`,
        [
          lesson.id,
          lesson.source || null,
          lesson.symbol || null,
          lesson.timeframe || null,
          lesson.direction || null,
          lesson.outcome || null,
          Boolean(lesson.success),
          Number(lesson.realizedR) || 0,
          finiteNumberOrNull(lesson.openedAt),
          finiteNumberOrNull(lesson.closedAt),
          lesson
        ]
      );
      this.syncedLessonIds.add(lesson.id);
    }

    for (const [id, stat] of stats) {
      const fingerprint = JSON.stringify(stat);
      if (this.syncedLessonStats.get(id) === fingerprint) continue;
      await this.client.query(
        `INSERT INTO bot_lesson_stats (
          id, scope, key, samples, wins, losses, win_rate, avg_r, current_losing_streak, data, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        ON CONFLICT (id)
        DO UPDATE SET
          scope = EXCLUDED.scope,
          key = EXCLUDED.key,
          samples = EXCLUDED.samples,
          wins = EXCLUDED.wins,
          losses = EXCLUDED.losses,
          win_rate = EXCLUDED.win_rate,
          avg_r = EXCLUDED.avg_r,
          current_losing_streak = EXCLUDED.current_losing_streak,
          data = EXCLUDED.data,
          updated_at = now()`,
        [
          id,
          stat.scope || null,
          stat.key || null,
          Number(stat.samples) || 0,
          Number(stat.wins) || 0,
          Number(stat.losses) || 0,
          Number(stat.winRate) || 0,
          Number(stat.avgR) || 0,
          Number(stat.currentLosingStreak) || 0,
          stat
        ]
      );
      this.syncedLessonStats.set(id, fingerprint);
    }
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
