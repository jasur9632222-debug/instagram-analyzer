export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username, reels } = req.body;
  const GROQ_KEY = process.env.GROQ_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  if (!reels || !reels.length) return res.status(400).json({ error: 'Reels not provided' });

  async function transcribeReel(reel) {
    try {
      const videoUrl = reel.videoUrl;
      if (!videoUrl) return null;
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) return null;
      const videoBuffer = await videoRes.arrayBuffer();
      if (!videoBuffer || videoBuffer.byteLength < 1000) return null;
      const uint8Array = new Uint8Array(videoBuffer);
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const beforeFile = '--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="language"\r\n\r\nuz\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="audio.mp4"\r\nContent-Type: video/mp4\r\n\r\n';
      const afterFile = '\r\n--' + boundary + '--\r\n';
      const beforeBytes = new TextEncoder().encode(beforeFile);
      const afterBytes = new TextEncoder().encode(afterFile);
      const body = new Uint8Array(beforeBytes.length + uint8Array.length + afterBytes.length);
      body.set(beforeBytes, 0);
      body.set(uint8Array, beforeBytes.length);
      body.set(afterBytes, beforeBytes.length + uint8Array.length);
      const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'multipart/form-data; boundary=' + boundary },
        body: body
      });
      if (!groqRes.ok) return null;
      return await groqRes.text() || null;
    } catch(e) { return null; }
  }

  try {
    const transcriptResults = await Promise.all(reels.map(async (reel) => {
      const transcript = await transcribeReel(reel);
      return {
        shortCode: reel.shortCode,
        url: reel.url,
        caption: (reel.caption || '').slice(0, 300),
        likes: reel.likesCount || 0,
        comments: reel.commentsCount || 0,
        date: reel.timestamp ? new Date(reel.timestamp * 1000).toLocaleDateString('ru') : '?',
        transcript: transcript || '(mavjud emas)'
      };
    }));

    const transcribedCount = transcriptResults.filter(r => r.transcript !== '(mavjud emas)').length;

    const reelsForClaude = transcriptResults.map((r, i) =>
      'REEL ' + (i+1) + ':\n' +
      'Caption: ' + r.caption + '\n' +
      'Lайки: ' + r.likes + ' | Комменты: ' + r.comments + '\n' +
      'Транскрипция: ' + r.transcript
    ).join('\n\n---\n\n');

    const avgLikes = Math.round(reels.reduce((s, r) => s + (r.likesCount || 0), 0) / reels.length);

    const prompt = `Ты — Senior Content Strategist с глубокой экспертизой в воронках контента и сценарном анализе.

Аккаунт: @${username}
Проанализировано reels: ${reels.length}
Транскрибировано: ${transcribedCount}
Средние лайки: ${avgLikes}

ТРАНСКРИПЦИИ:
${reelsForClaude}

Верни ТОЛЬКО валидный JSON без markdown, без backticks, без пояснений. Только JSON:

{
  "funnel": {
    "tof": <число % от 0 до 100>,
    "mof": <число % от 0 до 100>,
    "bof": <число % от 0 до 100>,
    "ideal": {"tof": 60, "mof": 30, "bof": 10},
    "verdict": "<2-3 предложения о балансе воронки>",
    "niche": "<определи нишу автора>",
    "niche_avg_er": "<средний ER в этой нише, например 2-4%>"
  },
  "missed_leads": {
    "count": <примерное число упущенных заявок>,
    "explanation": "<как посчитал>"
  },
  "videos": [
    {
      "index": 1,
      "funnel_type": "<TOF|MOF|BOF>",
      "hook_score": <число 1-10>,
      "hook_analysis": "<анализ первых 3 секунд>",
      "emotional_trigger": "<какую эмоцию использует: страх/надежда/любопытство/гордость/стыд/другое>",
      "actual_likes": <число>,
      "expected_likes": <число — сколько должно было набрать>,
      "performance_gap": "<почему не набрало — 2-3 причины>",
      "viral_potential": <число 1-10>,
      "summary": "<краткий вывод по видео>",
      "deep_analysis": {
        "sentences": [
          {
            "original": "<оригинальная фраза из транскрипции>",
            "problem": "<почему не сработало>",
            "fix": "<исправленный вариант>",
            "why_fix_works": "<почему новый вариант лучше>",
            "trigger": "<эмоциональный триггер в новом варианте>"
          }
        ],
        "outcome": "<что произойдёт если применить все исправления — рост просмотров, подписчиков, сохранений>"
      }
    }
  ],
  "executive_summary": "<3-4 предложения об аккаунте в целом>",
  "funnel_recommendations": "<что нужно изменить в соотношении TOF/MOF/BOF>",
  "top_recommendations": [
    "<рекомендация 1>",
    "<рекомендация 2>",
    "<рекомендация 3>",
    "<рекомендация 4>",
    "<рекомендация 5>"
  ]
}`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude error: ' + claudeRes.status);
    const claudeData = await claudeRes.json();
    let analysisText = claudeData.content[0].text.trim();
    analysisText = analysisText.replace(/```json/g, '').replace(/```/g, '').trim();
    const analysis = JSON.parse(analysisText);

    return res.status(200).json({
      username,
      avgLikes,
      transcribedCount,
      totalSelected: reels.length,
      transcripts: transcriptResults,
      analysis
    });

  } catch(e) {
    console.log('ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
