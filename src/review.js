import { problem, tokens } from "./patch.js";

export const MAX_REVIEW_REPAIRS = 2;
export const MAX_REPAIR_PATHS = 50;

export function normalizePointer(path, root) {
  return typeof path === "string" &&
    path.startsWith("/test/") &&
    !Object.hasOwn(root, "test")
    ? path.slice("/test".length)
    : path;
}

export function answerEndingPairs(original, improved) {
  const pairs = [];
  for (const [sectionIndex, section] of (original.sections ?? []).entries()) {
    for (const [partIndex, part] of (section.parts ?? []).entries()) {
      for (const [questionIndex, question] of (
        part.questions ?? []
      ).entries()) {
        if (question.questionType !== "matching_sentence_endings") continue;
        const answerLabel = Array.isArray(question.correctAnswers)
          ? question.correctAnswers[0]
          : undefined;
        const originalOption = (question.options ?? []).find(
          (item) => item.label === answerLabel,
        );
        const proposed =
          improved.sections?.[sectionIndex]?.parts?.[partIndex]?.questions?.[
            questionIndex
          ];
        const proposedOption = proposed?.options?.find(
          (item) => item.label === answerLabel,
        );
        pairs.push({
          questionId: question.questionId,
          answerLabel,
          originalStem: question.question,
          originalCorrectEnding: originalOption?.text ?? null,
          proposedStem: proposed?.question ?? null,
          proposedCorrectEnding: proposedOption?.text ?? null,
          originalCorrectAnswers: question.correctAnswers ?? null,
          proposedCorrectAnswers: proposed?.correctAnswers ?? null,
        });
      }
    }
  }
  return pairs;
}

export function assertProtectedAnswers(original, improved, plan = []) {
  const correctionPaths = new Set(
    plan
      .filter(
        (edit) =>
          edit.path.includes("/correctAnswers") &&
          typeof edit.purpose === "string" &&
          edit.purpose.startsWith("Correct"),
      )
      .map((edit) => edit.path.slice(0, edit.path.indexOf("/correctAnswers"))),
  );
  for (const [sectionIndex, section] of (original.sections ?? []).entries()) {
    for (const [partIndex, part] of (section.parts ?? []).entries()) {
      for (const [questionIndex, question] of (
        part.questions ?? []
      ).entries()) {
        const proposed =
          improved.sections?.[sectionIndex]?.parts?.[partIndex]?.questions?.[
            questionIndex
          ];
        if (
          JSON.stringify(question.correctAnswers ?? null) !==
          JSON.stringify(proposed?.correctAnswers ?? null)
        ) {
          const questionPath = `/sections/${sectionIndex}/parts/${partIndex}/questions/${questionIndex}`;
          if (!correctionPaths.has(questionPath))
            problem(
              `Answer key changed without a planned correction for question ${question.questionId}.`,
            );
        }
      }
    }
  }
}

export function reviewIssues(audit, plan, banks, root) {
  if (!Array.isArray(audit?.issues) || audit.issues.length === 0)
    problem(
      audit?.reason ||
        "Final repair verification failed; reviewer did not identify safe, targeted edits.",
    );
  const allowed = new Set(
    plan.filter((edit) => edit.op === "replace").map((edit) => edit.path),
  );
  const paths = new Set();
  for (const issue of audit.issues) {
    if (
      !Array.isArray(issue.paths) ||
      !issue.paths.length ||
      typeof issue.reason !== "string"
    )
      problem(
        "Final review rejected the repair without valid, path-specific issues.",
      );
    const issuePaths = [];
    for (const candidate of issue.paths) {
      const path = normalizePointer(candidate, root);
      tokens(path);
      if (allowed.has(path)) issuePaths.push(path);
    }
    // The reviewer can mention an unchanged field to explain a defect (for
    // example, a stem that combines with a planned option). Retry only fields
    // the user authorized. If no authorized field can address the issue, the
    // audit will still fail below with its substantive reason.
    issuePaths.forEach((path) => paths.add(path));
  }
  if (!paths.size)
    problem(
      audit?.reason ||
        "Final review found no repairable issue within the approved edit plan.",
    );
  for (const bank of banks) {
    if (bank.paths.some((path) => paths.has(path)))
      bank.paths.forEach((path) => paths.add(path));
  }
  if (paths.size > MAX_REPAIR_PATHS)
    problem("Final review flagged too many edits for a safe targeted retry.");
  return paths;
}

export function assertReviewResponse(audit) {
  if (!audit || typeof audit.approved !== "boolean")
    problem("Final review returned an invalid approval response.");
  if (audit.approved && Array.isArray(audit.issues) && audit.issues.length)
    problem(
      "Final review approved the draft while also reporting unresolved issues.",
    );
}

export function mergeChanges(originalChanges, retryChanges) {
  const merged = new Map(
    originalChanges.map((change) => [change.path, change]),
  );
  for (const change of retryChanges) {
    const previous = merged.get(change.path);
    merged.set(change.path, {
      ...change,
      ...(previous && Object.hasOwn(previous, "before")
        ? { before: previous.before }
        : {}),
    });
  }
  return [...merged.values()];
}
