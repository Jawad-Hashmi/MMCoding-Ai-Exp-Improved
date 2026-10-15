import { isDeepStrictEqual } from "node:util";
export const copy = (v) => structuredClone(v);
export function problem(message, status = 422) {
  throw Object.assign(new Error(message), { status });
}
export function tokens(path) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    /~(?![01])/u.test(path)
  )
    problem("Invalid JSON pointer.");
  const result = path
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (result.some((s) => ["__proto__", "prototype", "constructor"].includes(s)))
    problem("Unsafe JSON pointer.");
  return result;
}
function locate(root, path) {
  const parts = tokens(path);
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, part))
      problem(`Missing path: ${path}`);
    parent = parent[part];
  }
  if (!parent || typeof parent !== "object") problem(`Invalid parent: ${path}`);
  let key = parts.at(-1);
  if (Array.isArray(parent)) {
    if (key === "-") key = parent.length;
    else if (!/^(0|[1-9]\d*)$/u.test(key)) problem("Invalid array index.");
    else key = Number(key);
  }
  return { parent, key };
}
export function read(root, path) {
  const { parent, key } = locate(root, path);
  if (!Object.hasOwn(parent, key)) problem(`Missing path: ${path}`);
  return parent[key];
}
function write(root, op, path, value) {
  const { parent, key } = locate(root, path);
  const exists = Object.hasOwn(parent, key);
  if (op !== "add" && !exists) problem(`Missing path: ${path}`);
  if (Array.isArray(parent)) {
    if (key > parent.length) problem("Array index out of range.");
    if (op === "add") parent.splice(key, 0, copy(value));
    else if (op === "remove") parent.splice(key, 1);
    else parent[key] = copy(value);
  } else {
    if (op === "add" && exists)
      problem("Use replace for an existing property.");
    if (op === "remove") delete parent[key];
    else parent[key] = copy(value);
  }
}
export function applyAuthorized(test, operations, plan) {
  if (!Array.isArray(operations) || operations.length !== plan.length)
    problem("Patch must match the exact approved plan.");
  const result = copy(test),
    changes = [];
  operations.forEach((operation, i) => {
    const expected = plan[i];
    if (
      !operation ||
      Object.keys(operation).some(
        (key) => !["op", "path", "from", "value"].includes(key),
      )
    )
      problem("Unexpected patch field.");
    if (
      operation.op !== expected.op ||
      operation.path !== expected.path ||
      (operation.from ?? null) !== (expected.from ?? null)
    )
      problem("Patch escaped the planned scope.");
    tokens(operation.path);
    const { op, path } = operation;
    if (!["replace", "add", "remove", "move"].includes(op))
      problem("Unsupported patch operation.");
    if (op === "move") {
      tokens(operation.from);
      if (path === operation.from || path.startsWith(operation.from + "/"))
        problem("Invalid move.");
      const value = copy(read(result, operation.from));
      write(result, "remove", operation.from);
      write(result, "add", path, value);
      changes.push({ op, path, from: operation.from, value });
    } else {
      const before = op === "add" ? undefined : copy(read(result, path));
      if (op === "replace" && before !== null && typeof before === "object")
        problem(
          "Replace individual leaves; use explicit add/remove/move for structural edits.",
        );
      if (op !== "remove" && !Object.hasOwn(operation, "value"))
        problem("Patch value is required.");
      if (op === "replace" && isDeepStrictEqual(before, operation.value))
        problem("No-op replacement is not an improvement.");
      write(result, op, path, operation.value);
      changes.push({
        op,
        path,
        ...(op !== "add" ? { before } : {}),
        ...(op !== "remove" ? { after: copy(operation.value) } : {}),
      });
    }
  });
  return { test: result, changes };
}
