import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "chud.db"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS papers (
    id              TEXT PRIMARY KEY,      -- unguessable random id
    title           TEXT NOT NULL,
    data            TEXT NOT NULL,         -- JSON: ExtractedPaper (questions + mark schemes)
    has_mark_scheme INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,         -- unguessable random id; whoever has it owns the session
    paper_id     TEXT NOT NULL REFERENCES papers(id),
    topic        TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('teaching','examining','complete','error')),
    plan         TEXT NOT NULL,            -- JSON: LessonPlan
    exam         TEXT NOT NULL,            -- JSON: PaperQuestion[] (this topic's questions from the paper)
    transcript   TEXT NOT NULL,            -- JSON: Turn[]
    notebook     TEXT NOT NULL,            -- JSON: Notebook
    report       TEXT,                     -- JSON: ExamReport
    score        REAL,
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
`);

export function one<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: (string | number | null)[]) {
  return db.prepare(sql).run(...params);
}
