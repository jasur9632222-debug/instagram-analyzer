export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { runId, datasetId, username } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  try {
    const sRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs/${runId}?token=${APIFY_TOKEN}`);
    const sData = await sRes.json();
    const status = sData.data.status;

    if (['RUNNING', 'READY', 'ABORTING'].includes(status)) {
      return res.status(200).json({ status: 'running' });
    }
    if (['FAILED', 'ABORTED'].includes(status)) {
      return res.status(500).json({ error: 'Apify error: ' + status });
    }

    const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=50`);
    const posts = await dataRes.json();
    if (!posts || posts.length === 0) throw new Error('Посты не найдены');

    const profile = posts[0]?.ownerFullName || username;
    const followers = posts[0]?.ownerFollowersCount ?? null;
    const following = posts[0]?.ownerFollowingCount ?? null;
    const totalLikes = posts.reduce((s, p) => s + (p.likesCount || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.commentsCount || 0), 0);
    const avgLikes = Math.round(totalLikes / posts.length);
    const avgComments = Math.round(totalComments / posts.length);
    const videoCount = posts.filter(p => p.type === 'Video' || p.videoUrl).length;
    const erRate = followers ? ((totalLikes + totalComments) / posts.length / followers * 100).toFixed(2) : null;

    const postsText = posts.map((p, i) => {
      const likes = p.likesCount ?? 0;
      const comments = p.commentsCount ?? 0;
      const caption = (p.caption || '').slice(0, 300);
      const type = p.type || (p.videoUrl ? 'Video' : 'Image');
      const date = p.timestamp ? new Date(p.timestamp * 1000).toLocaleDateString('ru') : '?';
      return `[${i+1}] ${date} | ${type} | ❤️ ${likes} 💬 ${comments}\n${caption || '(без подписи)'}`;
    }).join('\n\n---\n\n');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Ты — Senior Content Strategist. Верни ТОЛЬКО валидный JSON без лишнего текста.

Аккаунт: @${username} (${profile})
Подписчики: ${followers || '?'} | Постов: ${posts.length}
Средние лайки: ${avgLikes} | ER Rate: ${erRate || '?'}%

ПОСТЫ:
${postsText}

Верни JSON в таком формате:
{
  "executive_summary": "Краткий инсайт об аккаунте (2-3 предложения)",
  "account_portrait": "Ниша, ЦА, УТП, TOV",
  "metrics_analysis": "Анализ ER Rate, лайков, комментариев",
  "funnel": {
    "tof": "% и описание TOF постов",
    "mof": "% и описание MOF постов",
    "bof": "% и описание BOF постов",
    "recommendation": "Что нужно изменить"
  },
  "top_posts": [
    {"rank": 1, "description": "Описание поста", "reason": "Почему сработал"},
    {"rank": 2, "description": "Описание поста", "reason": "Почему сработал"},
    {"rank": 3, "description": "Описание поста", "reason": "Почему сработал"}
  ],
  "growth_zones": "Критические зоны роста",
  "strategy_90_days": "Стратегия на 90 дней",
  "content_plan": [
    {"day": "Пн", "idea": "Идея поста"},
    {"day": "Вт", "idea": "Идея поста"},
    {"day": "Ср", "idea": "Идея поста"},
    {"day": "Чт", "idea": "Идея поста"},
    {"day": "Пт", "idea": "Идея поста"},
    {"day": "Сб", "idea": "Идея поста"},
    {"day": "Вс", "idea": "Идея поста"}
  ]
}`
        }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude error: ' + claudeRes.status);
    const claudeData = await claudeRes.json();

    // Парсим JSON из ответа Claude
    let analysisJson;
    try {
      const rawText = claudeData.content[0].text;
      // Убираем ```json ``` если Claude добавил
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysisJson = JSON.parse(cleaned);
    } catch (parseErr) {
      // Если не JSON — возвращаем как текст в executive_summary
      analysisJson = {
        executive_summary: claudeData.content[0].text,
        account_portrait: '',
        metrics_analysis: '',
        funnel: { tof: '', mof: '', bof: '', recommendation: '' },
        top_posts: [],
        growth_zones: '',
        strategy_90_days: '',
        content_plan: []
      };
    }

    return res.status(200).json({
      status: 'done',
      username,
      profile,
      followers: followers ?? '?',
      following: following ?? '?',
      postsCount: posts.length,
      avgLikes,
      avgComments,
      erRate: erRate || '?',
      videoCount,
      // Теперь все поля доступны напрямую:
      ...analysisJson,
      // И старый формат тоже работает:
      analysis: Object.values(analysisJson).join('\n\n')
    });

  } catch(e) {
    console.log('ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
