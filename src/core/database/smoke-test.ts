import { openDatabaseAsync } from 'expo-sqlite';

// Disposable native SQLite check: no vault file, tables, or migrations.
export async function runSQLiteSmokeTest(): Promise<void> {
  const db = await openDatabaseAsync(':memory:', { useNewConnection: true });
  try {
    const row = await db.getFirstAsync<{ value: number }>('SELECT 1 AS value');
    if (row?.value !== 1) {
      throw new Error('SELECT 1 did not return 1');
    }
  } finally {
    await db.closeAsync();
  }
}
