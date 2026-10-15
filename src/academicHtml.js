import { getAnswerSlots } from "./readingHelper.js";

const COMPLETION_TYPES = new Set([
  "sentence_completion",
  "summary_completion",
  "notes_completion",
  "diagram_completion",
  "flowchart_completion",
  "table_completion",
]);

const SHARED_BANK_TYPES = new Set([
  "matching_headings",
  "matching_features",
  "matching_names",
  "matching_sentence_endings",
]);

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function renderBlank(question) {
  const text = escapeHtml(question.question);

  const blank = `
    <span class="answer-blank">
      <strong>${question.questionId}</strong>
      <span class="answer-line"></span>
    </span>`;

  return text.replace(/_{3,}/, blank);
}

function renderOptions(options, title = "") {
  return `
    <div class="option-bank">
      ${title ? `<h4>${escapeHtml(title)}</h4>` : ""}
      <ul class="options">
        ${options
          .map((option) => {
            const text =
              String(option.text ?? "")
                .trim()
                .toLowerCase() ===
              String(option.label ?? "")
                .trim()
                .toLowerCase()
                ? ""
                : option.text;

            return `
              <li>
                <strong>${escapeHtml(option.label)}</strong>
                ${text ? `<span>${escapeHtml(text)}</span>` : ""}
              </li>`;
          })
          .join("")}
      </ul>
    </div>`;
}

function renderLetterBank(options, title) {
  return `
    <div class="option-bank letter-bank">
      <strong>${escapeHtml(title)}:</strong>
      ${options
        .map((o) => `<span class="letter">${escapeHtml(o.label)}</span>`)
        .join("")}
    </div>`;
}

function renderQuestion(question) {
  if (COMPLETION_TYPES.has(question.questionType)) {
    return renderBlank(question);
  }

  const slots = getAnswerSlots(question);

  const number = `<strong class="question-number">${slots[0]}</strong>`;

  const options = ["mcq_single", "mcq_multiple"].includes(question.questionType)
    ? renderOptions(question.options)
    : "";

  return `
    <div class="question-row">
      ${number}
      <div>
        ${escapeHtml(question.question)}
        ${options}
      </div>
    </div>`;
}

function renderGroup(group, allQuestions) {
  const questions = allQuestions
    .filter(
      (question) =>
        question.questionId >= group.questionStart &&
        question.questionId <= group.questionEnd,
    )
    .sort((a, b) => a.questionId - b.questionId);

  if (!questions.length) return "";

  const range =
    group.questionStart === group.questionEnd
      ? String(group.questionStart)
      : `${group.questionStart}–${group.questionEnd}`;

  const instructions = (
    group.instructions ||
    (questions.find((question) => question.instructions)?.instructions ?? "")
  )
    .replace(/^\s*Questions?\s+\d+(?:\s*[–-]\s*\d+)?\s*/i, "")
    .trim();

  const bank = SHARED_BANK_TYPES.has(group.type)
    ? renderOptions(
        questions[0].options,
        group.type === "matching_headings"
          ? "List of Headings"
          : group.type === "matching_sentence_endings"
            ? "Sentence Endings"
            : group.type === "matching_names"
              ? "List of Researchers / Organisations"
              : "List of Features",
      )
    : "";

  const letterBank =
    group.type === "matching_information" && questions[0].options?.length
      ? renderLetterBank(questions[0].options, "Paragraphs")
      : "";

  let content;

  if (group.type === "notes_completion") {
    content = `
      <ul class="notes">
        ${questions
          .map((question) => `<li>${renderQuestion(question)}</li>`)
          .join("")}
      </ul>`;
  } else if (group.type === "summary_completion") {
    content = `
      <div class="summary">
        ${questions.map(renderQuestion).join(" ")}
      </div>`;
  } else if (group.type === "flowchart_completion") {
    content = questions
      .map(
        (question, index) => `
          ${index ? '<div class="flow-arrow">↓</div>' : ""}
          <div class="flow-box">${renderQuestion(question)}</div>`,
      )
      .join("");
  } else {
    content = questions
      .map(
        (question) => `<div class="question">${renderQuestion(question)}</div>`,
      )
      .join("");
  }

  // Headings appear before their paragraph-selection questions.
  // Features/names/endings use one bank after the statements.
  const bankBefore = group.type === "matching_headings";

  return `
    <section class="question-group">
      <h3>Questions ${range}</h3>
      <div class="instructions">${escapeHtml(instructions)}</div>
      ${bankBefore ? bank : ""}
      ${letterBank}
      ${content}
      ${bankBefore ? "" : bank}
    </section>`;
}

function renderPassage(part) {
  const showLabels = part.showLabels !== false;
  const paragraphs =
    part.paragraphs ??
    part.paragraph
      .split(/\n\n+/)
      .filter(Boolean)
      .map((block) => {
        const match = block.match(/^([A-Z])\s*\n([\s\S]+)$/);

        return match
          ? { label: match[1], text: match[2] }
          : { label: "", text: block };
      });

  return `
    <article class="passage">
      <h2>${escapeHtml(part.partHeading)}</h2>
      ${paragraphs
        .map(
          (paragraph) => `
            <div class="paragraph">
              ${showLabels && paragraph.label ? `<strong class="paragraph-label">${escapeHtml(paragraph.label)}</strong>` : ""}
              <div>
                ${paragraph.heading ? `<h4 class="paragraph-heading">${escapeHtml(paragraph.heading)}</h4>` : ""}
                <p>${escapeHtml(paragraph.text)}</p>
              </div>
            </div>`,
        )
        .join("")}
    </article>`;
}

export function renderAcademicTestHtml(test) {
  const sections = test.sections
    .map((section) => {
      const part = section.parts[0];
      const groups = section.questionGroups;

      if (!groups?.length) {
        throw new Error(
          "HTML rendering requires section.questionGroups metadata.",
        );
      }

      const before = groups
        .filter((group) => group.placement === "before_passage")
        .map((group) => renderGroup(group, part.questions))
        .join("");

      const after = groups
        .filter((group) => group.placement === "after_passage")
        .map((group) => renderGroup(group, part.questions))
        .join("");

      const hasQuestionsBefore = before.length > 0;

      const instructions = hasQuestionsBefore
        ? section.instructions.replace(
            /Reading Passage (\d+) below\b/,
            "Reading Passage $1",
          )
        : section.instructions;

      return `
        <section class="reading-section">
          <header>
            <h1>READING PASSAGE ${section.order}</h1>
            <p>${escapeHtml(instructions)}</p>
          </header>

          ${before}
          ${renderPassage(part)}
          ${after}
        </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(test.title)}</title>

  <style>
    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: #111;
      background: #eee;
      font-family: Arial, sans-serif;
      font-size: 15px;
      line-height: 1.6;
    }

    .reading-section {
      max-width: 820px;
      margin: 24px auto;
      padding: 44px 52px;
      background: white;
    }

    h1 { font-size: 20px; }
    h2 { font-size: 21px; text-align: center; }
    h3 { font-size: 17px; }
    h4 { margin: 0 0 12px; text-align: center; }

    header {
      margin-bottom: 26px;
      border-bottom: 1px solid #333;
    }

    .instructions {
      white-space: pre-line;
      margin-bottom: 18px;
    }

    .question-group { margin: 28px 0; }
    .question { margin: 14px 0; }

    .paragraph {
      display: flex;
      align-items: baseline;
      gap: 16px;
    }

    .paragraph-label { min-width: 18px; }
    .paragraph p { margin: 10px 0; }
    .paragraph-heading { margin: 12px 0 0; font-size: 1rem }

    .question-row {
      display: flex;
      gap: 12px;
      align-items: baseline;
    }

    .question-number { min-width: 22px; }

    .option-bank {
      margin: 18px 0;
      padding: 14px 18px;
      border: 1px solid #777;
    }

    .options {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .options li {
      display: flex;
      gap: 12px;
      margin: 5px 0;
    }

    .options strong { min-width: 24px; }
    .letter-bank { display: flex; gap: 12px; flex-wrap: wrap; }
    .letter { min-width: 22px; text-align: center; border: 1px solid #777; }
    .notes li { margin: 14px 0; }

    .summary {
      border: 1px solid #777;
      padding: 18px;
      line-height: 2;
    }

    .answer-blank { white-space: nowrap; }

    .answer-line {
      display: inline-block;
      width: 140px;
      margin-left: 5px;
      border-bottom: 1px dotted #111;
    }

    .flow-box {
      border: 1px solid #777;
      padding: 14px;
      text-align: center;
    }

    .flow-arrow { text-align: center; }

    @page { size: A4; margin: 18mm; }

    @media print {
      body { background: white; }

      .reading-section {
        max-width: none;
        margin: 0;
        padding: 0;
      }

      .reading-section + .reading-section {
        break-before: page;
      }

      h1, h2, h3, h4 { break-after: avoid; }

      .question,
      .options li,
      .notes li,
      .flow-box {
        break-inside: avoid;
      }
    }

    @media (max-width: 600px) {
      .reading-section {
        margin: 0;
        padding: 22px;
      }

      .answer-line { width: 100px; }
    }
  </style>
</head>
<body>
  <main>${sections}
    <section class="reading-section answer-key"><h2>Answer key and evidence</h2>
    ${(test.answerKeyDetails ?? []).map((entry) => `<div class="question"><h3>${entry.questionId}. ${escapeHtml(entry.correctAnswers.join(", "))} — ${escapeHtml(entry.paraphraseLevel)}</h3><p>${escapeHtml(entry.reason)}</p>${entry.evidence.map((e) => `<p><strong>Paragraph ${escapeHtml(e.paragraphLabel)}:</strong> ${escapeHtml(e.quote)}</p>`).join("")}</div>`).join("")}
    ${test.answerKeyDetails?.length ? "" : `<ol>${(test.answerKey ?? []).map((answer) => `<li>${escapeHtml(String(answer).replace(/^\s*\d+\.\s*/, ""))}</li>`).join("")}</ol>`}
    </section>
  </main>
</body>
</html>`;
}
