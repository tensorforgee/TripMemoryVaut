// Immutable after release. Future changes belong in a new numbered migration.
export const initialSchema = `
CREATE TABLE vaults (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  format_version INTEGER NOT NULL DEFAULT 1 CHECK (format_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE trips (
  id TEXT PRIMARY KEY NOT NULL,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'saved')),
  dates_json TEXT NOT NULL CHECK (json_valid(dates_json) AND json_type(dates_json) = 'object'),
  sort_date TEXT,
  sort_precision TEXT NOT NULL CHECK (sort_precision IN ('day', 'month', 'year', 'unknown')),
  duration_estimate_days INTEGER CHECK (duration_estimate_days > 0),
  summary TEXT CHECK (summary IS NULL OR length(trim(summary)) > 0),
  is_favourite INTEGER NOT NULL DEFAULT 0 CHECK (is_favourite IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (vault_id, id),
  CHECK ((sort_precision = 'unknown' AND sort_date IS NULL)
    OR (sort_precision != 'unknown' AND sort_date IS NOT NULL))
) STRICT;

CREATE INDEX trips_vault_status_date ON trips(vault_id, status, deleted_at, sort_date, id);

CREATE TRIGGER trips_live_vault_insert BEFORE INSERT ON trips
WHEN NOT EXISTS (SELECT 1 FROM vaults WHERE id = NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Trip requires an active vault'); END;

CREATE TRIGGER trips_live_vault_update BEFORE UPDATE ON trips
WHEN NOT EXISTS (SELECT 1 FROM vaults WHERE id = NEW.vault_id AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Trip requires an active vault'); END;
`;
