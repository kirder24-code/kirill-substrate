import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export interface SqliteClientOptions {
  databasePath?: string;
}

export function getDefaultDatabasePath(): string {
  return resolve(process.cwd(), ".data", "linkedin-brand-os.sqlite");
}

export function createSqliteClient(
  options: SqliteClientOptions = {}
): Database.Database {
  const databasePath = options.databasePath ?? getDefaultDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });
  return new Database(databasePath);
}
