# Fish Rain — Global Leaderboard Architecture & Security Guide

Fish Rain uses the established **Stab The Finger Arcade** Global Leaderboard architecture (modeled directly on **Parking Lot**'s zero-dependency `node:sqlite` + PHP PDO SQLite design).

---

## 1. End-to-End Flow

1. **Session Issuance (`POST /api/sessions`)**
   - When a run starts (`FishRainUI.launchGameRun`), the client requests a signed session token for `{ gameMode, startEnvId }`.
   - The server generates a random 128-bit hex `sessionId`, records `t = Date.now()`, and signs `{ v: 1, n, m: gameMode, e: startEnvId, t }` using **HMAC-SHA256**.
2. **Score Verification & Submission (`POST /api/scores`)**
   - Supports both **Manual Submission** on the Game Over / Victory screen and opt-in **Automatic Submission** (`stabthefinger_fishrain_v1_auto_submit`).
   - Server-side validation enforces:
     - `Content-Type: application/json` and payload size `<= 2048` bytes.
     - Per-IP fixed-window rate limiting.
     - Valid HMAC-SHA256 signature and 3-hour TTL on `token`.
     - Exact match between token `{ gameMode, startEnvId }` and submitted run mode/environment.
     - Wall-clock plausibility (`wallMs >= 2000ms` and `elapsedSeconds * 1000 <= wallMs + 5000ms`).
     - Mathematical score verification via shared `recomputeFinalScore()` (`js/scoring.js`), checking rarity catch bounds, level clear bonuses, flawless bonuses, combo milestone bonus, and achievement prerequisites.
     - One-time session consumption via `UNIQUE(session_id)` in SQLite (`409 duplicate` on replay).
3. **Leaderboard Retrieval (`GET /api/leaderboard`)**
   - Filter by `env` (`all` or `PUDDLE`..`OPEN_OCEAN`), `mode` (`all`, `CAMPAIGN`, `QUICK_PLAY`), and sort by `sort=score` (Overall High Score) or `sort=level` (Highest Level Reached).

---

## 2. SQLite Schema & Deterministic Tie-Breaking

```sql
CREATE TABLE scores (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT    NOT NULL UNIQUE,
  nickname         TEXT    NOT NULL CHECK (length(nickname) BETWEEN 1 AND 64),
  score            INTEGER NOT NULL CHECK (score BETWEEN 0 AND 500000),
  game_mode        TEXT    NOT NULL CHECK (game_mode IN ('CAMPAIGN', 'QUICK_PLAY')),
  start_env_id     TEXT    NOT NULL,
  highest_env_id   TEXT    NOT NULL,
  highest_level    INTEGER NOT NULL CHECK (highest_level BETWEEN 1 AND 8),
  levels_cleared   INTEGER NOT NULL CHECK (levels_cleared BETWEEN 0 AND 8),
  flawless_levels  INTEGER NOT NULL CHECK (flawless_levels BETWEEN 0 AND 8),
  fish_caught      INTEGER NOT NULL CHECK (fish_caught >= 0),
  legendary_caught INTEGER NOT NULL CHECK (legendary_caught >= 0),
  max_combo        INTEGER NOT NULL CHECK (max_combo >= 0),
  best_catch_name  TEXT    NOT NULL DEFAULT '',
  elapsed_seconds  INTEGER NOT NULL CHECK (elapsed_seconds BETWEEN 2 AND 7200),
  created_at       INTEGER NOT NULL
);
```

### Indexes
- `idx_scores_rank ON scores (score DESC, highest_level DESC, created_at ASC, id ASC)`
- `idx_scores_level_rank ON scores (highest_level DESC, score DESC, created_at ASC, id ASC)`
- `idx_scores_env_rank ON scores (highest_env_id, score DESC, created_at ASC, id ASC)`
- `idx_scores_mode_rank ON scores (game_mode, score DESC, created_at ASC, id ASC)`
