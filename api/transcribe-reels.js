export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username, reels } = req.body;
  const AISHA_KEY = process.env.AISHA_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  if (!reels || !reels.length) return res.status(400).json({ error: 'Reels not provided' });

  async function transcribeReel(reel) {
    try {
      if (!reel || !reel.videoUrl) return null;

      const videoRes = await fetch(reel.videoUrl);
      if (!videoRes.ok) return null;
      const videoBuffer = await videoRes.arrayBuffer();
      if (!videoBuffer || videoBuffer.byteLength < 1000) return null;

      const formData = new FormData();
      const blob = new Blob([videoBuffer], { type: 'video/mp4' });
      formData.append('audio', blob, 'audio.mp4');
      formData.append('language', 'uz');
      formData.append('has_diarization', 'false');

      const uploadRes = await fetch('https://back.aisha.group/api/v2/stt/post/', {
        method: 'POST',
        headers: { 'x-api-key': AISHA_KEY },
        body: formData
      });

      console.log('Aisha upload status:', uploadRes.status);
      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        console.log('Aisha error:', err);
        return null;
      }

      const uploadData = await uploadRes.json();
      const taskId = uploadData.id;
      console.log('Aisha task id:', taskId);

      let attempts = 0;
      while (attempts < 30) {
        await new Promise(r => setTimeout(r, 3000));
        attempts++;
        const statusRes = await fetch(`https://back.aisha.group/api/v2/stt/get/${taskId}/`, {
          headers: { 'x-api-key': AISHA_KEY }
        });
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        console.log('Aisha status:', statusData.status);
        if (statusData.status === 'SUCCESS') {
          return statusData.transcript || null;
        }
        if (statusData.status === 'FAILED') return null;
      }
      return null;
    } catch(e) {
      console.log('Transcribe error:', e.message);
      return null;
    }
  }

  try {
    console.log('Processing', reels.length, 'reels');

    const transcriptResults = await Promise.all(reels.map(async (reel, idx) => {
      if (!reel) return { shortCode:'',url:'',caption:'',likes:0,comments:0,date:'?',transcript:'(mavjud emas)' };
      console.log('Reel', idx+1, '- videoUrl:', reel.videoUrl ? 'YES' : 'NO');
      const transcript = reel.videoUrl ? await transcribeReel(reel) : null;
      return {
        shortCode: reel.shortCode || '',
        url: reel.url || '',
        caption: (reel.caption || '').slice(0, 300),
        likes: reel.likesCount || 0,
        comments: reel.commentsCount || 0,
        date: reel.timestamp ? new Date(reel.timestamp * 1000).toLocaleDateString('ru') : '?',
        transcript: transcript || '(mavjud emas)'
      };
    }));

    const transcribedCount = transcriptResults.filter(r => r.transcript !== '(mavjud emas)').length;
    console.log('Transcribed:', transcribedCount, '/', reels.length);

    const avgLikes = Math.round(reels.filter(r=>r).reduce((s,r) => s+(r.likesCount||0), 0) / reels.length);

    const reelsForClaude = transcriptResults.map((r,i) =>
      'REEL '+(i+1)+':\nCaption: '+r.caption+'\nЛайки: '+r.likes+' | Комменты: '+r.comments+'\nТранскрипция: '+r.transcript
    ).join('\n\n---\n\n');

    const prompt = `Ты — Senior Content Strategist с 10+ летним опытом в контент-стратегии и воронках продаж.

Аккаунт: @${username}
Проанализировано reels: ${reels.length}
Транскрибировано: ${transcribedCount}
Средние лайки: ${avgLikes}

ТРАНСКРИПЦИИ:
${reelsForClaude}

Верни ТОЛЬКО валидный JSON без markdown, без backticks, без пояснений. Только JSON:

{
  "funnel": {
    "tof": <число от 0 до 100>,
    "mof": <число от 0 до 100>,
    "bof": <число от 0 до 100>,
    "ideal": {"tof": 60, "mof": 30, "bof": 10},
    "verdict": "<2-3 предложения о балансе воронки на русском>",
    "niche": "<ниша автора на русском>",
    "niche_avg_er": "<средний ER в этой нише, например 2-4%>"
  },
  "missed_leads": {
    "count": <примерное число упущенных заявок>,
    "explanation": "<объяснение на русском>"
  },
  "videos": [
    {
      "index": 1,
      "funnel_type": "<TOF|MOF|BOF>",
      "hook_score": <число от 1 до 10>,
      "hook_analysis": "<анализ первых 3 секунд на русском>",
      "emotional_trigger": "<какую эмоцию использует: страх/надежда/любопытство/гордость/стыд на русском>",
      "actual_likes": <число>,
      "expected_likes": <сколько должно было набрать>,
      "performance_gap": "<почему не набрало — 2-3 причины на русском>",
      "viral_potential": <число от 1 до 10>,
      "summary": "<краткий вывод по видео на русском>",
      "deep_analysis": {
        "sentences": [
          {
            "original": "<оригинальная фраза из транскрипции>",
            "problem": "<почему не сработало на русском>",
            "fix": "<исправленный вариант на русском>",
            "why_fix_works": "<почему новый вариант лучше на русском>",
            "trigger": "<эмоциональный триггер в новом варианте на русском>"
          }
        ],
        "outcome": "<что произойдёт если применить все исправления на русском>"
      }
    }
  ],
  "executive_summary": "<3-4 предложения об аккаунте на русском>",
  "funnel_recommendations": "<что нужно изменить в TOF/MOF/BOF на русском>",
  "top_recommendations": [
    "<рекомендация 1 на русском>",
    "<рекомендация 2 на русском>",
    "<рекомендация 3 на русском>",
    "<рекомендация 4 на русском>",
    "<рекомендация 5 на русском>"
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

    let analysis;
    try {
      analysis = JSON.parse(analysisText);
    } catch(e) {
      console.log('JSON parse error:', analysisText.slice(0, 200));
      analysis = {
        funnel: { tof: 60, mof: 30, bof: 10, verdict: 'Анализ выполнен.', niche: '—', niche_avg_er: '—' },
        missed_leads: { count: 0, explanation: '—' },
        videos: [],
        executive_summary: 'Анализ завершён.',
        funnel_recommendations: '—',
        top_recommendations: []
      };
    }

    return res.status(200).json({
      username, avgLikes, transcribedCount,
      totalSelected: reels.length,
      transcripts: transcriptResults,
      analysis
    });

  } catch(e) {
    console.log('ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
