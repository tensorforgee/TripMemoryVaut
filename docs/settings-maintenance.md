# Settings and local vault maintenance

Step 14 adds a local control surface at **My Travel Life → Settings**. It does not add an account, cloud backup, sync, analytics, remote logging, or new permissions.

## Sections

- **Archive** links to the existing portable export and verified restore workflow. Export includes canonical data and app-owned originals; restore still requires an empty vault.
- **Storage** reports Trip and unique Media counts plus app-owned originals, preview derivatives, SQLite logical size, and staging files. Files outside the app-owned vault directory, including the external photo library, are not counted. SQLite size is labeled as an estimate because WAL and transient space can vary.
- **Maintenance** rebuilds missing display/thumbnail files, removes unregistered preview files, removes stale unreferenced or terminal-job staging files, reconciles original availability records, and reuses the Step 13 search rebuild.
- **Vault integrity** is read-only. It checks SQLite integrity and foreign keys, the known migration ledger, original presence/size/SHA-256, local file records, the canonical search projection, and interrupted import/staging state. Missing or corrupt originals are reported, never deleted or guessed back into existence.
- **Privacy** states the implemented behavior: local sandboxed archive, no account or cloud sync, selected-item system photo picker, no current/background location permission, no contacts permission, local Dreams, and local search.
- **About** displays app/build information when available, the current database schema version, and the portable export format version.

## Storage and maintenance semantics

Original media is authoritative evidence and is never targeted by preview or staging cleanup. Display and thumbnail files are derived from originals and can be rebuilt. Staging files are temporary, but cleanup removes one only when it is older than 24 hours and either has no import record or belongs to a terminal archived/unsupported item. Active, failed, and recovery-relevant staging is retained.

Reconcile availability derives only local file state from immutable Media hash/size metadata. It does not change Trips, Places, Stops, dates, captions, Dreams, or original source metadata. Search rebuild likewise replaces only local derived search documents.

## Delete all local vault data

The danger-zone action requires revealing the confirmation panel, typing `DELETE`, pressing the destructive button, and accepting the native confirmation alert. It recommends export first. A reset marker is durably written outside the vault before the database or files are changed. The flow transactionally removes every canonical and derived row while retaining the known schema/migration ledger, creates a fresh empty vault identity, removes the old app-owned vault directory (originals, derivatives, and staging), and clears the marker. If interrupted, startup repeats that idempotent reset before presenting the vault, preventing a partial reset from appearing healthy.

This is logical deletion from app storage, not a claim of forensic secure erasure on flash storage. Portable exports saved elsewhere are not deleted.

## Android runtime verification

Use a disposable vault for destructive verification.

1. Open My Travel Life → Settings and verify Archive actions open the existing export/restore screen.
2. Confirm storage values render and explicitly exclude the external photo library.
3. Run the integrity check, search rebuild, preview regeneration, orphan cleanup, stale-staging cleanup, and availability reconciliation.
4. Hash at least one original before and after maintenance; it must be unchanged.
5. Confirm Privacy and About text, force-stop, relaunch offline, and repeat the storage/integrity reads.
6. Export or create a disposable vault. Open Delete all local vault data, cancel once after typing the phrase, and confirm the vault is unchanged.
7. Repeat and confirm deletion. Verify the Trips screen is empty, the app cold-starts, the old vault media directory is absent, and there are no JS/native crashes.

## Known limitations

- Database bytes are a SQLite logical-size estimate and do not promise exact filesystem allocation.
- Integrity verification is intentionally foreground and can take time for a large photo archive because it hashes originals.
- Maintenance reports missing/corrupt originals but cannot reconstruct authoritative bytes without a user-provided verified archive or re-import.
- Local reset cannot remove exports the user saved outside the app or guarantee forensic erasure.
