import { copy, problem, read } from "./patch.js";

const SHARED_BANK_TYPES = new Set([
  "matching_headings",
  "matching_features",
  "matching_names",
  "matching_sentence_endings",
]);

/** Find identical option copies stored on each question in a shared-bank group. */
export function findSharedOptionBanks(test) {
  const banks = [];
  for (const [sectionIndex, section] of (test.sections ?? []).entries()) {
    for (const [partIndex, part] of (section.parts ?? []).entries()) {
      const questions = part.questions ?? [];
      for (const group of section.questionGroups ?? []) {
        if (!SHARED_BANK_TYPES.has(group.type)) continue;
        const members = questions
          .map((question, questionIndex) => ({ question, questionIndex }))
          .filter(
            ({ question }) =>
              question.questionType === group.type &&
              Number.isInteger(question.questionId) &&
              question.questionId >= group.questionStart &&
              question.questionId <= group.questionEnd,
          );
        const occurrences = new Map();
        for (const { question, questionIndex } of members) {
          for (const [optionIndex, option] of (
            question.options ?? []
          ).entries()) {
            if (
              typeof option.label !== "string" ||
              typeof option.text !== "string"
            )
              continue;
            const identity = `${option.label.trim().toLowerCase()}\u0000${option.text.trim().replace(/\s+/gu, " ")}`;
            const entry = occurrences.get(identity) ?? {
              label: option.label,
              originalText: option.text,
              questionType: group.type,
              groupId: group.groupId ?? null,
              paths: [],
              questionIds: [],
            };
            entry.paths.push(
              `/sections/${sectionIndex}/parts/${partIndex}/questions/${questionIndex}/options/${optionIndex}/text`,
            );
            entry.questionIds.push(question.questionId);
            occurrences.set(identity, entry);
          }
        }
        for (const entry of occurrences.values()) {
          if (entry.paths.length > 1)
            banks.push({
              ...entry,
              questionIds: [...new Set(entry.questionIds)],
            });
        }
      }
    }
  }
  return banks;
}

export function addMissingSharedBankPaths(plan, banks) {
  const expanded = [...plan];
  for (const bank of banks) {
    const selected = bank.paths
      .map((path) => expanded.find((edit) => edit.path === path))
      .find(Boolean);
    if (!selected) continue;
    for (const path of bank.paths) {
      if (!expanded.some((edit) => edit.path === path)) {
        expanded.push({
          ...selected,
          path,
          purpose: `Apply the same paraphrase to shared option ${bank.label} in every question that uses this bank.`,
        });
      }
    }
  }
  return expanded;
}

export function synchronizeSharedBankOperations(operations, plan, banks) {
  if (!Array.isArray(operations))
    problem("Repair response omitted its operation list.");
  const synchronized = copy(operations);
  const operationByPath = new Map(
    synchronized.map((operation) => [operation.path, operation]),
  );
  for (const bank of banks) {
    const plannedPaths = bank.paths.filter((path) =>
      plan.some((edit) => edit.path === path),
    );
    if (!plannedPaths.length) continue;
    if (plannedPaths.length !== bank.paths.length)
      problem("Shared option bank plan is incomplete.");
    const copies = plannedPaths.map((path) => operationByPath.get(path));
    if (
      copies.some(
        (operation) =>
          !operation ||
          operation.op !== "replace" ||
          typeof operation.value !== "string",
      )
    )
      problem(`Repair omitted a shared option copy for label ${bank.label}.`);
    for (const operation of copies) operation.value = copies[0].value;
  }
  return synchronized;
}

export function assertSharedBanksConsistent(improved, banks) {
  for (const bank of banks) {
    const texts = bank.paths.map((path) => read(improved, path));
    if (texts.some((text) => text !== texts[0]))
      problem(
        `Shared option ${bank.label} is inconsistent across its answer bank.`,
      );
  }
}
