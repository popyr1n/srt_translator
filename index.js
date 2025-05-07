addEventListener("fetch", event => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // 1. Читаем весь SRT как простой текст
  const srt = await request.text();
  if (!srt) {
    return new Response("Empty body", { status: 400 });
  }

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

  // 3. Склеиваем батч для отправки AI
  const batchedText = items.map(it => it.text.join("|||")).join("|||");

  // 4. Собираем URL для Vertex AI (Gemini)
  const projectId = PROJECT_ID;   // из wrangler.toml
  const location  = LOCATION;     // тоже из wrangler.toml
  const apiKey    = API_KEY;      // переменная окружения
  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}` +
              `/locations/${location}/publishers/google/models/text-bison:predict?key=${apiKey}`;

  // 5. Делаем запрос к AI
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
    const err = await aiResp.text();
    return new Response(`AI Error: ${err}`, { status: 502 });
  }
  const aiJson = await aiResp.json();
  const translated = aiJson.predictions[0].content.split("|||");

  // 6. Встраиваем перевод обратно в структуру
  const result = items.map((it, i) => ({
    idx:   it.idx,
    start: it.start,
    end:   it.end,
    text:  translated[i].split(/\r?\n/)  // разбиваем обратно по строкам
  }));

  // 7. Отдаём JSON
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" }
  });
}
