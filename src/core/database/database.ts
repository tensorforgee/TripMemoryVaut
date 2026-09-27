export type SqlValue = string | number | null | Uint8Array;

// The small common SQLite surface permits real-SQLite host tests of the same SQL.
export interface SqlConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}

export async function configureConnection(connection: SqlConnection): Promise<void> {
  await connection.execAsync('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  const row = await connection.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
  if (row?.foreign_keys !== 1) throw new Error('SQLite foreign keys could not be enabled');
}

export async function inTransaction<T>(connection: SqlConnection, task: (connection: SqlConnection) => Promise<T>): Promise<T> {
  await connection.execAsync('BEGIN IMMEDIATE');
  try {
    const result = await task(connection);
    await connection.execAsync('COMMIT');
    return result;
  } catch (error) {
    try { await connection.execAsync('ROLLBACK'); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'SQLite transaction and rollback failed');
    }
    throw error;
  }
}

export class LocalDatabase {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(private readonly connection: SqlConnection) {}

  // Reads also enter the queue so they cannot join an unrelated async transaction.
  run<T>(task: (connection: SqlConnection) => Promise<T>): Promise<T> {
    const operation = this.queue.then(() => {
      if (this.closed) throw new Error('Database is closed');
      return task(this.connection);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  transaction<T>(task: (connection: SqlConnection) => Promise<T>): Promise<T> {
    return this.run(connection => inTransaction(connection, task));
  }

  close(): Promise<void> {
    return this.run(async connection => {
      await connection.closeAsync();
      this.closed = true;
    });
  }
}
