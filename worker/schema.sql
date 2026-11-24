-- EMI chat backend (Cloudflare D1)

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author      TEXT    NOT NULL,                 -- 'xiaole' | 'emi' | 'system'
  text        TEXT    NOT NULL DEFAULT '',
  source      TEXT    NOT NULL,                 -- 'web' | 'discord'
  created_at  INTEGER NOT NULL,                 -- ms since epoch
  updated_at  INTEGER NOT NULL,                 -- bumps on any change, drives /api/sync
  edited_at   INTEGER,
  deleted     INTEGER NOT NULL DEFAULT 0,
  pinned      INTEGER NOT NULL DEFAULT 0,
  discord_id  TEXT,
  reply_to    INTEGER,
  reactions   TEXT    NOT NULL DEFAULT '{}',    -- {"emi_heart": ["emi"], "...": ["xiaole"]}
  attachments TEXT    NOT NULL DEFAULT '[]',    -- [{"id": 1, "type": "image/png", "size": 1234}]
  sticker     TEXT,                             -- 'emi_heart' etc. when the whole message is a sticker
  delivered   INTEGER NOT NULL DEFAULT 1        -- web messages are 0 until the bot picks them up
);
CREATE INDEX IF NOT EXISTS idx_messages_updated ON messages(updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_discord ON messages(discord_id) WHERE discord_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    NOT NULL,
  data       BLOB    NOT NULL,
  created_at INTEGER NOT NULL
);

-- Things the bot still has to mirror to Discord (new web messages, edits, deletes).
CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL,                  -- 'send' | 'edit' | 'delete'
  message_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(done, id);

CREATE TABLE IF NOT EXISTS state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT    NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, at);
