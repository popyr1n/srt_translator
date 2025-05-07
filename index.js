// wrangler.toml: убедитесь, что у вас есть binding для API_KEY
// [vars]
// API_KEY = "AIzaSyCeFVnLS2qTMrHngnf_OKwQCEosIV4AGws"
// PROJECT_ID = "7558111673:AAF5QK7rbhCl6UAk0by1k5HJaFGoioRAKQE"
// LOCATION = "us-central1"

addEventListener("fetch", event => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 1. Читаем multipart/form-data
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return new Response("Expected multipart/form-data", { status: 400 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!file) {
    return new Response("Missing file field", { status: 400 });
  }
  const srt = await file.text();

  // 2. Парсим SRT в массив сегментов
  const items = srt.trim()
    .split(/\r?\n\r?\n/)
    .map(block => {
      const lines = block.split(/\r?\n/);
      const idx   = lines[0];
      const [start, end] = lines[1].split(" --> ");
      const textLines    = lines.slice(2);
      return { idx, start, end, text: textLines };
    });

  // 3. Готовим батч для AI (склеиваем все тексты через |||)
  const batchedText = items.map(it => it.text.join("|||")).join("|||");

  // 4. Вызываем Gemini (Vertex AI) для перевода
  const projectId = PROJECT_ID;   // берётся из wrangler.toml
  const location  = LOCATION;     // тоже из wrangler.toml
  const apiKey    = API_KEY;      // и этот
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}` +
              `/locations/${location}/publishers/google/models/text-bison:predict?key=${apiKey}`;

  const aiResp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{
        content: `Translate the following English subtitles into Russian, preserving SRT timings:\n\n${batchedText}`,
        mimeType: "text/plain"
      }]
    })
  });
  if (!aiResp.ok) {
    const errText = await aiResp.text();
    return new Response(`AI Error: ${errText}`, { status: 502 });
  }
  const aiJson = await aiResp.json();
  const translated = aiJson.predictions[0].content.split("|||");

  // 5. Встраиваем переводы обратно в структуру items
  const result = items.map((it, i) => ({
    idx:   it.idx,
    start: it.start,
    end:   it.end,
    text:  translated[i].split("\n")
  }));

  // 6. Отдаём готовый JSON
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" }
  });
}
