# Scoped Step 1 database foundation

This milestone follows the requested vault/Trip foundation scope. It does not
implement the architecture's four-tab shell or the remaining domain schema.

## Concrete implementation decisions

- App startup opens `vault.sqlite` in Expo SQLite's durable default directory.
  Migration and vault initialization finish before existing routes are shown.
  Errors block initialization and expose a recovery snapshot path when available;
  no empty replacement database is substituted. One vault UUID is created once.
- Each filename has one shared initialization promise and one connection for the
  app process. Reads and writes share a serial queue; writes use `BEGIN IMMEDIATE`.
  This prevents unrelated async calls from joining another call's transaction.
  Every connection, including backup connections, enables foreign keys, WAL,
  a 5-second busy timeout, and `synchronous=FULL`.
- Numbered migrations are immutable SQL strings in TypeScript modules, avoiding
  a Metro SQL-loader dependency. SHA-256 checksums cover their exact contents.
  The append-only ledger is cross-checked against SQLite `user_version`; unknown
  versions, missing ledger entries, and changed checksums fail closed.
- Pending migrations run together in one transaction after a SQLite API backup.
  Integrity and foreign-key checks run before and after migration. Failed SQL
  rolls back and restores the snapshot. Snapshots remain in the SQLite directory
  as `<database>.before-migration-<uuid>.sqlite` for recovery; there is no automatic
  snapshot-retention/deletion policy in this milestone.
- `vaults`, `trips`, and `schema_migrations` are the only tables. Trip media/memory
  references and route-order fields are deferred until their owning features.
  Physical vault deletion is restricted while trips reference it; triggers reject
  writes under a missing/deleted vault. Reads exclude deleted trips and vaults.
- Date validation accepts Gregorian years 0001–9999 and uses calendar ranges to
  check feasible mixed-precision order. Fully unknown endpoints require unknown
  certainty. Precision and certainty remain independent for known values.
  A null end remains unknown. Sort keys use the earliest bound of a known start
  solely for ordering; an unknown start has a null sort key even if the end is
  known. Canonical DateSpec JSON is never replaced by the derived key.
- Draft creation requires a nonempty title. Dates default to unknown; durations
  default to null and are never inferred. Basic edits include title, DateSpec,
  status, optional summary/estimated duration, and favourite. Omitted patch fields
  remain unchanged; explicit null clears nullable fields; undefined is invalid.
- Trip lists default to 50 rows (maximum 100), with limit/offset pagination for
  this small foundation. Known starts sort descending, undated trips last, and
  UUID breaks ties. Later UI pagination can evolve with its own requirements.
- `expo-crypto` 57.0.3 supplies native random UUIDv4 and SHA-256. Existing package
  versions are unchanged. No additional test framework or database library is
  installed: host tests use Node 24's real SQLite and test runner.

## Verification entry points

`pnpm run test:step1` compiles the platform-independent domain/database/repository
code into ignored `.expo/step1-tests` and runs focused tests on temporary SQLite
files. `pnpm run typecheck` also checks the native adapter and development route.

In an Expo development build, `/database-test` has one verification button. It
uses a separate `step1-check-<uuid>.sqlite` fixture, never the real vault, and
checks native backup/recovery, migration idempotence/checksums, UUID creation,
CRUD, unknown/approximate dates, and persistence across connection reopen.
Fixture databases and snapshots are deliberately retained on the development
device for inspection. The verification screen is unavailable in release mode.
