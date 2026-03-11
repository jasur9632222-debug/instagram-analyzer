export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  if (!username) return res.status(400).json({ error: 'Username required' });

  try {
    // 1. Запускаем Apify
    const runRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: 'posts',
        resultsLimit: 30,
        addParentData: true
      })
    });

    if (!runRes.ok) throw new Error('Apify запуск не удался: ' + runRes.status);

    const runData = await runRes.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    // 2. Ждём завершения
    let status = 'RUNNING';
    let attempts = 0;
    while (['RUNNING', 'READY', 'ABORTING'].includes(status)) {
      await new Promise(r => setTimeout(r, 6000));
      attempts++;
      if (attempts > 70) throw new Error('Timeout: Apify не ответил за 7 минут');
      const sRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs/${runId}?token=${APIFY_TOKEN}`);
      const sData = await sRes.json();
      status = sData.data.status;
      if (['FAILED', 'ABORTED'].includes(status)) throw new Error('Apify завершился с ошибкой: ' + status);
    }

    // 3. Получаем данные
    const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=30`);
    const posts = await dataRes.json();

    if (!posts || posts.length === 0) throw new Error('Посты не найдены. Аккаунт приватный?');

    // 4. Готовим данные для Claude
    const profile = posts[0]?.ownerFullName || username;
    const followers = posts[0]?.ownerFollowersCount ?? '?';
    const following = posts[0]?.ownerFollowingCount ?? '?';

    const postsText = posts.slice(0, 25).map((p, i) => {
      const likes = p.likesCount ?? 0;
      const comments = p.commentsCount ?? 0;
      const caption = (p.caption || '').slice(0, 400);
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

    // 5. Отправляем в Claude
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
          content: `Ты — эксперт по анализу Instagram контента и контент-стратегии.

Проанализируй Instagram аккаунт @${username}.
Полное имя: ${profile}
Подписчики: ${followers} | Подписки: ${following}
Постов собрано: ${posts.length}

ДАННЫЕ ПОСТОВ:
${postsText}

Напиши детальный профессиональный отчёт на русском языке:

1. ОБЩАЯ ХАРАКТЕРИСТИКА АККАУНТА
2. КОНТЕНТ-СТРАТЕГИЯ
3. ЧТО ЗАХОДИТ ЛУЧШЕ ВСЕГО
4. ТЕМАТИКА И КЛЮЧЕВЫЕ ТЕМЫ
5. СИЛЬНЫЕ СТОРОНЫ
6. ЗОНЫ РОСТА
7. КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ (5 советов)

Используй конкретные данные из постов.`
        }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude API ошибка: ' + claudeRes.status);

    const claudeData = await claudeRes.json();
    const analysis = claudeData.content[0].text;

    return res.status(200).json({
      success: true,
      username,
      profile,
      followers,
      following,
      postsCount: posts.length,
      avgLikes,
      avgComments,
      erRate,
      videoCount,
      analysis
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
