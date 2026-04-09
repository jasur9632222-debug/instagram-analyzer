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
      console.log('Aisha task id:', taskId, 'status:', uploadData.status);

      if (!taskId) return null;

      // Polling
      let attempts = 0;
      while (attempts < 25) {
        await new Promise(r => setTimeout(r, 4000));
        attempts++;

        const statusRes = await fetch(`https://back.aisha.group/api/v2/stt/get/${taskId}/`, {
          headers: { 'x-api-key': AISHA_KEY }
        });

        if (!statusRes.ok) {
          console.log('Poll error:', statusRes.status);
          continue;
        }

        const statusData = await statusRes.json();
        console.log('Aisha poll:', statusData.status, 'attempt:', attempts);

        if (statusData.status === 'SUCCESS') {
          const text = statusData.transcript || statusData.text || null;
          console.log('Transcript:', text ? text.slice(0, 80) : 'EMPTY');
          return text;
        }
        if (statusData.status === 'FAILED' || statusData.status === 'ERROR') {
          console.log('Aisha failed');
          return null;
        }
      }

      console.log('Aisha timeout');
      return null;
    } catch(e) {
      console.log('Transcribe error:', e.message);
      return null;
    }
  }

  async function processBatch(batch) {
    return Promise.all(batch.map(async (reel) => {
      if (!reel) return { shortCode:'',url:'',caption:'',likes:0,comments:0,date:'?',transcript:'(mavjud emas)' };
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
  }

  try {
    console.log('Total reels:', reels.length);

    const batchSize = 5;
    const batches = [];
    for (let i = 0; i < reels.length; i += batchSize) {
      batches.push(reels.slice(i, i + batchSize));
    }
    console.log('Batches:', batches.length);

    const transcriptResults = [];
    for (let i = 0; i < batches.length; i++) {
      console.log('Processing batch', i+1, '/', batches.length);
      const batchResults = await processBatch(batches[i]);
      transcriptResults.push(...batchResults);
    }

    const transcribedCount = transcriptResults.filter(r => r.transcript !== '(mavjud emas)').length;
    console.log('Transcribed:', transcribedCount, '/', reels.length);

    const avgLikes = Math.round(reels.filter(r=>r).reduce((s,r) => s+(r.likesCount||0), 0) / reels.length);

    const reelsForClaude = transcriptResults.map((r,i) =>
      'REEL '+(i+1)+':\nCaption: '+r.caption+'\nЛайки: '+r.likes+' | Комменты: '+r.comments+'\nТранскрипция: '+r.transcript
    ).join('\n\n---\n\n');

    const prompt = `Ты — Senior Content Strategist с 10+ летним опытом.

Аккаунт: @${username}
Проанализировано reels: ${reels.length}
Транскрибировано: ${transcribedCount}
Средние лайки: ${avgLikes}

ТРАНСКРИПЦИИ:
${reelsForClaude}

Верни ТОЛЬКО валидный JSON без markdown:

{
  "funnel": {
    "tof": <число 0-100>,
    "mof": <число 0-100>,
    "bof": <число 0-100>,
    "ideal": {"tof": 60, "mof": 30, "bof": 10},
    "verdict": "<2-3 предложения о балансе воронки>",
    "niche": "<ниша автора>",
    "niche_avg_er": "<средний ER в нише>"
  },
  "missed_leads": {
    "count": <число упущенных заявок>,
    "explanation": "<объяснение>"
  },
  "videos": [
    {
      "index": 1,
      "funnel_type": "<TOF|MOF|BOF>",
      "hook_score": <1-10>,
      "hook_analysis": "<анализ первых 3 секунд>",
      "emotional_trigger": "<эмоция: страх/надежда/любопытство/гордость/стыд>",
      "actual_likes": <число>,
      "expected_likes": <число>,
      "performance_gap": "<почему не набрало — 2-3 причины>",
      "viral_potential": <1-10>,
      "summary": "<краткий вывод>",
      "deep_analysis": {
        "sentences": [
          {
            "original": "<оригинальная фраза>",
            "problem": "<почему не сработало>",
            "fix": "<исправленный вариант>",
            "why_fix_works": "<почему лучше>",
            "trigger": "<эмоциональный триггер>"
          }
        ],
        "outcome": "<что произойдёт если применить исправления>"
      }
    }
  ],
  "executive_summary": "<3-4 предложения об аккаунте>",
  "funnel_recommendations": "<что изменить в TOF/MOF/BOF>",
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
