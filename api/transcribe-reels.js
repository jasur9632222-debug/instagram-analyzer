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
      console.log('videoUrl:', videoUrl ? videoUrl.slice(0,50) : 'NONE');
      if (!videoUrl) return null;

      const videoRes = await fetch(videoUrl);
      console.log('video fetch status:', videoRes.status);
      if (!videoRes.ok) return null;

      const videoBuffer = await videoRes.arrayBuffer();
      console.log('video size:', videoBuffer.byteLength);
      if (!videoBuffer || videoBuffer.byteLength < 1000) return null;

      const uint8Array = new Uint8Array(videoBuffer);
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

      const beforeFile = '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="language"\r\n\r\nuz\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="prompt"\r\n\r\nShu audio O\'zbek tilida. Iltimos O\'zbek tilida transkripsiya qiling.\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="file"; filename="audio.mp4"\r\nContent-Type: video/mp4\r\n\r\n';

      const afterFile = '\r\n--' + boundary + '--\r\n';

      const beforeBytes = new TextEncoder().encode(beforeFile);
      const afterBytes = new TextEncoder().encode(afterFile);
      const body = new Uint8Array(beforeBytes.length + uint8Array.length + afterBytes.length);
      body.set(beforeBytes, 0);
      body.set(uint8Array, beforeBytes.length);
      body.set(afterBytes, beforeBytes.length + uint8Array.length);

      const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + GROQ_KEY,
          'Content-Type': 'multipart/form-data; boundary=' + boundary
        },
        body: body
      });

      console.log('Groq status:', groqRes.status);
      if (!groqRes.ok) {
        const err = await groqRes.text();
        console.log('Groq error:', err);
        return null;
      }
      const text = await groqRes.text();
      console.log('Transcript length:', text?.length);
      return text || null;
    } catch(e) {
      console.log('Transcribe error:', e.message);
      return null;
    }
  }

  try {
    console.log('Reels count:', reels.length);
    console.log('First reel videoUrl:', reels[0]?.videoUrl ? reels[0].videoUrl.slice(0,50) : 'NONE');

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
    console.log('Transcribed:', transcribedCount, '/', reels.length);

    const transcriptText = results.map((r, i) =>
      '[' + (i+1) + '] ❤️ ' + r.likes + ' 💬 ' + r.comments + '\n' + r.caption + '\n🎙 ' + r.transcript
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
          content: 'Ты — Senior Content Strategist.\nАккаунт: @' + username + '\nТранскрибировано: ' + transcribedCount + ' из ' + reels.length + ' reels\n\nТРАНСКРИПЦИИ REELS (на узбекском):\n' + transcriptText + '\n\nСоставь профессиональный отчёт на русском:\n\n## 📊 EXECUTIVE SUMMARY\nКто автор, о чём говорит, главный инсайт из транскрипций.\n\n## 🎙 АНАЛИЗ РЕЧИ И ПОДАЧИ\n- Стиль речи, словарный запас, темп\n- Повторяющиеся фразы и триггеры\n- Как начинает видео (хук)\n- Как заканчивает (CTA)\n\n## 🎯 КОНТЕНТ-МИКС И ВОРОНКА TOF/MOF/BOF\nРаспредели каждый рилс по воронке и дай % соотношение.\n\n## 🔥 САМЫЕ СИЛЬНЫЕ МОМЕНТЫ\nКакие фразы и темы работают лучше всего.\n\n## ⚠️ ЗОНЫ РОСТА\nЧто можно улучшить в подаче и контенте.\n\n## 💡 РЕКОМЕНДАЦИИ\n5 конкретных советов основанных на транскрипциях.'
        }]
      })
    });

    if (!claudeRes.ok) throw new Error('Claude error: ' + claudeRes.status);
    const claudeData = await claudeRes.json();

    return res.status(200).json({
      username,
      followers: '?',
      avgLikes: Math.round(reels.reduce((s, r) => s + (r.likesCount || 0), 0) / reels.length),
      transcribedCount,
      totalSelected: reels.length,
      transcripts: results,
      analysis: claudeData.content[0].text
    });

  } catch(e) {
    console.log('ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
