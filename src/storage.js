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

function safeIdPart(value, fallback = "na") {
  return String(value ?? fallback).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function getResearchRecordId(prefix, record, index = 0) {
  if (record?.id) return record.id;
  const at = finiteNumberOrNull(record?.at) || Date.now();
  const exchange = safeIdPart(record?.exchange || "exchange");
  const symbol = safeIdPart(record?.symbol || "symbol");
  const timeframe = safeIdPart(record?.timeframe || "timeframe");
  const candleTime = safeIdPart(record?.candleTime ?? record?.debug?.lastCandleTime ?? record?.timestamp ?? "no_candle");
  return `${prefix}:${exchange}:${symbol}:${timeframe}:${at}:${candleTime}:${index}`;
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
  constructor({ databaseUrl, stateFile, dataRetentionDays = 30 }) {
    this.type = "postgres";
    this.stateFile = stateFile;
    this.databaseUrl = databaseUrl;
    this.dataRetentionDays = Number(dataRetentionDays) || 30;
    this.client = null;
    this.ready = false;
    this.syncedLessonIds = new Set();
    this.syncedLessonStats = new Map();
    this.syncedSignalDecisionIds = new Set();
    this.syncedMarketSnapshotIds = new Set();
    this.lastCleanupAt = 0;
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
      CREATE TABLE IF NOT EXISTS bot_signal_decisions (
        id text PRIMARY KEY,
        exchange text,
        market_type text,
        symbol text,
        timeframe text,
        accepted boolean,
        reason text,
        direction text,
        entry_mode text,
        score double precision,
        rr double precision,
        candle_time bigint,
        decided_at bigint,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS bot_signal_decisions_lookup_idx
      ON bot_signal_decisions (exchange, market_type, symbol, timeframe, decided_at DESC)
    `);
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS bot_signal_decisions_acceptance_idx
      ON bot_signal_decisions (accepted, decided_at DESC)
    `);
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        id text PRIMARY KEY,
        exchange text,
        market_type text,
        symbol text,
        timeframe text,
        candle_time bigint,
        open double precision,
        high double precision,
        low double precision,
        close double precision,
        volume double precision,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS market_snapshots_lookup_idx
      ON market_snapshots (exchange, market_type, symbol, timeframe, candle_time DESC)
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
    await this.saveResearchWarehouse(normalizedState);
    await this.cleanupOldDataIfDue();
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

  async saveResearchWarehouse(state) {
    await this.saveSignalDecisions(state.research?.signalDecisions || []);
    await this.saveMarketSnapshots(state.research?.marketSnapshots || []);
  }

  async saveSignalDecisions(decisions) {
    for (let index = 0; index < decisions.length; index += 1) {
      const decision = decisions[index];
      const id = getResearchRecordId("signal_decision", decision, index);
      if (this.syncedSignalDecisionIds.has(id)) continue;

      await this.client.query(
        `INSERT INTO bot_signal_decisions (
          id, exchange, market_type, symbol, timeframe, accepted, reason, direction, entry_mode,
          score, rr, candle_time, decided_at, data, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
        ON CONFLICT (id)
        DO UPDATE SET
          exchange = EXCLUDED.exchange,
          market_type = EXCLUDED.market_type,
          symbol = EXCLUDED.symbol,
          timeframe = EXCLUDED.timeframe,
          accepted = EXCLUDED.accepted,
          reason = EXCLUDED.reason,
          direction = EXCLUDED.direction,
          entry_mode = EXCLUDED.entry_mode,
          score = EXCLUDED.score,
          rr = EXCLUDED.rr,
          candle_time = EXCLUDED.candle_time,
          decided_at = EXCLUDED.decided_at,
          data = EXCLUDED.data,
          updated_at = now()`,
        [
          id,
          decision.exchange || null,
          decision.marketType || decision.market?.type || null,
          decision.symbol || null,
          decision.timeframe || null,
          decision.accepted === undefined ? null : Boolean(decision.accepted),
          decision.reason || decision.paperRejectReason || null,
          decision.direction || null,
          decision.entryMode || decision.debug?.entryMode || null,
          finiteNumberOrNull(decision.score),
          finiteNumberOrNull(decision.rr),
          finiteNumberOrNull(decision.candleTime ?? decision.debug?.lastCandleTime),
          finiteNumberOrNull(decision.at),
          { ...decision, id }
        ]
      );
      this.syncedSignalDecisionIds.add(id);
    }
  }

  async saveMarketSnapshots(snapshots) {
    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index];
      const id = getResearchRecordId("market_snapshot", snapshot, index);
      if (this.syncedMarketSnapshotIds.has(id)) continue;

      await this.client.query(
        `INSERT INTO market_snapshots (
          id, exchange, market_type, symbol, timeframe, candle_time, open, high, low, close, volume, data, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
        ON CONFLICT (id)
        DO UPDATE SET
          exchange = EXCLUDED.exchange,
          market_type = EXCLUDED.market_type,
          symbol = EXCLUDED.symbol,
          timeframe = EXCLUDED.timeframe,
          candle_time = EXCLUDED.candle_time,
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          data = EXCLUDED.data,
          updated_at = now()`,
        [
          id,
          snapshot.exchange || null,
          snapshot.marketType || snapshot.market?.type || null,
          snapshot.symbol || null,
          snapshot.timeframe || null,
          finiteNumberOrNull(snapshot.candleTime ?? snapshot.timestamp),
          finiteNumberOrNull(snapshot.open),
          finiteNumberOrNull(snapshot.high),
          finiteNumberOrNull(snapshot.low),
          finiteNumberOrNull(snapshot.close),
          finiteNumberOrNull(snapshot.volume),
          { ...snapshot, id }
        ]
      );
      this.syncedMarketSnapshotIds.add(id);
    }
  }

  async cleanupOldDataIfDue() {
    const retentionDays = Math.max(1, Number(this.dataRetentionDays) || 30);
    const now = Date.now();
    if (now - this.lastCleanupAt < 6 * 60 * 60 * 1000) return;
    this.lastCleanupAt = now;

    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    await this.client.query("DELETE FROM bot_signal_decisions WHERE decided_at IS NOT NULL AND decided_at < $1", [cutoff]);
    await this.client.query("DELETE FROM market_snapshots WHERE candle_time IS NOT NULL AND candle_time < $1", [cutoff]);
    await this.client.query("DELETE FROM market_candles WHERE timestamp < $1", [cutoff]);
    await this.client.query("DELETE FROM order_book_liquidity_zones WHERE timestamp < $1", [cutoff]);
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
      stateFile: runtimeConfig.stateFile,
      dataRetentionDays: runtimeConfig.dataRetentionDays
    });
  }

  return new FileStateStore(runtimeConfig.stateFile);
}

export { createDefaultState };
