# CHUD: teach it to learn it (GCSE maths)

Upload a real GCSE maths paper, pick a topic, and teach it to **Chud**, an AI classmate who knows no maths methods and starts with classic GCSE mistakes. Then Chud sits every question on that topic from your paper and gets marked like a real GCSE. Chud's marks show how well you really understand the topic.

## Run

```bash
npm install
cp .env.example .env     # add ANTHROPIC_API_KEY
npm start                # http://localhost:3000
```

`npm run mock` runs the full flow with canned AI responses (no key needed).

## The loop

1. **Upload** a paper (PDF or page photos) and, optionally, its mark scheme. Claude extracts every question part with its marks and topic, describes diagrams in words, and copies or writes the mark scheme. Drawing-only questions are skipped.
2. **Pick a topic** found on the paper (simple ones are starred). Claude plans 3–4 skills and one classic mistake per skill for Chud. Chud never sees the questions.
3. **Teach Chud.** It asks questions, tries examples, never corrects you, and believes wrong methods too. "Chud's brain" shows its beliefs and a brain meter updating live.
4. **Exam.** Chud answers that topic's real questions with working, using only what it was taught. An examiner pass awards method and accuracy marks per the mark scheme.
5. **Results:** marks out of total, the full exam script with marks per question, strengths, where marks were lost, and a coaching tip.

## Code

```
server/index.ts  API: POST /api/papers, GET /api/papers/:id, POST /api/sessions, POST /:id/messages, POST /:id/exam
server/ai.ts     Claude prompts + Zod schemas (paper extractor, planner, Chud, exam taker, examiner) + mock mode
server/db.ts     SQLite via node:sqlite (data/chud.db)
public/          index.html, app.js, app.css, Chud art: no build step
```

Model: `claude-opus-5-5`, streamed structured outputs, `fallbacks: "default"`, prompt caching. Requires Node 22.5+.
