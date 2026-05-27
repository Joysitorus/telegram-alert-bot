import fs from "fs";
import path from "path";
import { createDefaultState, loadState, normalizeState, saveState } from "./state.js";

const stateRowId = "default";

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rowToCandle(row) {
  return {
    timestamp: Number(row.timestamp),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume)
  };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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

  async saveCandles() {
    return { saved: 0, supported: false };
  }

  async loadCandles() {
    return [];
  }

  async loadCandlesRange() {
    return [];
  }

  async saveOrderBookLiquidity() {
    return { saved: 0, supported: false };
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
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS market_candles (
        exchange text NOT NULL,
        market_type text NOT NULL,
        symbol text NOT NULL,
        timeframe text NOT NULL,
        timestamp bigint NOT NULL,
        open double precision NOT NULL,
        high double precision NOT NULL,
        low double precision NOT NULL,
        close double precision NOT NULL,
        volume double precision NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (exchange, market_type, symbol, timeframe, timestamp)
      )
    `);
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS market_candles_lookup_idx
      ON market_candles (exchange, market_type, symbol, timeframe, timestamp DESC)
    `);
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS order_book_liquidity_zones (
        id text PRIMARY KEY,
        exchange text NOT NULL,
        market_type text NOT NULL,
        symbol text NOT NULL,
        timestamp bigint NOT NULL,
        mid_price double precision,
        spread_percent double precision,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS order_book_liquidity_zones_lookup_idx
      ON order_book_liquidity_zones (exchange, market_type, symbol, timestamp DESC)
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

  async saveCandles({ exchangeId, marketType, symbol, timeframe, candles }) {
    await this.init();
    const rows = (Array.isArray(candles) ? candles : [])
      .map((candle) => ({
        timestamp: finiteNumberOrNull(candle.timestamp),
        open: finiteNumberOrNull(candle.open),
        high: finiteNumberOrNull(candle.high),
        low: finiteNumberOrNull(candle.low),
        close: finiteNumberOrNull(candle.close),
        volume: finiteNumberOrNull(candle.volume)
      }))
      .filter((candle) => (
        candle.timestamp !== null &&
        candle.open !== null &&
        candle.high !== null &&
        candle.low !== null &&
        candle.close !== null &&
        candle.volume !== null
      ));

    if (rows.length === 0) return { saved: 0, supported: true };

    for (const chunk of chunkArray(rows, 500)) {
      const values = [];
      const placeholders = chunk.map((candle, index) => {
        const offset = index * 10;
        values.push(
          exchangeId,
          marketType,
          symbol,
          timeframe,
          candle.timestamp,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, now())`;
      });

      await this.client.query(
        `INSERT INTO market_candles (
          exchange, market_type, symbol, timeframe, timestamp, open, high, low, close, volume, fetched_at
        )
        VALUES ${placeholders.join(",")}
        ON CONFLICT (exchange, market_type, symbol, timeframe, timestamp)
        DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          fetched_at = now()`,
        values
      );
    }

    return { saved: rows.length, supported: true };
  }

  async loadCandles({ exchangeId, marketType, symbol, timeframe, limit }) {
    await this.init();
    const result = await this.client.query(
      `SELECT timestamp, open, high, low, close, volume
       FROM market_candles
       WHERE exchange = $1
         AND market_type = $2
         AND symbol = $3
         AND timeframe = $4
       ORDER BY timestamp DESC
       LIMIT $5`,
      [exchangeId, marketType, symbol, timeframe, Math.max(1, Number(limit) || 1000)]
    );

    return result.rows
      .reverse()
      .map(rowToCandle);
  }

  async loadCandlesRange({ exchangeId, marketType, symbol, timeframe, since = null, until = null, limit = 10000 }) {
    await this.init();
    const params = [exchangeId, marketType, symbol, timeframe];
    const conditions = [
      "exchange = $1",
      "market_type = $2",
      "symbol = $3",
      "timeframe = $4"
    ];

    if (since !== null && since !== undefined) {
      params.push(Number(since));
      conditions.push(`timestamp >= $${params.length}`);
    }
    if (until !== null && until !== undefined) {
      params.push(Number(until));
      conditions.push(`timestamp <= $${params.length}`);
    }

    params.push(Math.max(1, Number(limit) || 10000));
    const result = await this.client.query(
      `SELECT timestamp, open, high, low, close, volume
       FROM market_candles
       WHERE ${conditions.join(" AND ")}
       ORDER BY timestamp ASC
       LIMIT $${params.length}`,
      params
    );

    return result.rows.map(rowToCandle);
  }

  async saveOrderBookLiquidity({ exchangeId, marketType, symbol, snapshot }) {
    await this.init();
    if (!snapshot) return { saved: 0, supported: true };

    const timestamp = finiteNumberOrNull(snapshot.timestamp) || Date.now();
    const id = `${exchangeId}:${marketType}:${symbol}:${timestamp}`;

    await this.client.query(
      `INSERT INTO order_book_liquidity_zones (
        id, exchange, market_type, symbol, timestamp, mid_price, spread_percent, data, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT (id)
      DO UPDATE SET
        mid_price = EXCLUDED.mid_price,
        spread_percent = EXCLUDED.spread_percent,
        data = EXCLUDED.data,
        updated_at = now()`,
      [
        id,
        exchangeId,
        marketType,
        symbol,
        timestamp,
        finiteNumberOrNull(snapshot.midPrice),
        finiteNumberOrNull(snapshot.spreadPercent),
        snapshot
      ]
    );

    return { saved: 1, supported: true };
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
