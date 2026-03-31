export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username, reels } = req.body;
  const OPENAI_KEY = process.env.OPENAI_KEY;
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;

  if (!reels || !reels.length) return res.status(400).json({ error: 'Reels not provided' });

  async function transcribeReel(reel) {
    try {
      const postUrl = reel.url || `https://www.instagram.com/p/${reel.shortCode}/`;

      const videoRes = await fetch(`https://instagram-downloader38.p.rapidapi.com/download?url=${encodeURIComponent(postUrl)}&strategy=largest&wait_ms=5000`, {
        headers: {
          'x-rapidapi-host': 'instagram-downloader38.p.rapidapi.com',
          'x-rapidapi-key': RAPIDAPI_KEY
        }
      });

      if (!videoRes.ok) return null;
      const videoBuffer = await videoRes.arrayBuffer();
      if (!videoBuffer || videoBuffer.byteLength < 1000) return null;

      const uint8Array = new Uint8Array(videoBuffer);
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const beforeFile = '--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="audio.mp4"\r\nContent-Type: video/mp4\r\n\r\n';
      const afterFile = '\r\n--' + boundary + '--\r\n';
      const beforeBytes = new TextEncoder().encode(beforeFile);
      const afterBytes = new TextEncoder().encode(afterFile);
      const body = new Uint8Array(beforeBytes.length + uint8Array.length + afterBytes.length);
      body.set(beforeBytes, 0);
      body.set(uint8Array, beforeBytes.length);
      body.set(afterBytes, beforeBytes.length + uint8Array.length);

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + OPENAI_KEY,
          'Content-Type': 'multipart/form-data; boundary=' + boundary
        },
        body: body
      });

      if (!whisperRes.ok) return null;
      const whisperData = await whisperRes.json();
      return whisperData.text || null;
    } catch(e) {
      return null;
    }
  }

  try {
    // Транскрибируем все выбранные рилсы параллельно
    const results = await Promise.all(reels.map(async (reel) => {
      const transcript = await transcribeReel(reel);
      return {
        date: reel.timestamp ? new Date(reel.timestamp * 1000).toLocaleDateString('ru') : '?',
        likes: reel.likesCount || 0,
        comments: reel.commentsCount || 0,
        caption: (reel.caption || '').slice(0, 200),
        transcript: transcript || '(transkripsiya muvaffaqiyatsiz)'
      };
    }));

    const transcribedCount = results.filter(r => !r.transcript.startsWith('(transkripsiya')).length;

    // Получаем данные профиля из Apify
    let followers = '?', avgLikes = '?';
    try {
      const profileRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directUrls: [`https://www.instagram.com/${username}/`],
          resultsType: 'posts',
          resultsLimit: 1,
          addParentData: true
        })
      });
      if (profileRes.ok) {
        const profileRun = await profileRes.json();
        const runId = profileRun.data.id;
        await new Promise(r => setTimeout(r, 15000));
        const dsRes = await fetch(`https://api.apify.com/v2/datasets/${profileRun.data.defaultDatasetId}/items?token=${APIFY_TOKEN}&limit=1`);
        const ds = await dsRes.json();
        if (ds && ds[0]) {
          followers = ds[0].ownerFollowersCount || '?';
          avgLikes = Math.round(reels.reduce((s, r) => s + (r.likesCount || 0), 0) / reels.length);
        }
      }
    } catch(e) {}

    // Анализ через Claude
    const transcriptText = results.map((r, i) =>
      `[${i+1}] ❤️ ${r.likes} 💬 ${r.comments}\n${r.caption}\n🎙 ${r.transcript}`
    ).join('\n\n---\n\n');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `Ты — Senior Content Strategist.
Аккаунт: @${username}
Подписчики: ${followers}
Транскрибировано: ${transcribedCount} из ${reels.length} reels

ТРАНСКРИПЦИИ REELS:
${transcriptText}

Составь профессиональный отчёт на русском:

## 📊 EXECUTIVE SUMMARY
Кто автор, о чём говорит, главный инсайт из транскрипций.

## 🎙 АНАЛИЗ РЕЧИ И ПОДАЧИ
- Стиль речи, словарный запас, темп
- Повторяющиеся фразы и триггеры
- Как начинает видео (хук)
- Как заканчивает (CTA)
- Эмоциональные триггеры

## 🎯 КОНТЕНТ-МИКС И ВОРОНКА TOF/MOF/BOF
Распредели каждый рилс по воронке и дай % соотношение.

## 🔥 САМЫЕ СИЛЬНЫЕ МОМЕНТЫ
Какие фразы и темы работают лучше всего.

## ⚠️ ЗОНЫ РОСТА
Что можно улучшить в подаче и контенте.

## 💡 РЕКОМЕНДАЦИИ
5 конкретных советов основанных на транскрипциях.`
        }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude error: ' + claudeRes.status);
    const claudeData = await claudeRes.json();

    return res.status(200).json({
      username,
      followers,
      avgLikes,
      transcribedCount,
      totalSelected: reels.length,
      transcripts: results,
      analysis: claudeData.content[0].text
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
