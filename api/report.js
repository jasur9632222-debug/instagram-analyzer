export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { runId, datasetId, username } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_KEY;

  try {
    const sRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs/${runId}?token=${APIFY_TOKEN}`);
    const sData = await sRes.json();
    const status = sData.data.status;

    if (['RUNNING', 'READY', 'ABORTING'].includes(status)) {
      return res.status(200).json({ status: 'running' });
    }
    if (['FAILED', 'ABORTED'].includes(status)) {
      return res.status(500).json({ error: 'Apify ошибка: ' + status });
    }

    const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=30`);
    const posts = await dataRes.json();
    if (!posts || posts.length === 0) throw new Error('Посты не найдены. Аккаунт приватный?');

    const profile = posts[0]?.ownerFullName || username;
    const followers = posts[0]?.ownerFollowersCount ?? '?';
    const following = posts[0]?.ownerFollowingCount ?? '?';

    async function transcribeVideo(videoUrl) {
      try {
        const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
          method: 'POST',
          headers: { 'Authorization': ASSEMBLYAI_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio_url: videoUrl, language_detection: true })
        });
        const submitData = await submitRes.json();
        if (!submitData.id) return null;
        let attempts = 0;
        while (attempts < 20) {
          await new Promise(r => setTimeout(r, 3000));
          attempts++;
          const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${submitData.id}`, {
            headers: { 'Authorization': ASSEMBLYAI_KEY }
          });
          const pollData = await pollRes.json();
          if (pollData.status === 'completed') return pollData.text;
          if (pollData.status === 'error') return null;
        }
        return null;
      } catch(e) { return null; }
    }

    const videoPosts = posts.filter(p => p.videoUrl).slice(0, 5);
    const transcriptTexts = {};
    await Promise.all(videoPosts.map(async (p, i) => {
      const text = await transcribeVideo(p.videoUrl);
      if (text) transcriptTexts[i] = text;
    }));

    const transcripts = videoPosts.map((p, i) => ({
      date: p.timestamp ? new Date(p.timestamp * 1000).toLocaleDateString('ru') : '?',
      likes: p.likesCount || 0,
      comments: p.commentsCount || 0,
      caption: (p.caption || '').slice(0, 200),
      transcript: transcriptTexts[i] || '(транскрипция недоступна)'
    }));

    const postsText = posts.map((p, i) => {
      const likes = p.likesCount ?? 0;
      const comments = p.commentsCount ?? 0;
      const caption = (p.caption || '').slice(0, 300);
      const type = p.type || (p.videoUrl ? 'Video' : 'Image');
      const date = p.timestamp ? new Date(p.timestamp * 1000).toLocaleDateString('ru') : '?';
      const videoIndex = videoPosts.findIndex(vp => vp.videoUrl === p.videoUrl);
      const transcript = videoIndex !== -1 && transcriptTexts[videoIndex]
        ? `\n🎙 ТРАНСКРИПЦИЯ: ${transcriptTexts[videoIndex].slice(0, 500)}`
        : '';
      return `[${i+1}] ${date} | ${type} | ❤️ ${likes} 💬 ${comments}\n${caption || '(без подписи)'}${transcript}`;
    }).join('\n\n---\n\n');

    const totalLikes = posts.reduce((s, p) => s + (p.likesCount || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.commentsCount || 0), 0);
    const avgLikes = Math.round(totalLikes / posts.length);
    const avgComments = Math.round(totalComments / posts.length);
    const videoCount = posts.filter(p => p.type === 'Video' || p.videoUrl).length;
    const erRate = followers !== '?' ? ((totalLikes + totalComments) / posts.length / followers * 100).toFixed(2) : '?';
    const transcribedCount = Object.keys(transcriptTexts).length;

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
          content: `Ты — Senior Content Strategist с 10+ летним опытом в digital-маркетинге и Instagram-стратегии.

Аккаунт: @${username} (${profile})
Подписчики: ${followers} | Подписки: ${following} | Постов: ${posts.length}
Транскрибировано видео: ${transcribedCount} из ${videoCount}

ДАННЫЕ ПОСТОВ (включая транскрипции видео):
${postsText}

Составь профессиональный контент-маркетинговый отчёт на русском:

## 📊 EXECUTIVE SUMMARY
3-4 предложения: кто автор, позиция на рынке, главный инсайт.

## 👤 ПОРТРЕТ АККАУНТА
- Ниша и субниша
- Ценностное предложение (UVP)
- Тон коммуникации (TOV)
- Целевая аудитория: боли и желания

## 🎙 АНАЛИЗ РЕЧИ И ПОДАЧИ (на основе транскрипций)
- Как автор говорит: темп, стиль, словарный запас
- Повторяющиеся фразы и слова-триггеры
- Как начинает видео (хук)
- Как заканчивает (call to action)
- Эмоциональные триггеры которые использует

## 📈 МЕТРИКИ И ENGAGEMENT
- ER Rate: ${erRate}% — что означает для ниши
- Какие посты взрываются и почему
- Соотношение лайков к комментариям

## 🎯 КОНТЕНТ-МИКС (в %)
Образовательный / Мотивационный / Личный / Продающий / Развлекательный

## 🔥 ТОП-3 ПОСТА — РАЗБОР
Для каждого: психологический триггер, почему зашёл, как масштабировать.

## 🚀 СТРАТЕГИЯ РОСТА (90 дней)
Месяц 1, 2, 3 — по 3 конкретных действия.

## 💡 КОНТЕНТ-ПЛАН НА НЕДЕЛЮ
7 дней с темами, форматами и хуками.

## ⚠️ КРИТИЧЕСКИЕ ЗОНЫ РОСТА
Топ-3 проблемы с конкретными решениями.

Используй данные из транскрипций для глубокого анализа речи автора.`
        }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude API ошибка: ' + claudeRes.status);
    const claudeData = await claudeRes.json();

    return res.status(200).json({
      status: 'done',
      username, profile, followers, following,
      postsCount: posts.length,
      avgLikes, avgComments, erRate, videoCount,
      transcribedCount, transcripts,
      analysis: claudeData.content[0].text
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
