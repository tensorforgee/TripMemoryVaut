export const reconstructionSchema = `
CREATE TABLE draft_suggestions (
 id TEXT PRIMARY KEY NOT NULL, vault_id TEXT NOT NULL, trip_id TEXT NOT NULL, run_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('run','section','location')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 algorithm_version INTEGER NOT NULL CHECK(algorithm_version>0),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','rejected')),
 resolution_json TEXT CHECK(resolution_json IS NULL OR json_valid(resolution_json)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(vault_id,trip_id,id),
 FOREIGN KEY(vault_id,trip_id) REFERENCES trips(vault_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(vault_id,trip_id,run_id) REFERENCES draft_suggestions(vault_id,trip_id,id) ON DELETE RESTRICT,
 CHECK((kind='run' AND run_id IS NULL) OR (kind!='run' AND run_id IS NOT NULL))
) STRICT;
CREATE INDEX suggestions_trip_state ON draft_suggestions(vault_id,trip_id,state,created_at,id);
CREATE INDEX suggestions_run ON draft_suggestions(run_id);
CREATE TRIGGER suggestions_evidence_immutable BEFORE UPDATE OF vault_id,trip_id,run_id,kind,evidence_json,algorithm_version ON draft_suggestions
BEGIN SELECT RAISE(ABORT,'Suggestion evidence is immutable'); END;
CREATE TRIGGER suggestions_decision_final BEFORE UPDATE ON draft_suggestions
WHEN OLD.state!='pending'
BEGIN SELECT RAISE(ABORT,'Resolved suggestions are historical records'); END;
CREATE TRIGGER suggestions_live_parent BEFORE INSERT ON draft_suggestions
WHEN NOT EXISTS(SELECT 1 FROM trips t JOIN vaults v ON v.id=t.vault_id WHERE t.id=NEW.trip_id AND t.vault_id=NEW.vault_id AND t.deleted_at IS NULL AND v.deleted_at IS NULL)
 OR (NEW.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM draft_suggestions WHERE id=NEW.run_id AND kind='run' AND vault_id=NEW.vault_id AND trip_id=NEW.trip_id))
BEGIN SELECT RAISE(ABORT,'Suggestion requires active trip and matching run'); END;
`;
