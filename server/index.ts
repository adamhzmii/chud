import express, { type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { one, run } from "./db.js";
import {
  AIError, MOCK, SIMPLE_TOPICS, chudTurn, extractPaper, gradeExam, initialNotebook, planLesson, takeExam, tally,
  type ExamReport, type ExtractedPaper, type LessonPlan, type Notebook, type PaperQuestion, type Turn, type UploadFile,
} from "./ai.js";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // raw bytes across all files (API request limit is 32 MB after base64)
const MAX_FILES = 20;
const MAX_MESSAGE = 4_000;
const MAX_TURNS = 40;
const FILE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32mb" }));

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const h = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);

function text(v: unknown, field: string, max: number): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new HttpError(400, `${field} is required.`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max.toLocaleString()} characters.`);
  return s;
}

function files(v: unknown, field: string, required: boolean): UploadFile[] {
  if (v == null || (Array.isArray(v) && v.length === 0)) {
    if (required) throw new HttpError(400, `Please upload the ${field}.`);
    return [];
  }
  if (!Array.isArray(v) || v.length > MAX_FILES) throw new HttpError(400, `Upload up to ${MAX_FILES} files for the ${field}.`);
  return v.map((f) => {
    if (!f || typeof f.data !== "string" || typeof f.type !== "string") throw new HttpError(400, `Invalid ${field} file.`);
    if (!FILE_TYPES.has(f.type)) throw new HttpError(400, `${f.name ?? "File"}: upload a PDF or an image (PNG, JPG, GIF, WebP).`);
    return { name: String(f.name ?? "file"), type: f.type, data: f.data };
  });
}

const id = () => randomBytes(16).toString("hex");

/* ------------------------------------------------------------------ */
/* Papers                                                              */
/* ------------------------------------------------------------------ */

interface PaperRow { id: string; title: string; data: string; has_mark_scheme: number }

function loadPaper(pid: string): PaperRow {
  const row = one<PaperRow>("SELECT * FROM papers WHERE id = ?", pid);
  if (!row) throw new HttpError(404, "Paper not found.");
  return row;
}

function paperView(row: PaperRow) {
  const paper = JSON.parse(row.data) as ExtractedPaper;
  const byTopic = new Map<string, { topic: string; questions: number; marks: number; simple: boolean }>();
  for (const q of paper.questions) {
    const t = byTopic.get(q.topic) ?? { topic: q.topic, questions: 0, marks: 0, simple: SIMPLE_TOPICS.has(q.topic) };
    t.questions += 1;
    t.marks += q.marks;
    byTopic.set(q.topic, t);
  }
  return {
    id: row.id,
    title: paper.title,
    calculator: paper.calculator,
    has_mark_scheme: !!row.has_mark_scheme,
    question_count: paper.questions.length,
    total_marks: paper.questions.reduce((s, q) => s + q.marks, 0),
    skipped: paper.skipped,
    // Simple topics first, then by number of questions.
    topics: [...byTopic.values()].sort((a, b) => Number(b.simple) - Number(a.simple) || b.questions - a.questions),
  };
}

app.get("/api/config", (_req, res) => res.json({ mock: MOCK }));

app.post("/api/papers", h(async (req, res) => {
  const paper = files(req.body?.paper, "exam paper", true);
  const scheme = files(req.body?.markScheme, "mark scheme", false);
  const bytes = [...paper, ...scheme].reduce((s, f) => s + Math.floor((f.data.length * 3) / 4), 0);
  if (bytes > MAX_UPLOAD_BYTES) throw new HttpError(413, "Files are too large. Keep the total under 20 MB.");
  const extracted = await extractPaper(paper, scheme);
  if (!extracted.questions.length) throw new HttpError(422, "Couldn't find any maths questions in that upload. Is it a GCSE maths paper?");
  const pid = id();
  run("INSERT INTO papers (id, title, data, has_mark_scheme) VALUES (?, ?, ?, ?)", pid, extracted.title, JSON.stringify(extracted), scheme.length ? 1 : 0);
  res.status(201).json({ paper: paperView(loadPaper(pid)) });
}));

app.get("/api/papers/:id", h((req, res) => res.json({ paper: paperView(loadPaper(String(req.params.id))) })));

/* ------------------------------------------------------------------ */
/* Teaching sessions                                                   */
/* ------------------------------------------------------------------ */

interface SessionRow {
  id: string; paper_id: string; topic: string; status: "teaching" | "examining" | "complete" | "error";
  plan: string; exam: string; transcript: string; notebook: string; report: string | null; score: number | null; error: string | null;
}

function loadSession(sid: string): SessionRow {
  const row = one<SessionRow>("SELECT * FROM sessions WHERE id = ?", sid);
  if (!row) throw new HttpError(404, "Session not found.");
  return row;
}

/** What the browser sees. The paper's questions stay hidden until the exam is done. */
function sessionView(row: SessionRow) {
  const plan = JSON.parse(row.plan) as LessonPlan;
  const exam = JSON.parse(row.exam) as PaperQuestion[];
  const transcript = JSON.parse(row.transcript) as Turn[];
  const report = row.report ? (JSON.parse(row.report) as ExamReport) : null;
  const paper = JSON.parse(loadPaper(row.paper_id).data) as ExtractedPaper;
  return {
    id: row.id,
    paper_id: row.paper_id,
    paper_title: paper.title,
    topic: row.topic,
    status: row.status,
    error: row.error,
    score: row.score,
    title: plan.title,
    objectives: plan.objectives,
    exam_count: exam.length,
    exam_marks: exam.reduce((s, q) => s + q.marks, 0),
    transcript: transcript.map(({ role, text, mood }) => ({ role, text, mood })),
    notebook: JSON.parse(row.notebook) as Notebook,
    turns: transcript.filter((t) => t.role === "you").length,
    max_turns: MAX_TURNS,
    report: report ? { ...report, questions: exam } : null,
  };
}

app.post("/api/sessions", h(async (req, res) => {
  const paperRow = loadPaper(text(req.body?.paperId, "Paper", 64));
  const topic = text(req.body?.topic, "Topic", 80);
  const paper = JSON.parse(paperRow.data) as ExtractedPaper;
  const exam = paper.questions.filter((q) => q.topic === topic);
  if (!exam.length) throw new HttpError(400, `This paper has no questions on ${topic}.`);
  const plan = await planLesson(topic, exam);
  const sid = id();
  const opening: Turn = { role: "chud", text: plan.opening_line, mood: "confused", api: "" }; // display-only
  run(
    "INSERT INTO sessions (id, paper_id, topic, status, plan, exam, transcript, notebook) VALUES (?, ?, ?, 'teaching', ?, ?, ?, ?)",
    sid, paperRow.id, topic, JSON.stringify(plan), JSON.stringify(exam), JSON.stringify([opening]), JSON.stringify(initialNotebook(plan)),
  );
  res.status(201).json({ session: sessionView(loadSession(sid)) });
}));

app.get("/api/sessions/:id", h((req, res) => res.json({ session: sessionView(loadSession(String(req.params.id))) })));

const busy = new Set<string>();

app.post("/api/sessions/:id/messages", h(async (req, res) => {
  const sid = String(req.params.id);
  const row = loadSession(sid);
  if (row.status !== "teaching") throw new HttpError(409, "Chud has already gone to the exam.");
  const msg = text(req.body?.text, "Message", MAX_MESSAGE);
  const transcript = JSON.parse(row.transcript) as Turn[];
  if (transcript.filter((t) => t.role === "you").length >= MAX_TURNS) throw new HttpError(409, "Message limit reached. Send Chud to the exam.");
  if (busy.has(sid)) throw new HttpError(429, "Chud is still thinking.");
  busy.add(sid);
  try {
    const plan = JSON.parse(row.plan) as LessonPlan;
    const { turn, youApi, chudApi } = await chudTurn(plan.title, JSON.parse(row.notebook), transcript.filter((t) => t.api), msg);
    transcript.push({ role: "you", text: msg, api: youApi }, { role: "chud", text: turn.reply, mood: turn.mood, api: chudApi });
    run("UPDATE sessions SET transcript = ?, notebook = ? WHERE id = ?", JSON.stringify(transcript), JSON.stringify(turn.notebook), sid);
  } finally {
    busy.delete(sid);
  }
  res.json({ session: sessionView(loadSession(sid)) });
}));

app.post("/api/sessions/:id/exam", h(async (req, res) => {
  const sid = String(req.params.id);
  const row = loadSession(sid);
  if (row.status !== "teaching" && row.status !== "error") throw new HttpError(409, "The exam has already started.");
  const transcript = JSON.parse(row.transcript) as Turn[];
  if (!transcript.some((t) => t.role === "you")) throw new HttpError(400, "Teach Chud something first.");
  if (busy.has(sid)) throw new HttpError(429, "Chud is still thinking.");
  busy.add(sid);
  run("UPDATE sessions SET status = 'examining', error = NULL WHERE id = ?", sid);
  try {
    const plan = JSON.parse(row.plan) as LessonPlan;
    const exam = JSON.parse(row.exam) as PaperQuestion[];
    const answers = await takeExam(JSON.parse(row.notebook), transcript, exam);
    const grade = await gradeExam(plan, exam, transcript, answers);
    const { marks, total, score } = tally(grade, exam);
    const report: ExamReport = { answers: answers.answers, grade, marks, total, score };
    run("UPDATE sessions SET status = 'complete', report = ?, score = ?, completed_at = datetime('now') WHERE id = ?", JSON.stringify(report), score, sid);
  } catch (err) {
    console.error("exam failed", err);
    run("UPDATE sessions SET status = 'error', error = ? WHERE id = ?", err instanceof AIError ? err.message : "Something went wrong during the exam.", sid);
  } finally {
    busy.delete(sid);
  }
  res.json({ session: sessionView(loadSession(sid)) });
}));

app.use(express.static(path.resolve("public")));
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof AIError) return res.status(502).json({ error: err.message });
  if ((err as { type?: string })?.type === "entity.too.large") return res.status(413).json({ error: "Files are too large. Keep the total under 20 MB." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

app.listen(PORT, () => console.log(`CHUD running at http://localhost:${PORT}${MOCK ? "  (MOCK_AI mode: no AI calls)" : ""}`));
