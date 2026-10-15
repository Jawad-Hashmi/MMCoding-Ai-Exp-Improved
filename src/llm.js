export async function callModel(stage, system, data) {
  const key = process.env.OPENAI_API_KEY;
  if (!key)
    throw Object.assign(
      new Error("Set OPENAI_API_KEY before requesting improvements."),
      { status: 503 },
    );
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(180000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-6-luna",
      store: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(data) },
      ],
    }),
  });
  if (!response.ok)
    throw Object.assign(
      new Error(`Model request failed at ${stage} (HTTP ${response.status}).`),
      { status: 502 },
    );
  const result = await response.json();
  const choice = result.choices?.[0];
  if (choice?.finish_reason !== "stop" || choice.message?.refusal)
    throw Object.assign(
      new Error(`Incomplete or refused model response at ${stage}.`),
      { status: 502, usage: result.usage },
    );
  try {
    return {
      data: JSON.parse(choice.message.content),
      usage: result.usage,
      stage,
    };
  } catch {
    throw Object.assign(new Error(`Invalid model JSON at ${stage}.`), {
      status: 502,
      usage: result.usage,
    });
  }
}
