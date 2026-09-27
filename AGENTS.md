# Trip Memory Vault — Agent Instructions

Read `docs/architecture.md` before implementing any milestone.

Treat `docs/architecture.md` as the authoritative product and technical architecture.

## Working rules

- Implement one scoped milestone at a time.
- Keep the application local-first.
- Do not add backend, authentication, Supabase, or cloud sync unless explicitly requested.
- This project uses Expo development builds, not Expo Go.
- Unknown historical information must remain unknown. Never invent dates, routes, locations, or metadata.
- Preserve original media metadata separately from user corrections.
- Prefer the smallest correct, scoped change; Step 0 smoke tests are disposable.
- Avoid unnecessary dependencies and abstractions.
- Do not rewrite unrelated files.
- Run only checks relevant to the current milestone.
- Do not commit or push unless explicitly requested.
- End implementation reports with `READY FOR NEXT STEP` or `NOT READY`.
