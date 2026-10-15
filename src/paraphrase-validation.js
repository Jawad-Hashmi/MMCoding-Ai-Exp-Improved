import { read } from "./patch.js";

const STOP_WORDS = new Set(
  `a an the and or but if then than so as at by for from in into of on onto to with without is are was were be been being do does did have has had this that these those it its they them their we you he she who which what when where why how`.split(
    " ",
  ),
);

function words(value) {
  return (
    String(value ?? "")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function ngrams(value, size = 3) {
  const list = words(value);
  const result = new Set();
  for (let index = 0; index <= list.length - size; index++) {
    const phrase = list.slice(index, index + size);
    if (phrase.every((word) => STOP_WORDS.has(word))) continue;
    result.add(phrase.join(" "));
  }
  return result;
}

export function sharedPhrases(question, passage, size = 3) {
  const passagePhrases = ngrams(passage, size);
  return [...ngrams(question, size)].filter((phrase) =>
    passagePhrases.has(phrase),
  );
}

function passageText(part) {
  if (typeof part.paragraph === "string") return part.paragraph;
  if (Array.isArray(part.paragraphs))
    return part.paragraphs.map((paragraph) => paragraph?.text ?? "").join("\n");
  return "";
}

/** Find exact 3+ word overlaps on text paths the authorized plan intends to edit. */
export function findParaphraseOverlapIssues(test, plan) {
  const issues = [];
  for (const edit of plan) {
    if (edit.op !== "replace") continue;
    // The question path has no trailing /question after an option; parse each
    // supported primitive path explicitly to keep answer keys out of scope.
    const questionMatch =
      /^\/sections\/(\d+)\/parts\/(\d+)\/questions\/(\d+)\/question$/u.exec(
        edit.path,
      );
    const optionMatch =
      /^\/sections\/(\d+)\/parts\/(\d+)\/questions\/(\d+)\/options\/(\d+)\/text$/u.exec(
        edit.path,
      );
    if (!questionMatch && !optionMatch) continue;
    const parts = (questionMatch ?? optionMatch).slice(1).map(Number);
    const [sectionIndex, partIndex, questionIndex] = parts;
    const question =
      test.sections?.[sectionIndex]?.parts?.[partIndex]?.questions?.[
        questionIndex
      ];
    if (
      !question ||
      (question.questionType === "matching_headings" && questionMatch)
    )
      continue;
    if (
      optionMatch &&
      [
        "sentence_completion",
        "summary_completion",
        "notes_completion",
        "short_answer",
        "diagram_completion",
        "flowchart_completion",
        "table_completion",
      ].includes(question.questionType)
    ) {
      const option = question.options?.[Number(optionMatch[4])];
      const answers = Array.isArray(question.correctAnswers)
        ? question.correctAnswers
        : [question.correctAnswers];
      if (option && answers.includes(option.label)) continue;
    }
    const text = read(test, edit.path);
    if (typeof text !== "string" || !text.trim()) continue;
    const overlaps = sharedPhrases(
      text,
      passageText(test.sections[sectionIndex].parts[partIndex]),
    );
    if (overlaps.length)
      issues.push({
        type: "paraphrase_overlap",
        paths: [edit.path],
        reason: `Question text shares exact passage wording: ${overlaps
          .slice(0, 8)
          .map((item) => `“${item}”`)
          .join(
            ", ",
          )}. Rewrite with stronger paraphrasing while preserving meaning and the answer.`,
        phrases: overlaps,
      });
  }
  return issues;
}
