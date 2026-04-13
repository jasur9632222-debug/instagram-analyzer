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
    console.log('Apify status:', status);

    if (['RUNNING', 'READY', 'ABORTING'].includes(status)) {
      return res.status(200).json({ status: 'running' });
    }
    if (['FAILED', 'ABORTED'].includes(status)) {
      return res.status(500).json({ error: 'Apify error: ' + status });
    }

    const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=50`);
    const posts = await dataRes.json();
    console.log('Posts count:', posts?.length);
    if (!posts || posts.length === 0) throw new Error('Посты не найдены');

    const profile = posts[0]?.ownerFullName || username;
    const followers = posts[0]?.ownerFollowersCount !== undefined ? posts[0].ownerFollowersCount : null;
    const following = posts[0]?.ownerFollowingCount !== undefined ? posts[0].ownerFollowingCount : null;

    console.log('followers raw:', followers);

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
      return '[' + (i+1) + '] ' + date + ' | ' + type + ' | ❤️ ' + likes + ' 💬 ' + comments + '\n' + (caption || '(без подписи)');
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
          content: `Ты — Senior Content Strategist.
Аккаунт: @${username} (${profile})
Подписчики: ${followers || '?'} | Постов: ${posts.length}
Средние лайки: ${avgLikes} | ER Rate: ${erRate || '?'}%

ПОСТЫ:
${postsText}

Составь подробный отчёт на русском языке в виде обычного текста (не JSON):

## 📊 EXECUTIVE SUMMARY
Кто автор, ниша, позиция на рынке, главный инсайт.

## 👤 ПОРТРЕТ АККАУНТА
Ниша, целевая аудитория, УТП, TOV (tone of voice).

## 📈 МЕТРИКИ И ENGAGEMENT
Анализ ER Rate, средних лайков, комментариев. Сравнение с нишей.

## 🎯 КОНТЕНТ-МИКС И ВОРОНКА TOF/MOF/BOF
Распредели посты по воронке. Какой % TOF/MOF/BOF. Что нужно изменить.

## 🔥 ТОП-3 ПОСТА
Какие посты сработали лучше всего и почему.

## ⚠️ КРИТИЧЕСКИЕ ЗОНЫ РОСТА
Что мешает росту прямо сейчас.

## 🚀 СТРАТЕГИЯ РОСТА НА 90 ДНЕЙ
Конкретный план действий по дням.

## 💡 КОНТЕНТ-ПЛАН НА НЕДЕЛЮ
7 конкретных идей для постов с описанием.`
        }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude error: ' + claudeRes.status);
    const claudeData = await claudeRes.json();
    const analysisText = claudeData.content[0].text;

    return res.status(200).json({
      status: 'done',
      username,
      profile,
      followers: followers !== null ? followers : '?',
      following: following !== null ? following : '?',
      postsCount: posts.length,
      avgLikes,
      avgComments,
      erRate: erRate || '?',
      videoCount,
      analysis: analysisText, // ← простой текст, не объект
    });

  } catch(e) {
    console.log('ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
