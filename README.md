# Standalone test improvement service

An independent Node.js application for modifying an existing full test according to a prompt. It contains no generation pipeline, imports no files from the old project, and mounts none of the old endpoints. Winston provides structured operational logging.

## Start

Requires Node.js 22 or newer.

1. Extract the ZIP and open a terminal in standalone-test-improver.
2. Put your API key in OPENAI_API_KEY in .env.
3. Set OPENAI_MODEL to a model in your account that supports Chat Completions and JSON object output. The default is gpt-6-luna.
4. Run:

```bash
npm start
```

Run `npm install` before starting. It listens at http://127.0.0.1:3100. PORT can be changed independently of the generation application. .env is loaded by Node itself.

## Postman: attach a file

Method: POST
URL: http://127.0.0.1:3100/improve

Select Body → form-data. Add these two rows:

| Key | Type | Value |
| --- | --- | --- |
| file | File | Select your full-test.json file |
| prompt | Text | Write the exact improvement instructions |

Do not choose raw JSON. Do not manually set Content-Type: Postman supplies the multipart boundary. The request must contain exactly one file and one prompt field. Maximum total upload size: 10 MB. Maximum prompt length: 20,000 characters.

The default successful response is the full revised test JSON, with an attachment filename of improved-test.json. In Postman, use Save Response → Save to a file (or Send and Download where available).

For the full report including the revised test, edit plan, before/after changes and model usage, send to:

http://127.0.0.1:3100/improve?output=report

This is the same endpoint with a response-format option, not another generation endpoint. It invokes a fresh improvement run each time: choose the format you want before sending. The report's test property contains the revised JSON. There is no automatic saving or overwriting of your original upload.

Equivalent curl:

```bash
curl http://127.0.0.1:3100/improve \
  -F 'file=@full-test.json;type=application/json' \
  -F 'prompt=Question 2 of group 2 section 1 has unclear wording. Improve that question wording only. Keep its answer and everything else unchanged.' \
  -o improved-test.json
```

Check the HTTP status before using a saved response: an unsuccessful response is an error object, not an improved test.

## What can change

There is no fixed field allowlist. The prompt can explicitly request changes to:

- Passages, including particular sentences/paragraphs.
- Group structure, membership and shared group data.
- Question types and question IDs.
- Option text, labels and counts.
- Test/section/group/question ordering.
- Existing answer explanations.
- Question wording, correctAnswers, evidence and instructions.
- Other fields in the uploaded JSON, when clearly identified and explicitly requested.

Changes use minimal JSON Patch operations: replace a primitive field, add a requested property/array item, remove a requested property/array item, or move an existing item. Whole object/array replacement is prohibited to reduce accidental rewriting. Structural changes use explicit add/remove/move operations and leaf changes. Existing data is moved rather than regenerated when the instruction is about ordering or membership.

Model-generated patch pointers are rooted at the uploaded JSON object. If a model mistakenly returns paths with an extra `/test` wrapper, the service removes that wrapper before scope review, repair, and application, while keeping exact-plan authorization checks in place.

Shared answer-bank coverage is found and expanded by code. The AI receives the uploaded test and the resulting real test paths, not a separate editable-looking helper list. The code also checks planned paths against the uploaded test before review and ignores leftover `/sharedOptionBanks/.../originalText` paths when that field is not in the upload. This prevents helper information from being treated as test content.

## Prompt examples

Wording only:

> In section 1, group 2, question 2, make the question wording clearer. Preserve its answer, evidence and all other fields.

Answer repair:

> Correct the answer and evidence for question 2 of group 2 in section 1 using the existing passage. Update only the matching answerKey and answerKeyDetails entries, including their explanation, to reflect this correction. Keep all other questions and the passage unchanged.

Passage correction:

> In section 1, paragraph B, replace “during dry weeks” with “during dry months”. Apply the same replacement in that paragraph's duplicated passage representation. Do not change the questions or any other passage text.

Option labels:

> In global question ID 15, relabel options A, B, C, D as I, II, III, IV, keeping their texts and ordering. Map this question's existing correctAnswers and matching answer-key entries to the new labels. Do not alter other options or questions.

Ordering:

> Swap the first and second questions within group 2 of section 1. Preserve their question IDs and every field value. Do not change any other ordering or numbering.

Explanation:

> Rewrite only answerKeyDetails.reason for global question ID 9 so it accurately explains the existing answer using the existing passage. Keep all other fields unchanged.

These examples are instructions to write in the prompt text field; the JSON still arrives as an attached file.

“Question 2 of group 2 section 1” means the second question inside that group, not global question ID 2. In the supplied generated test, that is global ID 9. Use “global question ID 2” when referring to the actual questionId value. Targets are interpreted against the uploaded test; operation indexes are applied sequentially.

## How it works

1. Parse the attached file as UTF-8 JSON. Reject malformed uploads.
2. Read the full test and prompt to produce a precise edit plan. Each operation must cite an exact phrase from the prompt.
3. Independently review the plan for explicit authorization, completeness and ambiguous references.
4. Generate only the exact planned patch operations, never a new whole test.
5. Reject operations outside the frozen plan, unsafe JSON pointers, bulk object replacement and invalid paths. Apply the operations to a clone.
6. Independently review the proposed test against the original and prompt for correctness, completeness and unintended changes.
7. Return a revised test only after every stage succeeds. Otherwise return an error and no partial test.

Typically four model calls are made: scope planning, scope review, repair and final review. Every call receives the prompt and relevant full JSON context. Longer tests cost more and must fit the selected model's context window. Usage is available in report mode on success. Transport errors and rejected edits are not silently retried into a different repair; unsuccessful requests may still incur API usage.

## Preservation and limits

The code guarantees that only the planned operations are applied to a copy. Unaddressed values are preserved; move operations naturally shift array positions. JSON formatting is normalized on output, so unchanged whitespace/indentation is not byte-preserved.

The plan and semantic checks are AI decisions. They cannot mathematically guarantee that every natural-language prompt is interpreted correctly or every correction is accurate. Ambiguous, contradictory or unsafe-to-resolve requests return 422 with a reason rather than producing a guessed edit. Review the report when precision matters.

The service does not automatically repair mirrored values, renumber a test, regenerate HTML, update external answer-key files or fix unrelated problems. The user has authorized it to correct a question, option, or answer key when it is clearly wrong and the passage gives one clear correction. It prefers to fix the wording and keep a valid answer key. If the source does not support one clear correction, the service stops and asks for clarification.

## Question paraphrasing rules

The service recognizes these 16 question types: `tfng`, `yes_no_notgiven`, `mcq_single`, `mcq_multiple`, `matching_information`, `matching_headings`, `matching_features`, `matching_names`, `matching_sentence_endings`, `sentence_completion`, `summary_completion`, `notes_completion`, `short_answer`, `diagram_completion`, `flowchart_completion`, and `table_completion`. For a user-authorized broad paraphrasing request, it may paraphrase question wording for the 15 types other than `matching_headings`; it leaves `matching_headings` question fields unchanged because they are paragraph labels/references such as “Paragraph A”. It preserves tested meaning and structure. Answer options, answers, passages, and explanations remain unchanged unless separately requested or needed to correct a clear error under the user's standing authorization.

Shared answer-bank entries are detected from question-group metadata and repeated option text. If a planned change touches one copy, the plan is expanded to cover every copy; one valid replacement is copied to all those paths. When a repair response omits or malforms operations, the service keeps operations that exactly match the plan and asks only for missing fields in batches of up to 20, with at most two completion attempts. Final review checks the bank for exact consistency. For `matching_sentence_endings`, final review receives each original stem and its original correct option alongside the proposed pair, and checks grammar, answer-label preservation, and meaning. Answer keys stay unchanged unless a correction is explicitly included in the plan; code checks that any changed key has an approved correction entry. If review rejects a draft with exact paths from the approved plan, the service may repair only those flagged replacements and review again, up to two times. Shared-bank retries expand to every copy. Every retry remains inside the original approved plan. If the reviewer cannot identify safe paths, a retry fails, or the final review still rejects the draft, the service returns no revised test and persists the failed run for analysis.

JSON structure and patch safety are validated deterministically; IELTS semantic constraints and requested structure are checked by the model. There is no schema that silently strips unknown fields or rebuilds your uploaded test. Requests requiring external facts cannot be researched by this service: provide the correct content in the prompt, or request a repair grounded in the existing test.

The uploaded test is sent to the configured OpenAI API for improvement with store:false. Each request is retained in its own local run folder when `RUN_DATA_DIR` is set; run files include the prompt and test content. The server binds to localhost and has no authentication; add appropriate access controls before making it publicly reachable.

## Logging, cost analysis and monitoring

Winston emits concise, timestamped progress logs to the console. Set `LOG_LEVEL` (default `info`) to control verbosity. Request and model-stage logs include run ID, stage, duration and outcome. The per-run `run.log` keeps detailed structured events, usage, and costs; the uploaded test and prompt are kept in separate JSON files, not copied into logs.

The project `.env` also loads when launched with `node src/server.js`. Requests emit `request_received` immediately, followed by upload, model-stage, and completion events. Restart the running server after code or `.env` changes. If `/health` returns 404 or responses lack `X-Request-ID`, check that port 3100 is running the updated project. Each request reserves the next ordered folder ID at the start of processing. `X-Run-ID` and `X-Run-Number` identify that ordered run; `X-Request-ID` remains the UUID used to match logs and API requests. The run folder name is the run ID, such as `0005`.

Set `RUN_DATA_DIR=improved` to retain a folder for each `/improve` request:

```text
improved/<run-number>/
  run.log                    # concise event timeline for this run
  run.json                   # prompt, decisions, reviews, errors, changes
  cost-ledger.json           # token and USD/PKR costs for every model call
  input-test.json            # original upload
  input-test.html            # preview when a failed input can be rendered
  improved_full_test.json    # successful revised test
  full-test.html             # successful HTML output
```

Run folders are allocated in ascending order (`0001`, `0002`, …); each `run.json` stores both the folder number and UUID. Failed attempts retain their input, prompt, model-stage decisions, token usage, costs, and failure reason. This enables per-run review without relying on in-memory metrics. The current `.env` enables this setting. Run records can contain full test content and prompts; keep the folder private and follow your retention policy. `improved/` is excluded from Git. Targeted retry and review passes appear as individually named stages in `run.log`, `run.json`, and `cost-ledger.json`.

The earlier request `3af532e3-86ba-474f-aaeb-aa9998e8cfe1` has a historical record in `data/runs/2026-10-07_3af532e3-86ba-474f-aaeb-aa9998e8cfe1.json`. The previous logger did not retain its prompt or uploaded test, so that record accurately marks those fields unavailable; it includes the clarification, stage usage, cost and HTTP outcome from the logs.

To avoid a clarification for a broad paraphrasing request, specify the target fields and what must stay fixed. For example: “Paraphrase only the text of question stems that contain actual question wording. Leave paragraph labels (Questions 1–7), answer options, answers, passages and explanations unchanged. Return a clarification if a non-label question stem cannot be identified.” The service will still ask when the data genuinely does not identify a safe edit.

Set `OPENAI_INPUT_USD_PER_MILLION` and `OPENAI_OUTPUT_USD_PER_MILLION` to your configured model's USD rates. Optionally set `OPENAI_CACHED_INPUT_USD_PER_MILLION`; otherwise cached tokens use the ordinary input rate. Blank or invalid rates produce an unknown (`null`) estimate, never a claim that usage is free. Estimates use provider-reported prompt/completion tokens and cached input details. They are estimates rather than billing records; calls that time out or fail without reported usage may still incur unmeasured charges.

The `.env` prices are configured from the supplied GPT-6 Luna screenshot: input $0.10, cached input $0.01, cache write $0.125, and output $0.50 per million tokens. `USD_TO_PKR=276.83` uses the supplied exchange-rate screenshot dated October 7, 2026. Update this setting when you want a different conversion rate; the service does not fetch live exchange rates. Reported cache-write tokens are billed at the configured cache-write rate and subtracted from ordinary input tokens to avoid double-counting.

`POST /improve?output=report` includes per-stage timing/cost and a total `cost` object with `usd`, `pkr`, and `usdToPkr`. `knownUsd` and `knownPkr` are the measured subtotals; totals are null when usage cannot be priced. Missing or invalid exchange rates produce null PKR values while preserving USD estimates. Full precision is retained to avoid rounding small calls to zero. Failed or semantically rejected runs retain incurred usage in operational logs and monitoring even though no revised test is returned. Existing `currency: "USD"` labels the base currency; `pkr` is the converted estimate.

- `GET /health`: process liveness, uptime and whether an API key is configured. This does not test provider connectivity or credentials.
- `GET /metrics`: JSON totals for requests, active requests, failures, disconnected responses, model calls/errors, tokens, `knownEstimatedUsd`, `knownEstimatedPkr`, `usdToPkr`, unpriced calls, stage timings, uptime and process memory.

Metrics are in memory per server and reset on restart. Health and metrics requests count toward HTTP totals; a metrics snapshot includes its own active request. Use logs for retained history and an external collector if you need dashboards or alerts. For example, poll health for downtime and compare successive metrics snapshots for increased failures, latency, memory or spend. A disconnected client does not cancel a running improvement; subsequent model usage is still recorded in stage logs and metrics. The existing localhost binding also applies to monitoring endpoints.

Implementation files: `src/observability.js` owns logging, request context, estimates and metrics; `src/server.js` tracks HTTP outcomes; `src/improve.js` tracks model stages, including partial usage on failures.

## Running tests

Run `npm run dev` in your terminal to see live Winston logs. The server prints stage starts, progress every 15 seconds while waiting for the model, stage completion, numeric run IDs, elapsed time, tokens, costs in USD/PKR, and error details. Per-run JSON logs remain in `improved/<run-id>/run.log`. Console output is not redirected to `dev-stdout.log`.

The development server uses polling and the `SIGUSR2` restart signal in `nodemon.json`. On Windows, this signal replaces the server process when source files change; the previous `SIGTERM` configuration could leave the old server running. `GET /health` and each `run.json` include the loaded source version, process ID, and startup time. A server launched with `npm start` needs a manual restart after code changes.

```bash
npm test
```

Tests cover all edit categories, preservation, plan boundary enforcement, unsafe pointers, rejected edits, ambiguity, unchanged results and an actual multipart HTTP upload. Model responses are mocked; no live API repair was executed during development.

The test runner stores mocked run files in temporary directories and removes them on exit. Tests do not consume run numbers in `improved/`.

## Project files

- src/server.js: standalone HTTP endpoint and downloadable response.
- src/upload.js: bounded multipart JSON-file upload parser.
- src/improve.js: prompt-driven planning, repair and independent checks.
- src/patch.js: scoped JSON operations and audit log.
- src/llm.js: standalone API client.
- test/: deterministic and HTTP tests.

There are no references to the old application's server, controllers, routes or generation services.
