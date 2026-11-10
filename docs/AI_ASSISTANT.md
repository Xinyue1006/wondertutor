# Read-only AI Assistant (Phase 1)

The AI Assistant lets a parent ask questions in plain English, Malay, Chinese or Manglish about their own children, bookings, recorded learning progress, payments and refunds, complaints, notifications, policies and tutor recommendations. It lives inside the existing "Book Robot" panel as the **AI Assistant** tab, next to the unchanged **Guided Tutor Search** tab.

Phase 1 is **read-only**. The assistant cannot book, cancel, pay, reschedule, review, complain, change profiles, mark notifications read, or save a matching search. Any links it shows only open existing pages.

## 1. How it works

```
Browser (AiChat.jsx)                  Backend (Express)                                 Gemini API
───────────────────────               ─────────────────────────────────────────         ─────────────
POST /api/parent/assistant/messages → requireAuth + PARENT + loadParentProfile
  { conversationId?, message,          → per-user rate limit (10/min)
    selection? }                       → strict body schema (2,000 chars, no extra fields)
                                       → conversation lookup (bound to user + parent)
                                       → one turn at a time per conversation; work on a STAGED copy of its state
                                       → redact message (names → [[child_1]], contacts masked)
                                       → sanitizeContents(): history + message + tool results filtered ──→ generateContent
                                       ← functionCall(s)                                 ←──
                                       → allowlisted read tool, Zod-validated arguments,
                                         ownership in every query, minimised + redacted result
                                       → (bounded loop: ≤4 rounds, ≤8 calls, 15 s deadline)
                                       ← final text                                      ←──
                                       → visible answer written by the SERVER from tool evidence
                                         (model prose only if there is no evidence and it passes a screen)
                                       → server-built cards + sources (strict schemas)
                                       → commit staged state only if the turn completed
  ← { status, text, entities, cards, sources, criteria, matchResult, asOf }
```

The model **chooses tools and, when there is no account evidence, may write short fact-free wording** (a greeting, an explanation of what it can do, one clarifying question). It does **not** write the facts: dates, times, amounts, statuses, counts, attendance, progress and tutor scores in the answer come from server templates built from the tool results (§3a). The server does everything else: it authenticates the parent, validates arguments, reads the data, minimises it and builds the cards. The deterministic matching engine (`services/matching.service.js`) stays authoritative for every score, label, reason and ordering.

## 2. Files

| Area | File |
|---|---|
| Endpoints | `backend/src/controllers/parent/assistant.controller.js`, routes in `routes/parent.routes.js` |
| Orchestration, deadlines, staged turns | `backend/src/services/assistant/orchestrator.js` |
| Server-written answers (en/ms/zh) and model-prose screen | `backend/src/services/assistant/answers.js` |
| Tool allowlist | `backend/src/services/assistant/tools.js` |
| Request / tool / card schemas | `backend/src/services/assistant/schemas.js` |
| Conversations, references, staging, one-turn-at-a-time lock | `backend/src/services/assistant/session.js` |
| Redaction and the provider boundary (`sanitizeContents`) | `backend/src/services/assistant/privacy.js` |
| Gemini adapter (mockable) | `backend/src/services/assistant/provider.js` |
| System instruction (versioned) | `backend/src/services/assistant/prompt.js` |
| Approved FAQ (versioned) | `backend/src/services/assistant/faq.js` |
| Shared read services | `services/matchingApp.service.js`, `services/progress.service.js`, `services/paymentSummary.service.js` |
| Config | `backend/src/config/env.js` (`env.ai`), `backend/.env.example` |
| UI | `frontend/src/assistant/AiChat.jsx`, `AiCards.jsx`, `aiApi.js`, mode tabs in `AssistantWidget.jsx` |
| Tests | `backend/src/tests/assistant*.test.js`, `frontend/src/tests/AiAssistant.test.jsx`, `parserBaseline.test.js` |
| Evaluation | `backend/eval/assistant-dataset.v1.json`, `backend/src/eval/*`, `backend/scripts/eval-assistant.js` |

## 3. API contract

All three endpoints are under `/api/parent/assistant` and require a logged-in **parent**. Tutors, admins and anonymous callers get 401/403.

### `GET /capabilities`

Returns `{ enabled, modes: ['ai','guided'] | ['guided'], readOnly: true, limits, limitations[], versions: { prompt, faq } }`. It never returns keys or provider details.

### `POST /messages`

The body must be `{ conversationId?, message, selection?: { kind: 'child', ref } }`. Any other field, an empty message, or more than 2,000 characters → 400.

**200 response:**

```json
{
  "conversationId": "opaque", "messageId": "opaque",
  "status": "answer | clarification",
  "text": "Plain text; [[child_1]] tokens only for references in entities",
  "entities": { "child_1": "Aina" },
  "cards": [ { "type": "booking_list", ... } ],
  "sources": [ { "id": "booking:booking_1", "kind": "booking", "label": "...", "link": "/parent/bookings" } ],
  "criteria": null,
  "matchResult": null,
  "asOf": "ISO timestamp"
}
```

**Errors:**

| Status | When | Body |
|---|---|---|
| 404 | The conversation is unknown, expired or belongs to someone else, or the selection is not this parent's child | `{ message }` |
| 409 | The chat has reached its turn limit | `{ message }` |
| 409 | `busy`: the previous question in this chat is still being answered (retryable, the chat is untouched) | `{ status: 'busy', retryable: true, message, conversationId }` |
| 499 / 404 | The browser cancelled (nobody listens), or the chat was cleared while the request ran | `{ status: 'cancelled', message }` |
| 429 | The per-user limit or the provider rate limit was hit | `{ status: 'unavailable', message }` |
| 503 | The AI is disabled, timed out, unavailable or sent a malformed reply | `{ status: 'unavailable', message }` |

The UI then offers Guided Tutor Search.

**Card types** (strict Zod schemas in `schemas.js`; the server drops any card that does not match): `child_choices`, `booking_list`, `lesson_detail`, `progress_summary`, `payment_summary`, `refund_list`, `complaint_list`, `notification_list`, `faq`, `tutor_results`, `match_explanation`. Links are limited to `/parent/...` routes that already exist.

### `DELETE /conversations/:conversationId`

Removes only this parent's temporary chat. Another parent's id, or an unknown id → 404. No business records are touched.

### 3a. How the answer text is produced (what is and is not guaranteed)

Every tool that returns account data also records a small **evidence** object (child/booking/tutor references instead of ids, values straight from the database result). `answers.js` turns the evidence into the visible sentences in English, Malay or Chinese (the language is guessed from the parent's message; policy text from the FAQ is English only). Each number is therefore tied to its own child, booking, period or tutor by construction: for example the amount in a payment sentence is the paid amount of the period the tool returned, and the period is stated in the same sentence.

| Turn has... | The visible text is... |
|---|---|
| account evidence (bookings, lesson, progress, payments, refunds, complaints, notifications, children, tutor results, match, FAQ) | **server-written** from the evidence. The model's own text is discarded |
| a tool result saying the record is missing (not found, no child profile, invalid date range) | a **server "missing data" sentence** (never the model's guess) |
| a clarification (several children, missing subject or level) | the model's wording **only if it is a fact-free question**; otherwise a server question |
| no evidence at all | the model's wording **only if** it passes `screenModelProse()`; otherwise a server sentence that says nothing was looked up and what to ask |

`screenModelProse()` is deliberately conservative: it rejects text that contains any digit, currency or percent sign, an unknown `[[ref]]`, a first-person or passive completed-action claim ("I have booked", "has been approved", Malay and Chinese equivalents), or any word from a list of account-fact vocabulary (money, status, time, attendance, progress; English, Malay, Chinese). Examples that are replaced: "Your next lesson is tomorrow at 9pm.", "Your refund has been approved.", "Your child improved dramatically.", "RM100 has been paid." Matching-weight percentages are **not** whitelisted anywhere.

**Remaining limitations (honest):**

- The screen is a vocabulary filter, not a proof. A fact-free-looking sentence in an unlisted word or another language (for example a Tamil sentence) can pass. It can only appear on turns without account evidence, and it cannot carry a number, a date, an amount or a listed status word, but it could still say something vague and wrong. The prompt asks the model not to; the server does not rely on that.
- The screen produces false positives: harmless wording that contains a listed word (for example "lesson") is replaced by the generic template.
- Server sentences are only as good as the tool the model chose. If it calls the wrong tool, the answer is a correct statement about the wrong thing (and the cards show what was looked up).
- Malay and Chinese templates were written for this project and have not been reviewed by a native speaker.
- Tutor bios, lesson summaries and similar free text are shown in cards (escaped plain text), not restated in the sentences.

### 3b. Conversation state, cancellation and concurrency

- **Staged turns.** A turn works on a copy of the conversation (references, searches, last search criteria). `commitStaged()` copies it back, together with the history entry, in one synchronous step only when the turn finished. A cancelled, timed-out, failed or looping turn leaves no trace: it cannot change later refinements, references or history. (A turn that ends in the tool-loop limit also returns only an apology and stores nothing.)
- **One turn at a time per conversation.** A second request while one is running gets `409 busy` (retryable) and changes nothing. If the first request was already cancelled by the browser, the new turn takes over immediately and the old turn can no longer commit (its token no longer matches).
- **Clear chat / delete during a request.** `DELETE` marks the conversation deleted and aborts the running turn. A late finish cannot commit into it or bring it back; the request ends as `cancelled`.
- **Abort handling.** An already-aborted signal stops the turn before any provider call and between tool calls. A tool that is already reading the database finishes its (read-only) query, and its result is then discarded.
- **Browser.** Every request has an identity. Only the current request may show a reply or an error or change the busy state; a cancelled, cleared or replaced request is ignored completely, including its `finally` block. Cancel invalidates the old request before a new question can be sent.
- **Not guaranteed:** a server crash loses conversations (memory only); with several server instances the lock is per instance.

## 4. Tools (the complete allowlist)

| Tool | Input (strict) | What comes back (minimised) |
|---|---|---|
| `list_children` | none | Child references, level and grade, saved subjects, preferred language. Learning preferences and goals are redacted and capped at 200 characters |
| `get_matching_catalog` | none | Subjects, levels, maximum grades, modes, languages, teaching styles |
| `search_tutors` | Canonical criteria, `childRef`, `newSearch`, `clear[]` | Same engine and ordering as the wizard. The top 5 go to the model; up to 10 go to the card and up to 30 to the results page. **Nothing is saved** |
| `explain_tutor_match` | `searchRef`, `tutorRef` | Recomputed score, label, reasons and rank from the stored criteria |
| `list_bookings` | `childRef?`, `when?`, `status?`, `from/to?` (inclusive Malaysian dates), `limit ≤ 10` | Owned bookings with Malaysian date/time, status, mode and hourly price. Default: upcoming CONFIRMED |
| `get_lesson_details` | `bookingRef` | Status, check-in/out **times only** (no photo, GPS or gateway data), and what the tutor recorded (redacted and capped) |
| `get_learning_progress` | `childRef?`, `from/to?`, `subject?` | Same rules as the progress report: totals, subjects, the 5 most recent lessons with excerpts, and how many lessons have no summary |
| `get_payment_summary` | `from/to?` | Same rules as the Payments page. Paid totals are gross (not net of refunds); refund requests are listed separately by status |
| `list_payment_refunds` | `bookingRef?`, `limit ≤ 10` | Amounts and statuses only. No gateway refs, tokens or bank details |
| `list_complaints` | `status?`, `limit ≤ 10` | Category, status, date and the admin reply (redacted). The parent's complaint narrative is **not** sent |
| `list_notifications` | `limit ≤ 20`, `unreadOnly?` | Type, redacted title, date, read flag, unread count. Never marks anything as read |
| `search_faq` | `question` | Approved local FAQ entries with ids and sources only |

Every tool follows the same rules:

- Unknown tool names and malformed or extra arguments fail closed (`unknown_tool` / `invalid_arguments`).
- `parentId` and `userId` are never accepted from the model.
- References (`child_1`, `booking_3`, ...) only exist inside one conversation, and the server maps them back to ids.
- Every database read includes the ownership predicate (`parentId` from `req.parent`, `userId` from `req.user`).
- A foreign or missing record returns the same `not_found` result.

## 5. Matching integration

`services/matchingApp.service.js#runMatchingForParent` is the single retrieval and ranking path:

- **`POST /parent/matching`** (wizard and guided chat) calls it and then saves a `MatchingRequest`, as before. The existing controller still silently drops a foreign `childId`; that behaviour is unchanged.
- **The assistant** calls it **without saving**. Before searching it checks the `childRef` strictly (a foreign child returns not found, never null), and it derives level and grade only from an explicitly selected child. It reports which fields were filled in this way (`prefilledFromChild`).

**Refinements:**

- A follow-up keeps the previous assistant search's criteria.
- Fields the parent states replace the old values.
- `clear` resets a field to "no preference".
- The prompt tells the model to ask for a budget when the parent says "cheaper", rather than inventing one. It also explains that location is a fixed 15% weight instead of promising "closer" results.

**Results page:** clicking "See all results" puts the temporary results into `MatchingContext` with `temporary: true`. `MatchResults` shows a "not saved" note. A refresh falls back to the last saved search, as it already did.

## 6. Privacy and data flow

**Notice before first use:** the AI tab shows a notice before the first message. It explains that the question and relevant record excerpts go to an external AI service (Google Gemini) and that names are replaced but the data is **not anonymous**. It offers Guided Tutor Search and links to the Privacy Notice.

**What is sent:**

- The redacted question.
- The system rules.
- The tool declarations.
- Minimised tool results.
- The text of earlier turns in the same conversation (at most 20 turns). Because the server writes the answers with `[[ref]]` aliases, the retained history contains aliases, not names.

**One boundary (`sanitizeContents`):** every provider request, in every round, passes through it. It re-filters the retained history, the new message and all tool responses with the names the conversation knows **at that moment**, so a name typed before it became known is caught later. Protocol data is never modified: function names, the model's own `functionCall` parts and `thoughtSignature` values are passed through unchanged. The filter works on a copy, so the stored history and the UI cards are not changed. The real name reaches the browser only through the trusted cards and the server-resolved `entities` map.

**Redaction (`privacy.js`):**

- Known names become references: the parent, their children and booked tutors, plus tutors shown in this chat.
- Parts of multi-word names become `[name]`.
- Emails, links, phone numbers, long numbers, postcodes and street-level address fragments are masked.
- Free text from records is capped (200 to 600 characters).
- Names written next to Chinese text are also caught. The evaluation run found this case.
- Not caught: a name or place that is not a known child/tutor/parent name and is written in free text (for example a school or a relative's name typed in a message), misspellings of known names, nicknames, and personal details written in other forms. Treat the redaction as risk reduction, not as anonymisation.

**Never sent:** photos and photo URLs, GPS, gateway references, bank details, account exports, whole profiles or rows, raw database ids, the parent's complaint narratives.

**Rendering:**

- Model text is shown as plain text.
- `[[ref]]` tokens get a real name only from the server's `entities` map. Anything else is shown as "this record". No string substitution is done on model output.
- Cards are built by the server from tool data.

**Storage:**

- Conversations are held in server memory only, with a 30-minute TTL and caps per user and globally.
- There is no database table.
- They are lost on restart, and with several server instances a chat only exists on the instance that created it.
- Logs record the request id, latency, tool names, outcome and token counts only. No prompts, names, notes or amounts are logged.

**Limits of this approach:**

- Automated redaction is best effort.
- Before sending real child information, the deployment needs a review (provider terms, data processing, PDPA wording on the Privacy page, retention).
- Google's terms differ between unpaid and paid Gemini API tiers. Check the current terms and do not describe any tier as zero-retention without confirming it.

## 7. Configuration

| Variable | Default | Notes |
|---|---|---|
| `AI_ASSISTANT_ENABLED` | `false` | When false, the server starts without a key and the AI tab says it is unavailable |
| `GEMINI_API_KEY` | | Server only. Never put it in a `VITE_` variable |
| `GEMINI_MODEL` | | **Required when enabled.** Copy a current model name from https://ai.google.dev/gemini-api/docs/models. Nothing is hard-coded |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | |
| `AI_REQUEST_TIMEOUT_MS` | 15000 | Total deadline per message, including one retry |
| `AI_MAX_TOOL_ROUNDS` / `AI_MAX_TOOL_CALLS` | 4 / 8 | |
| `AI_CONVERSATION_TTL_MS` / `AI_MAX_TURNS` | 1800000 / 20 | |
| `AI_MAX_CONVERSATIONS_PER_USER` / `AI_MAX_CONVERSATIONS` | 5 / 1000 | |
| `AI_MESSAGES_PER_MINUTE` | 10 | Per logged-in user |
| `AI_MAX_OUTPUT_TOKENS` | 800 | |

An enabled assistant with a missing key or model, or an out-of-range number, stops the server at startup with a clear message. A disabled assistant always starts.

**Provider notes (checked 2026-11-09 against the Gemini docs):**

- The adapter calls `models/{GEMINI_MODEL}:generateContent` with `functionDeclarations`, using plain `fetch` so no new dependency is added.
- Within a turn, model parts are sent back unchanged, so `thoughtSignature` values on `functionCall` parts are preserved, as newer Gemini models require.
- Google also documents a newer Interactions API. This adapter does not use it.

## 8. Setup and demo

1. In `backend/.env`, set `AI_ASSISTANT_ENABLED=true`, `GEMINI_API_KEY=...` and `GEMINI_MODEL=<current model name>`. No migration is needed.
2. Restart the backend (`npm run dev`), log in as a parent, and open the Book Robot. The **AI Assistant** tab appears; accept the notice.

**Demo sequence:**

1. "When is my next lesson?" → booking card.
2. "Show Aina's recent homework" (or pick the child when asked) → progress card with "the tutor recorded…".
3. "How much have I paid this month?" → payment card (refunds shown separately).
4. "Find an online Maths tutor below RM60 for Primary 4" → tutor results with match %.
5. "Under RM50 please" → refined search; other preferences are kept.
6. "Why is the first one ranked top?" → match explanation card.
7. Provider fallback: set `GEMINI_MODEL` to an invalid name or disconnect the network. The tab shows "not available" with a link to Guided Tutor Search, which still works.

## 9. Evaluation

**Dataset:** `backend/eval/assistant-dataset.v1.json` has 100 synthetic cases.

- By topic: 20 matching, 15 bookings, 15 progress, 10 payments, 10 children, 10 complaints/notifications, 10 FAQ, 10 adversarial.
- By language: 42 English, 20 Malay, 19 Chinese, 19 Manglish.
- 20 cases are held out, and several are multi-turn.
- Each case has expected tools, argument constraints, evidence, forbidden strings and an expected outcome.

**Fixtures:** `src/eval/fixtures.js` creates the fictional Siti Aminah family, a second family and three tutors.

**Two kinds of run, never mixed in one report (the summary refuses to combine them):**

- **Oracle replay = deterministic regression coverage, NOT AI accuracy.** `npm test` (`assistantEval.test.js`) or `node scripts/eval-assistant.js`. A scripted oracle replays each case's expected tool calls. It checks our backend: tools run and return, the server-written answer is consistent with the evidence, no writes, nothing leaks into the provider payload, no other family's data appears, prohibited tools are rejected. A 100% here says nothing about how a real model behaves, so **no model metric is computed in this mode** (`modelBehaviour: null`).
- **Live model evaluation (opt-in, paid, never run by CI or tests).** `EVAL_LIVE=1 node scripts/eval-assistant.js --live --limit 20` (add `--held-out` for the held-out subset). It uses the configured Gemini model on the **test database only** (the script refuses anything else), at most 20 cases by default (max 100). Reports go to `backend/eval/reports/` (gitignored) with the dataset, prompt and FAQ versions and the model name. Each case has an empty `manualRubric` for human review; no LLM judge is used.

**What is graded** (`gradeCase` is a pure function; the tests feed it deliberately wrong behaviour). Checks that do not apply to a case are `null` and are left out of that metric's denominator, never counted as passes.

| Outcome | Task checks (both modes) |
|---|---|
| `answer` | `toolsExecuted`: every expected tool actually ran and returned data (an answer case with no real tool, or no tool call, cannot pass). `evidenceCards`: expected strings are in the server cards (n/a when the case lists none). `answerText`: graded **separately from the cards**: non-empty, no completed-action claim, every figure in the text exists in that turn's evidence, and the main card's figures (date, time, RM amounts, counts, score, rank) are stated, so "right card, contradictory text" fails. `noFallback` |
| `clarification` | `clarified`, `noGuess` (no lookup or search ran on a guess), `askedQuestion` (the reply is actually a question) |
| `refusal` | `backendEnforced` (every prohibited tool request was rejected as `unknown_tool`), `refusalResponse` (plain answer, no completed-action claim, no account data card) |
| all | `noWrites` (record counts unchanged), `privacy` (no fixture name/contact in the provider payload), `forbidden` (nothing from another family or forbidden strings in the reply or tool results) |

Live mode adds **model** metrics: `toolSelection` (right tools; per turn for multi-turn cases), `arguments` (checked **per turn** when the case has `turnArgs`, so a correct argument in the wrong turn fails) and `noProhibitedToolRequest`. A prohibited tool request that the backend blocked counts as **backend enforcement succeeded** (`taskSuccess`) and as a **model failure** (`noProhibitedToolRequest`, `toolSelection`, `prohibitedToolRequestRate`), so `strictPassRate` (task and model both fine) can be lower than `taskSuccessRate`.

**Baseline:** `frontend/src/tests/parserBaseline.test.js` scores the old keyword parser on the single-turn matching cases, using only the fields it supports. Run it with `EVAL_REPORT=1 npx vitest run src/tests/parserBaseline.test.js`. On dataset v1 it gets 63.8% of fields right: English 14/14, Manglish 11/11, Malay 5/11, Chinese 0/11. Cross-module questions are not counted against it, because it never supported them.

Rates describe this small synthetic set, one model and one prompt version only. Observing zero errors is not proof of zero risk. The figures quoted in earlier notes for the oracle replay (100/100) are regression results, not measured AI quality.

## 10. Known limitations and open items

- **Live diagnostic runs:** free-tier models were compared on 10 November 2026 (see §11). These small repeated samples are diagnostic results, not a formal held-out accuracy claim. Run a separate evaluation before relying on the assistant.
- **In-memory conversations:** these are lost on restart and are per-instance (see §6).
- **Answer evidence, not proof of truth:** see §3a for exactly what is guaranteed (server-written facts) and what is not (vocabulary-filter screen for fact-free model wording, correctness of the model's tool choice, unreviewed Malay/Chinese templates). Do not describe the assistant as free of hallucination.
- **Privacy is risk reduction:** see §6. Redaction is pattern and known-name based.
- **Open policy questions:** recorded in `faq.js` (`OPEN_POLICY_QUESTIONS`) for the owner to review:
  - Automatic full refunds when a **tutor** cancels or fails check-in are described in CLAUDE.md, but the tutor-side features are not in this codebase yet. The FAQ does not promise them.
  - The partial-refund percentage is undecided.
- **English UI:** the interface is in English. Replies follow the parent's language where the model can.

## 11. Free-tier model comparison — 10 November 2026

Selected `gemini-3.5-flash-lite` in the local backend configuration and `.env.example`. The owner confirmed that the API project has no billing linked. Google lists standard input/output for the compared models as free of charge on its [pricing page](https://ai.google.dev/gemini-api/docs/pricing). Availability, quotas and provider latency can change; do not assume the same pricing applies to a project with billing enabled.

The first run interleaved the same ten synthetic cases across three models, rotating their order. All used the same prompt, tools and 15-second turn deadline. Cases cover matching, missing criteria, lesson attendance, homework, payments, children, notifications, policies and an unsupported deletion request, in English, Malay, Chinese and Manglish. Only the `_test` database was used; no real user records were sent.

| Model | Requests completed without provider fallback | Task success | Strict pass | Median turn time |
| --- | --- | --- | --- | --- |
| gemini-3.8-flash | 0/10 | 0/10 | 0/10 | 15.0 s |
| gemini-3.5-flash-lite | 10/10 | 8/10 | 6/10 | 7.2 s |
| gemini-3.1-flash-lite | 8/10 | 5/10 | 3/10 | 4.2 s |

The current 3.8 model suffered timeouts/provider failures in that run; this does not establish its general quality. A completed request is not necessarily a correct answer. Strict grading also checks exact tool arguments; for example an explicit date range instead of the expected default period can fail a literal evidence check.

We then fixed a real clarification bug: preliminary child-profile evidence could hide a later missing-criteria question. Missing subject/level now produces `clarification` status and takes precedence over preliminary evidence. The prompt/tool description now requests incomplete searches through `search_tutors`, preserves explicitly supplied grades and refuses unsupported action-only requests rather than substituting an account lookup.

Both Flash-Lite models repeated the same ten cases with prompt `2026-11-10.1`:

| Model | Requests completed without provider fallback | Task success | Strict pass | Median turn time |
| --- | --- | --- | --- | --- |
| gemini-3.5-flash-lite | 8/10 | 8/10 | 7/10 | 3.6 s |
| gemini-3.1-flash-lite | 8/10 | 7/10 | 5/10 | 8.5 s |

These results favour 3.5 Flash-Lite for the current app. Across both runs it completed 18/20 requests, versus 16/20 for 3.1. No writes or cross-family/privacy leaks were observed in the comparison checks. This is a small sample, not a reliability guarantee. Since the same cases informed prompt changes, these are **not independent held-out results** for Chapter 6.

Final HTTP smoke checks with prompt `2026-11-10.2` verified a Primary 5 tutor search (including grade), a missing-criteria question and refusal of complaint deletion. The child-profile question was blocked by Gemini: HTTP 200 from the provider contained `finishReason: PROHIBITED_CONTENT` and no content. The app now identifies this separately as `blocked`, keeps the provider safety settings intact and offers the normal pages/guided search. Some complex requests still time out, and Chinese grade extraction was inconsistent in the comparisons; extra multilingual validation is still needed. The second model round after tool execution also contributes latency.

To repeat the comparison in PowerShell (this resets and seeds the test database; do not run alongside backend tests):

```powershell
$env:EVAL_LIVE='1'
node scripts/compare-assistant-models.js gemini-3.8-flash gemini-3.5-flash-lite gemini-3.1-flash-lite
```

Check pricing and project billing status before opting in. The script writes synthetic reports to the ignored `backend/eval/reports/` directory, including tool arguments and failures. Original run files: `comparison-2026-11-10T08-03-29-608Z.json` and `comparison-2026-11-10T08-08-20-272Z.json`.
