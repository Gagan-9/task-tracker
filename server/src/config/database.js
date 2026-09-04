import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'tracker.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance and concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  // 1. Settings Table (stores API keys, User ID, Team ID locally)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // 2. Tasks Master Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT,
      status_color TEXT,
      date_created TEXT,
      date_updated TEXT,
      date_closed TEXT,
      first_seen_assigned TEXT NOT NULL,
      last_seen_assigned TEXT,
      current_assignee_is_me INTEGER DEFAULT 1,
      custom_notes TEXT
    );
  `);

  // 3. Task Assignment History Ledger
  // Multi-month assignment tracking: even if a task is reassigned to a tester next day/month,
  // the historical assignment record for each month remains immutable.
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_assignment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      assigned_month TEXT NOT NULL,
      assigned_date TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(task_id, assigned_month)
    );
    CREATE INDEX IF NOT EXISTS idx_history_month ON task_assignment_history(assigned_month);
    CREATE INDEX IF NOT EXISTS idx_history_task ON task_assignment_history(task_id);
  `);

  // 4. Sync Logs Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      synced_at TEXT NOT NULL,
      tasks_found INTEGER DEFAULT 0,
      tasks_added INTEGER DEFAULT 0,
      tasks_updated INTEGER DEFAULT 0,
      status TEXT,
      error_message TEXT
    );
  `);

  return db;
}

export default db;
