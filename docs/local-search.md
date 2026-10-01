# Local archive search (Step 13)

Search is a derived, offline view over canonical SQLite rows. It uses no network, AI, OCR, embeddings, or media bytes.

## Indexed content

- Trip: title and summary. Active drafts are included and rendered with a `Draft` label.
- Place: canonical name and string aliases. Each Place ID remains a separate result.
- Stop: confirmed Stop note and lodging label, only while its Trip is active.
- TripDay: user label, only while its Trip is active.
- Companion: display label and private note. Duplicate labels remain separate IDs.
- Chapter: name and description.
- Dream: Place name, note, and location context while the Dream is active and unarchived.
- TripMedia: user caption only, only while its Trip, placement, and Media are active.

The current schema has no Memory or Tag tables, so there are no canonical Memory/Tag rows to index in this step. Dates, coordinates, EXIF, filenames, reconstruction proposals, rejected suggestions, and binary media are not indexed. DateSpec is displayed as context for Trip results but is deliberately not searchable; this prevents unknown or approximate dates from becoming fabricated exact dates.

## Schema and synchronization

Migration 10 creates vault-scoped `search_documents`, external-content `search_fts` (FTS5 with `unicode61`, diacritic removal, and 2/3-character prefix indexes), and `search_index_state` at index version 1. Search-document triggers use the documented FTS delete/insert protocol. Canonical-table triggers refresh or remove documents in the same transaction as every create, edit, archive, trash, restore, or detach operation.

The migration backfill projects all existing canonical rows in stable `(vault_id, entity_type, entity_id)` order. It is atomic and restart-safe under the migration runner. `SearchRepository.rebuild()` is idempotent and vault-scoped. Portable archives omit all search tables; restore runs a final rebuild from restored canonical rows before commit.

## Query and ranking

Input is NFKC-normalized, bounded, split into Unicode letter/number tokens, quoted internally, and submitted only with bound parameters. Punctuation-only input returns no results, so raw FTS syntax cannot escape into the query. Terms use `AND`; each term is a prefix match. Matching Companion, Chapter, and Place documents also produce their active related Trips without copying relationship graphs into the index.

Ranking is deterministic and explainable:

1. exact title/name match;
2. all-term title/name prefix match;
3. other indexed text match, ordered with weighted FTS5 BM25 (title weight 8, body weight 1);
4. related Trip expansion after direct source matches;
5. stable title, type, and ID tie-breakers.

Results are capped at 30. Search does not expose raw FTS markup.

## Deletion and reconstruction semantics

Normal search excludes trashed Trips and their Stop/TripDay/caption documents; removed Stops and placements; removed Companions and Chapters; archived/removed Dreams; deleted Media; tombstoned rows; and unconfirmed Stops. Restoration makes canonical content searchable again transactionally. Draft suggestions are never indexed. Once reconstruction is accepted into confirmed canonical entities, those canonical rows are searchable.

Active Places remain searchable as independent canonical archive entities even if a Trip using one is trashed, matching the architecture's shared-Place lifecycle. There is no Trash search mode.

## Known limitations and runtime verification

There is no semantic matching, typo tolerance, stemming guarantee, quoted-phrase language, highlighting, date search, or substring match inside a token. Place results open the existing Places visited context because the application does not yet have a standalone Place detail route. Stop, TripDay, and caption hits open their owning Trip.

Android verification should cover title/Place/Companion/Chapter/Dream/note/caption queries, navigation, rename, trash/restore, archive/restore, force-stop plus offline relaunch, and punctuation-only/malformed input. Portable restore should be checked when a test package is available. Record device/build evidence in the implementation report; automated SQLite coverage is not a substitute for emulator verification.
