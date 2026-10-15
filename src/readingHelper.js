// In the standalone test format, questionId is the answer-sheet slot number.
export function getAnswerSlots(question) {
  if (!Number.isInteger(question?.questionId)) {
    throw new Error("Question is missing its numeric questionId answer slot.");
  }
  return [question.questionId];
}
