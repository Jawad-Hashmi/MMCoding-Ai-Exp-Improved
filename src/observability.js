import winston from "winston";
import { AsyncLocalStorage } from "node:async_hooks";

const transports = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(
        ({ timestamp, level, message, requestId, runId, stage, status,
          durationMs, code, error, host, port, changeCount, count, issueCount,
          retryAttempts, cost, usage }) => {
          const details = [
            runId ? `run=${runId}` : requestId ? `request=${requestId}` : null,
            stage ? `stage=${stage}` : null,
            status !== undefined ? `status=${status}` : null,
            durationMs !== undefined ? `elapsed=${(durationMs / 1000).toFixed(1)}s` : null,
            host && port ? `url=http://${host}:${port}` : null,
            changeCount !== undefined ? `changes=${changeCount}` : null,
            count !== undefined ? `count=${count}` : null,
            issueCount !== undefined ? `issues=${issueCount}` : null,
            retryAttempts !== undefined ? `retries=${retryAttempts}` : null,
            usage?.total_tokens !== undefined ? `tokens=${usage.total_tokens}` : null,
            cost?.usd != null ? `cost=$${cost.usd.toFixed(6)}${cost.pkr != null ? ` / PKR ${cost.pkr.toFixed(2)}` : ""}` : null,
            code ? `code=${code}` : null,
            error ? `error=${error}` : null,
          ].filter(Boolean);
          return `${timestamp} ${level} ${message.replaceAll("_", " ")}${details.length ? ` | ${details.join(" | ")}` : ""}`;
        },
      ),
    ),
  }),
];
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  defaultMeta: { service: "standalone-test-improver" },
  transports,
});
logger.on("error", () => process.stderr.write("Logging transport failed.\n"));
export const context = new AsyncLocalStorage();

export function log(level, message, metadata = {}) {
  const request = context.getStore();
  const enriched = {
    ...metadata,
    requestId: metadata.requestId ?? request?.requestId,
    runId: metadata.runId ?? request?.runId,
  };
  const event = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...enriched,
  };
  if (request) {
    event.requestId = request.requestId;
    request.events?.push(event);
  }
  logger.log(level, message, enriched);
}

function rate(env, name) {
  const value = env[name];
  return value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
    ? Number(value)
    : null;
}
export function estimateCost(usage, env = process.env) {
  const input = rate(env, "OPENAI_INPUT_USD_PER_MILLION");
  const output = rate(env, "OPENAI_OUTPUT_USD_PER_MILLION");
  const cachedRate = rate(env, "OPENAI_CACHED_INPUT_USD_PER_MILLION") ?? input;
  const cacheWriteRate = rate(env, "OPENAI_CACHE_WRITE_USD_PER_MILLION");
  const valid =
    usage &&
    [usage.prompt_tokens, usage.completion_tokens].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    );
  const cached = valid
    ? Math.min(
        usage.prompt_tokens,
        Math.max(0, usage.prompt_tokens_details?.cached_tokens || 0),
      )
    : 0;
  const cacheWrite = valid
    ? Math.min(
        usage.prompt_tokens - cached,
        Math.max(0, usage.prompt_tokens_details?.cache_write_tokens || 0),
      )
    : 0;
  const ordinary = valid ? usage.prompt_tokens - cached - cacheWrite : 0;
  const usd =
    valid &&
    input !== null &&
    output !== null &&
    (cacheWrite === 0 || cacheWriteRate !== null)
      ? (ordinary * input +
          cached * cachedRate +
          cacheWrite * cacheWriteRate +
          usage.completion_tokens * output) /
        1e6
      : null;
  const usdToPkr = rate(env, "USD_TO_PKR") || null;
  return {
    currency: "USD",
    estimated: true,
    usd,
    pkr: usd !== null && usdToPkr !== null ? usd * usdToPkr : null,
    usdToPkr,
    inputRate: input,
    cachedInputRate: cachedRate,
    cacheWriteRate,
    cacheWriteTokens: cacheWrite,
    outputRate: output,
  };
}
export function summarizeCost(entries, env = process.env) {
  const costs = entries.map(
    (entry) => entry.cost ?? estimateCost(entry.usage, env),
  );
  const usdToPkr = rate(env, "USD_TO_PKR") || null;
  const usd = costs.every((c) => c.usd !== null)
    ? costs.reduce((sum, c) => sum + c.usd, 0)
    : null;
  const knownUsd = costs.reduce((sum, c) => sum + (c.usd ?? 0), 0);
  return {
    currency: "USD",
    estimated: true,
    complete: costs.every((c) => c.usd !== null),
    usd,
    knownUsd,
    usdToPkr,
    pkr: usd !== null && usdToPkr !== null ? usd * usdToPkr : null,
    knownPkr: usdToPkr !== null ? knownUsd * usdToPkr : null,
  };
}
export function createMonitoring() {
  const state = {
    requests: 0,
    active: 0,
    failures: 0,
    aborted: 0,
    durationMs: 0,
    modelCalls: 0,
    modelFailures: 0,
    promptTokens: 0,
    completionTokens: 0,
    knownEstimatedUsd: 0,
    unpricedCalls: 0,
    stages: {},
  };
  return {
    state,
    stage(stage, durationMs, failed, usage, cost) {
      state.modelCalls++;
      if (failed) state.modelFailures++;
      state.promptTokens += usage?.prompt_tokens || 0;
      state.completionTokens += usage?.completion_tokens || 0;
      state.knownEstimatedUsd += cost.usd ?? 0;
      if (cost.usd === null) state.unpricedCalls++;
      const totals = (state.stages[stage] ??= {
        calls: 0,
        failures: 0,
        durationMs: 0,
      });
      totals.calls++;
      totals.failures += Number(failed);
      totals.durationMs += durationMs;
    },
    snapshot() {
      const usdToPkr = rate(process.env, "USD_TO_PKR") || null;
      return {
        ...structuredClone(state),
        usdToPkr,
        knownEstimatedPkr:
          usdToPkr !== null ? state.knownEstimatedUsd * usdToPkr : null,
        uptimeSeconds: process.uptime(),
        memoryBytes: process.memoryUsage(),
      };
    },
  };
}
