// A stand-in for the Anthropic Messages API, so the AI assistant can be tested without a key.
// Start the CMS with ANTHROPIC_API_KEY=fake ANTHROPIC_BASE_URL=http://localhost:3999 to use it.
// It answers every request through the tool it is given, as the real model is forced to:
// drafts echo the topic, translations mark the source text so the test can recognise them,
// and "Fix with AI" gets SEO fields of the right lengths.
import http from "node:http";

export const FAKE_AI_PORT = Number(process.env.FAKE_AI_PORT ?? 3999);

/** Requests received, newest last: the test inspects the prompts the CMS sent. */
export const requests = [];

function draft(prompt, categories) {
  const topic = prompt.match(/Topic: (.*)/)?.[1] ?? "Chủ đề";
  return {
    title: `Bản nháp AI: ${topic}`,
    excerpt: `Tóm tắt về ${topic}.`,
    metaTitle: `${topic} | Qub-X`,
    metaDescription: `Bài viết về ${topic}, do trợ lý AI viết nháp để biên tập viên đọc lại.`,
    focusKeyword: topic.toLowerCase(),
    // Like the real model, pick one of the categories the tool offers.
    ...(categories?.length ? { category: categories.at(-1) } : {}),
    html: [
      `<h2>Mở đầu</h2><p>Đoạn mở đầu về <strong>${topic}</strong>.</p>`,
      `<h2>Các bước</h2><ol><li><p>Bước một</p></li><li><p>Bước hai</p></li></ol>`,
      `<table><tr><th><p>Tiêu chí</p></th><th><p>Ghi chú</p></th></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></table>`,
      `<div data-callout data-variant="success"><p>Điểm chính: làm từng bước.</p></div>`,
      // Unsupported markup the editor must drop.
      `<script>alert(1)</script><p style="color:red" onclick="x()">Kết luận.</p>`,
    ].join(""),
  };
}

function translation(prompt) {
  const field = (name) => prompt.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? "";
  const body = prompt.split("Body HTML:\n")[1] ?? "";
  // Keep the markup, mark every text run as translated.
  const html = body.replace(/>([^<>]+)</g, (_, text) => (text.trim() ? `>[EN] ${text}<` : `>${text}<`));
  return {
    title: `[EN] ${field("Title")}`,
    excerpt: `[EN] ${field("Summary")}`,
    metaTitle: `[EN] ${field("Meta title")}`,
    metaDescription: `[EN] ${field("Meta description")}`,
    focusKeyword: `[EN] ${field("Main search phrase")}`,
    html,
  };
}

/** "Fix with AI" in the SEO score: the fields asked for, each within the score's lengths. */
function seoFields(properties) {
  const values = {
    metaTitle: "[AI] Phần mềm quản lý spa: 5 tiêu chí chọn đúng",
    metaDescription: "[AI] Chọn phần mềm quản lý spa thế nào để lễ tân bớt việc, khách không trùng lịch? Năm tiêu chí giúp chủ spa chọn đúng ngay lần đầu.",
    excerpt: "[AI] Năm tiêu chí giúp chủ spa chọn đúng phần mềm quản lý.",
    focusKeyword: "phần mềm quản lý spa",
  };
  return Object.fromEntries(Object.keys(properties).map((k) => [k, values[k] ?? `[AI] ${k}`]));
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

export function startFakeAnthropic() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
        res.writeHead(404).end();
        return;
      }
      const request = JSON.parse(body);
      requests.push(request);
      const prompt = request.messages[0].content;
      const tool = request.tools?.[0];
      const categories = tool?.input_schema?.properties?.category?.enum;
      const input =
        tool?.name === "seo_fields"
          ? seoFields(tool.input_schema.properties)
          : request.system?.startsWith("You translate")
            ? translation(prompt)
            : draft(prompt, categories);
      const json = JSON.stringify(input);
      const message = { id: "msg_fake", type: "message", role: "assistant", model: request.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } };
      const events = [
        ["message_start", { type: "message_start", message }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_fake", name: tool?.name ?? "article", input: {} } }],
        // Sent in pieces, like the real stream.
        ...json.match(/[\s\S]{1,200}/g).map((part) => [
          "content_block_delta",
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: part } },
        ]),
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 100 } }],
        ["message_stop", { type: "message_stop" }],
      ];
      if (request.stream) sse(res, events);
      else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...message, content: [{ type: "tool_use", id: "toolu_fake", name: tool?.name ?? "article", input }], stop_reason: "tool_use" }));
      }
    });
  });
  return new Promise((resolve) => server.listen(FAKE_AI_PORT, () => resolve(server)));
}

// Run on its own: `node tests/ai/fake-anthropic.mjs`
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/").replace(/^\//, "")}`) {
  await startFakeAnthropic();
  console.log(`Fake Anthropic API on http://localhost:${FAKE_AI_PORT}`);
}
