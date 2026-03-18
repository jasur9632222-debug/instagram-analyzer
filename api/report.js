export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { runId, datasetId, username } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const OPENAI_KEY = process.env.OPENAI_KEY;
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

  try {
    const sRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs/${runId}?token=${APIFY_TOKEN}`);
    const sData = await sRes.json();
    const status = sData.data.status;
    console.log('Apify status:', status);

    if (['RUNNING', 'READY', 'ABORTING'].includes(status)) {
      return res.status(200).json({ status: 'running' });
    }
    if (['FAILED', 'ABORTED'].includes(status)) {
      return res.status(500).json({ error: 'Apify ошибка: ' + status });
    }

    const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=50`);
    const posts = await dataRes.json();
    console.log('Posts count:', posts?.length);
    if (!posts || posts.length === 0) throw new Error('Посты не найдены');

    const profile = posts[0]?.ownerFullName || username;
    const followers = posts[0]?.ownerFollowersCount ?? '?';
    const following = posts[0]?.ownerFollowingCount ?? '?';

    // Логируем структуру первого поста
    const firstPost = posts[0] || {};
    console.log('Post keys:', Object.keys(firstPost).join(','));
    console.log('Post type:', firstPost.type, '| isVideo:', firstPost.isVideo, '| hasVideoUrl:', !!firstPost.videoUrl);

    async function transcribePost(post) {
      try {
        const postUrl = post.url || `https://www.instagram.com/p/${post.shortCode}/`;
        console.log('Transcribing:', postUrl);

        const videoRes = await fetch(`https://instagram-downloader38.p.rapidapi.com/download?url=${encodeURIComponent(postUrl)}&strategy=largest&wait_ms=5000`, {
          headers: {
            'x-rapidapi-host': 'instagram-downloader38.p.rapidapi.com',
            'x-rapidapi-key': RAPIDAPI_KEY
          }
        });

        console.log('RapidAPI status:', videoRes.status);
        if (!videoRes.ok) return null;

        const videoBuffer = await videoRes.arrayBuffer();
        console.log('Video size:', videoBuffer.byteLength);
        if (!videoBuffer || videoBuffer.byteLength < 1000) return null;

        const formData = new FormData();
        const blob = new Blob([videoBuffer], { type: 'video/mp4' });
        formData.append('file', blob, 'video.mp4');
        formData.append('model', 'whisper-1');
        formData.append('language', 'uz');

        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + OPENAI_KEY },
          body: formData
        });

        console.log('Whisper status:', whisperRes.status);
        if (!whisperRes.ok) return null;
        const whisperData = await whisperRes.json();
        console.log('Transcript length:', whisperData.text?.length);
        return whisperData.text || null;
      } catch(e) {
        console.log('Transcribe error:', e.message);
        return null;
      }
    }

    const videoPosts = posts.filter(p => p.videoUrl || p.type === 'Video' || p.isVideo).slice(0, 3);
    console.log('Video posts:', videoPosts.length);

    const transcriptTexts = {};
    await Promise.all(videoPosts.map(async (p, i) => {
      const text = await transcribePost(p);
      if (text) transcriptTexts[i] = text;
    }));

    console.log('Transcribed:', Object.keys(transcriptTexts).length);

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
      const videoIndex = videoPosts.findIndex(vp => vp.shortCode === p.shortCode);
      const transcript = videoIndex !== -1 && transcriptTexts[videoIndex]
        ? `\n🎙 ТРАНСКРИПЦИЯ: ${transcriptTexts[videoIndex].slice(0, 600)}`
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
          content: `Ты — Senior Content Strategist.
Аккаунт: @${username} (${profile})
Подписчики: ${followers} | Постов: ${posts.length}
Транскрибировано: ${transcribedCount} видео

ПОСТЫ:
${postsText}

Отчёт на русском:
## 📊 EXECUTIVE SUMMARY
## 👤 ПОРТРЕТ АККАУНТА
## 🎙 АНАЛИЗ РЕЧИ (из транскрипций)
## 📈 МЕТРИКИ И ENGAGEMENT
## 🎯 КОНТЕНТ-МИКС И ВОРОНКА TOF/MOF/BOF
## 🔥 ТОП-3 ПОСТА
## 🚀 СТРАТЕГИЯ РОСТА 90 дней
## 💡 КОНТЕНТ-ПЛАН НА НЕДЕЛЮ
## ⚠️ КРИТИЧЕСКИЕ ЗОНЫ РОСТА`
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
    console.log('ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
