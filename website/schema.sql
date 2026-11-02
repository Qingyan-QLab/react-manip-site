-- Website business database, separate from the evaluator's backend.sqlite3.
-- Apply to a NEW local/persistent-block SQLite file, never the OSS/FUSE /data mount.
-- The future gateway must enforce authentication and use parameterized SQL.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA secure_delete = ON;
BEGIN;
CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY CHECK(length(user_id) BETWEEN 1 AND 200),
    login_subject TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS teams (
    team_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(user_id),
    display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
    -- Gateway computes NFKC + trim + collapsed whitespace + lowercase.
    name_key TEXT NOT NULL UNIQUE CHECK(length(name_key) > 0),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(team_id, owner_id)
);
CREATE TABLE IF NOT EXISTS submissions (
    submission_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(user_id),
    team_id TEXT NOT NULL,
    team_display_name TEXT NOT NULL CHECK(length(team_display_name) BETWEEN 1 AND 120),
    profile_id TEXT NOT NULL,
    model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 120),
    model_version TEXT NOT NULL CHECK(length(model_version) BETWEEN 1 AND 120),
    -- Encrypted by the WEBSITE secret key, stored outside this database.
    model_endpoint_ciphertext BLOB NOT NULL,
    endpoint_key_id TEXT NOT NULL,
    -- No plaintext model API key column: the evaluator owns encrypted credentials.
    organization TEXT NOT NULL CHECK(length(organization) BETWEEN 1 AND 150),
    email TEXT NOT NULL CHECK(length(email) BETWEEN 1 AND 254),
    contact_method TEXT NOT NULL CHECK(contact_method IN ('phone', 'wechat')),
    contact_value TEXT NOT NULL CHECK(length(contact_value) BETWEEN 1 AND 64),
    submission_type TEXT NOT NULL CHECK(submission_type IN ('agent', 'model')),
    idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
    -- Keyed HMAC of canonical request bytes, not plaintext request JSON.
    request_hmac BLOB NOT NULL,
    evaluation_id TEXT UNIQUE,
    relay_state TEXT NOT NULL DEFAULT 'PREPARED' CHECK(relay_state IN ('PREPARED', 'ACCEPTED', 'UNCERTAIN', 'REJECTED')),
    status TEXT CHECK(status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'INVALID', 'FAILED', 'CANCELLED')),
    completed_episodes INTEGER NOT NULL DEFAULT 0 CHECK(completed_episodes BETWEEN 0 AND 720),
    score REAL CHECK(score IS NULL OR (score > -1.0e308 AND score < 1.0e308)),
    score_kind TEXT NOT NULL DEFAULT 'protocol' CHECK(score_kind = 'protocol'),
    official_score REAL CHECK(official_score IS NULL),
    eligible_for_ranking INTEGER NOT NULL DEFAULT 0 CHECK(eligible_for_ranking IN (0, 1)),
    bank_digest TEXT,
    result_version INTEGER NOT NULL DEFAULT 0 CHECK(result_version >= 0),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    finished_at INTEGER,
    videos_expires_at INTEGER,
    FOREIGN KEY(team_id, owner_id) REFERENCES teams(team_id, owner_id),
    UNIQUE(owner_id, idempotency_key),
    CHECK(eligible_for_ranking = 0 OR (status IS NOT NULL AND status = 'COMPLETED' AND completed_episodes = 720 AND score IS NOT NULL AND bank_digest IS NOT NULL AND finished_at IS NOT NULL)),
    CHECK(videos_expires_at IS NULL OR (finished_at IS NOT NULL AND videos_expires_at >= finished_at))
);
CREATE INDEX IF NOT EXISTS submissions_owner_page ON submissions(owner_id, created_at, submission_id);
CREATE INDEX IF NOT EXISTS submissions_team_profile ON submissions(team_id, profile_id, finished_at);
CREATE TABLE IF NOT EXISTS task_results (
    submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    score REAL,
    completed_episodes INTEGER NOT NULL DEFAULT 0 CHECK(completed_episodes BETWEEN 0 AND 45),
    result_version INTEGER NOT NULL CHECK(result_version >= 0),
    PRIMARY KEY(submission_id, task_id)
);
CREATE TABLE IF NOT EXISTS video_index (
    artifact_id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
    task_id TEXT NOT NULL,
    phase TEXT CHECK(phase IN ('practice', 'exam')),
    episode_index INTEGER,
    media_status TEXT NOT NULL CHECK(media_status IN ('PENDING', 'READY', 'ERROR', 'EXPIRED')),
    expires_at INTEGER,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    -- MP4 bytes and filesystem paths stay with the evaluator; no public URL column.
);
CREATE TABLE IF NOT EXISTS result_events (
    event_id TEXT NOT NULL,
    result_version INTEGER NOT NULL CHECK(result_version >= 1),
    evaluation_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    -- Only the verified, whitelisted result event; never model credentials or paths.
    event_json TEXT NOT NULL CHECK(json_valid(event_json)),
    received_at INTEGER NOT NULL DEFAULT (unixepoch()),
    applied_at INTEGER,
    PRIMARY KEY(event_id, result_version)
);
CREATE TABLE IF NOT EXISTS sync_checkpoints (
    stream TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO schema_versions(version) VALUES (1);
COMMIT;