import http from "node:http";
import { pathToFileURL } from "node:url";
import { parseUpload } from "./upload.js";
import { improve } from "./improve.js";
import { randomUUID } from "node:crypto";
import {
  context,
  logger,
  log,
  createMonitoring,
  summarizeCost,
} from "./observability.js";
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "./config.js";
import { renderAcademicTestHtml } from "./academicHtml.js";
import { runtime } from "./runtime.js";

async function allocateRunDirectory(request) {
  if (!process.env.RUN_DATA_DIR) return;
  const directory = path.resolve(projectRoot, process.env.RUN_DATA_DIR);
  if (!request.runDirectory) {
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const numbers = entries
      .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
      .map((entry) => Number(entry.name));
    let nextNumber = numbers.length ? Math.max(...numbers) + 1 : 1;
    while (true) {
      const runNumber = String(nextNumber).padStart(4, "0");
      const candidate = path.join(directory, runNumber);
      try {
        await mkdir(candidate);
        request.runNumber = nextNumber;
        request.runId = runNumber;
        request.runDirectory = candidate;
        log("info", "run_id_assigned", {
          runId: request.runId,
          runNumber: nextNumber,
        });
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        nextNumber++;
      }
    }
  }
  return request.runDirectory;
}

async function persistRun(request) {
  if (!process.env.RUN_DATA_DIR) return;
  await allocateRunDirectory(request);
  const runDirectory = request.runDirectory;
  const record = {
    schemaVersion: 1,
    runtime,
    runId: request.runId,
    requestId: request.requestId,
    runNumber: request.runNumber,
    runDirectory: path.basename(runDirectory),
    startedAt: request.startedAt,
    completedAt: new Date().toISOString(),
    status: request.status,
    model: process.env.OPENAI_MODEL || "gpt-6-luna",
    prompt: request.prompt ?? null,
    changes: request.changes ?? [],
    clarificationOrError: request.error ?? null,
    stages: request.stages,
    cost: summarizeCost(request.costEntries),
  };
  await mkdir(runDirectory, { recursive: true });
  const atomicJson = async (filename, value) => {
    const target = path.join(runDirectory, filename);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "w",
    });
    await rename(temporary, target);
  };
  if (request.inputTest) await atomicJson("input-test.json", request.inputTest);
  if (request.outputTest) {
    await atomicJson("improved_full_test.json", request.outputTest);
    try {
      await writeFile(
        path.join(runDirectory, "full-test.html"),
        renderAcademicTestHtml(request.outputTest),
        "utf8",
      );
    } catch (error) {
      request.events.push({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: "output_html_generation_failed",
        errorType: error.name,
      });
    }
  } else if (
    request.inputTest?.sections?.every(
      (section) => section.parts?.[0]?.questions,
    )
  ) {
    try {
      await writeFile(
        path.join(runDirectory, "input-test.html"),
        renderAcademicTestHtml(request.inputTest),
        "utf8",
      );
    } catch (error) {
      request.events.push({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: "input_html_preview_failed",
        errorType: error.name,
      });
    }
  }
  await atomicJson("cost-ledger.json", {
    requestId: request.requestId,
    model: record.model,
    exchangeRateUsdToPkr: summarizeCost(request.costEntries).usdToPkr,
    stages: request.stages.map(
      ({ stage, durationMs, success, usage, cost, error }) => ({
        stage,
        durationMs,
        success,
        usage,
        cost,
        error,
      }),
    ),
    total: summarizeCost(request.costEntries),
  });
  await atomicJson("run.json", record);
  await writeFile(
    path.join(runDirectory, "run.log"),
    request.events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8",
  );
  return runDirectory;
}

export function createServer(runImprovement = improve) {
  const monitoring = createMonitoring();
  return http.createServer((req, res) =>
    context.run(
      {
        requestId: randomUUID(),
        monitoring,
        costEntries: [],
        stages: [],
        events: [],
        startedAt: new Date().toISOString(),
      },
      async () => {
        const request = context.getStore();
        const started = performance.now();
        monitoring.state.requests++;
        monitoring.state.active++;
        res.setHeader("X-Request-ID", request.requestId);
        log("info", "request_received", {
          method: req.method,
          route: req.url?.split("?")[0] === "/improve" ? "/improve" : "other",
        });
        let completed = false;
        const complete = (aborted = false) => {
          if (completed) return;
          completed = true;
          const durationMs = performance.now() - started;
          monitoring.state.active--;
          monitoring.state.durationMs += durationMs;
          if (aborted) monitoring.state.aborted++;
          if (res.statusCode >= 400 || aborted) monitoring.state.failures++;
          logger.log(
            res.statusCode >= 500
              ? "error"
              : res.statusCode >= 400 || aborted
                ? "warn"
                : "info",
            aborted ? "client_disconnected" : "request_completed",
            {
              requestId: request.requestId,
              runId: request.runId,
              route:
                req.url?.split("?")[0] === "/improve" ? "/improve" : "other",
              status: aborted ? undefined : res.statusCode,
              aborted,
              durationMs,
              cost: summarizeCost(request.costEntries),
            },
          );
        };
        res.once("finish", () => complete());
        res.once("close", () => complete(!res.writableFinished));
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        const url = new URL(req.url, "http://localhost");
        if (
          req.method === "GET" &&
          ["/health", "/metrics"].includes(url.pathname)
        ) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              url.pathname === "/health"
                ? {
                    status: "ok",
                    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
                    uptimeSeconds: process.uptime(),
                    runtime,
                  }
                : monitoring.snapshot(),
            ),
          );
          return;
        }
        if (req.method !== "POST" || url.pathname !== "/improve") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Use POST /improve." }));
          return;
        }
        try {
          if (
            !["", "json", "report"].includes(
              url.searchParams.get("output") ?? "",
            )
          )
            throw Object.assign(new Error("output must be json or report."), {
              status: 400,
            });
          await allocateRunDirectory(request);
          const { test, prompt } = await parseUpload(req);
          request.inputTest = test;
          request.prompt = prompt;
          log("info", "upload_parsed", {
            promptLength: prompt.length,
            sectionCount: test.sections?.length ?? null,
          });
          const result = await runImprovement(test, prompt);
          request.status = 200;
          request.outputTest = result.test;
          request.changes = result.changes;
          log("info", "run_succeeded", { changeCount: result.changes.length });
          log("info", "run_output_ready", {
            status: 200,
            durationMs: performance.now() - started,
          });
          const runDirectory = await persistRun(request);
          if (request.runId) res.setHeader("X-Run-ID", request.runId);
          res.setHeader("X-Run-Number", request.runNumber);
          res.setHeader(
            "X-Run-Directory",
            path.relative(projectRoot, runDirectory),
          );
          res.setHeader("X-Improvement-Change-Count", result.changes.length);
          if (url.searchParams.get("output") === "report") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, ...result }, null, 2));
          } else {
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Content-Disposition":
                'attachment; filename="improved-test.json"',
            });
            res.end(JSON.stringify(result.test, null, 2));
          }
        } catch (error) {
          request.status = error.status ?? 500;
          request.error = error.message;
          log(
            (error.status ?? 500) >= 500 ? "error" : "warn",
            "improvement_failed",
            {
              stage: request.stage,
              status: error.status ?? 500,
              errorType: error.name,
              error: error.message,
              cost: summarizeCost(request.costEntries),
            },
          );
          log("warn", "run_failed", {
            status: error.status ?? 500,
            durationMs: performance.now() - started,
          });
          try {
            await persistRun(request);
            if (request.runId) {
              res.setHeader("X-Run-ID", request.runId);
              res.setHeader("X-Run-Number", request.runNumber);
              res.setHeader(
                "X-Run-Directory",
                path.relative(projectRoot, request.runDirectory),
              );
            }
          } catch (storageError) {
            log("error", "run_data_persist_failed", {
              errorType: storageError.name,
              code: storageError.code,
            });
          }
          res.writeHead(error.status ?? 500, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify({
              success: false,
              requestId: request.requestId,
              ...(request.runId ? { runId: request.runId } : {}),
              error: error.status
                ? error.message
                : "Improvement failed; no revised test was returned.",
            }),
          );
        }
      },
    ),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT || 3100);
  const server = createServer();
  server.requestTimeout = 15 * 60 * 1000;
  server.listen(port, "127.0.0.1", () =>
    logger.info("server_started", {
      host: "127.0.0.1",
      port,
      model: process.env.OPENAI_MODEL || "gpt-6-luna",
      runtime,
    }),
  );
  server.on("error", (error) =>
    {
      logger.error("server_error", {
        errorType: error.name,
        code: error.code,
        error: error.code === "EADDRINUSE"
          ? `Port ${port} is already in use. Stop the other server before starting this one.`
          : error.message,
      });
      process.exitCode = 1;
    },
  );
}
