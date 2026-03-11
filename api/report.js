export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { runId, datasetId, username } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  try {
    // Проверяем статус
    const sRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs/${runId}?token=${APIFY_TOKEN}`);
    const sData = await sRes.json();
    const status = sData.data.status;

    if (['RUNNING', 'READY', 'ABORTING'].includes(status)) {
      return res.status(200).json({ status: 'running' });
    }

    if (['FAILED', 'ABORTED'].includes(status)) {
      return res.status(500).json({ error: 'Apify ошибка: ' + status });
    }

    // Готово — забираем данные
    const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=30`);
    const posts = await dataRes.json();

    if (!posts || posts.length === 0) throw new Error('Посты не найдены. Аккаунт приватный?');

    const profile = posts[0]?.ownerFullName || username;
    const followers = posts[0]?.ownerFollowersCount ?? '?';
    const following = posts[0]?.ownerFollowingCount ?? '?';

    const postsText = posts.map((p, i) => {
      const likes = p.likesCount ?? 0;
      const comments = p.commentsCount ?? 0;
      const caption = (p.caption || '').slice(0, 300);
      const type = p.type || (p.videoUrl ? 'Video' : 'Image');
      const date = p.timestamp ? new Date(p.timestamp * 1000).toLocaleDateString('ru') : '?';
      return `[${i+1}] ${date} | ${type} | ❤️ ${likes} 💬 ${comments}\n${caption || '(без подписи)'}`;
    }).join('\n\n---\n\n');

    const totalLikes = posts.reduce((s, p) => s + (p.likesCount || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.commentsCount || 0), 0);
    const avgLikes = Math.round(totalLikes / posts.length);
    const avgComments = Math.round(totalComments / posts.length);
    const videoCount = posts.filter(p => p.type === 'Video' || p.videoUrl).length;
    const erRate = followers !== '?' ? ((totalLikes + totalComments) / posts.length / followers * 100).toFixed(2) : '?';

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: `Ты — эксперт по анализу Instagram контента.

Аккаунт: @${username} (${profile})
Подписчики: ${followers} | Подписки: ${following}
Постов собрано: ${posts.length}

ПОСТЫ:
${postsText}

Напиши детальный отчёт на русском:
1. ОБЩАЯ ХАРАКТЕРИСТИКА АККАУНТА
2. КОНТЕНТ-СТРАТЕГИЯ
3. ЧТО ЗАХОДИТ ЛУЧШЕ ВСЕГО
4. ОСНОВНЫЕ ТЕМЫ
5. СИЛЬНЫЕ СТОРОНЫ
6. ЗОНЫ РОСТА
7. РЕКОМЕНДАЦИИ (5 конкретных советов)

Используй данные из постов.`
        }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude API ошибка: ' + claudeRes.status);
    const claudeData = await claudeRes.json();
    const analysis = claudeData.content[0].text;

    return res.status(200).json({
      status: 'done',
      username, profile, followers, following,
      postsCount: posts.length,
      avgLikes, avgComments, erRate, videoCount,
      analysis
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
