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

      // Скачиваем видео
      const videoRes = await fetch(reel.videoUrl);
      if (!videoRes.ok) return null;
      const videoBuffer = await videoRes.arrayBuffer();
      if (!videoBuffer || videoBuffer.byteLength < 1000) return null;

      // Отправляем в Aisha STT
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

      // Polling — ждём результат
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
          console.log('Transcript:', statusData.transcript ? statusData.transcript.slice(0, 100) : 'EMPTY');
          return statusData.transcript || null;
        }

        if (statusData.status === 'FAILED') {
          console.log('Aisha failed');
          return null;
        }
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
      'REEL '+(i+1)+':\nCaption: '+r.caption+'\nLayklar: '+r.likes+' | Izohlar: '+r.comments+'\nTranskripsiya: '+r.transcript
    ).join('\n\n---\n\n');

    const prompt = `Siz — Instagram kontent strategiyasi bo'yicha 10+ yillik tajribaga ega Senior Content Strategist siz.

Hisob: @${username}
Tahlil qilingan reels: ${reels.length}
Transkripsiya qilingan: ${transcribedCount}
O'rtacha layk: ${avgLikes}

TRANSKRIPSIYALAR:
${reelsForClaude}

FAQAT to'g'ri JSON qaytaring. Markdown yo'q, tushuntirish yo'q. Faqat JSON:

{
  "funnel": {
    "tof": <0 dan 100 gacha son>,
    "mof": <0 dan 100 gacha son>,
    "bof": <0 dan 100 gacha son>,
    "ideal": {"tof": 60, "mof": 30, "bof": 10},
    "verdict": "<voronka balansi haqida 2-3 gap O'zbek tilida>",
    "niche": "<muallifning nishasi O'zbek tilida>",
    "niche_avg_er": "<bu nishadagi o'rtacha ER, masalan 2-4%>"
  },
  "missed_leads": {
    "count": <taxminiy yo'qotilgan so'rovlar soni>,
    "explanation": "<qanday hisoblanganligi O'zbek tilida>"
  },
  "videos": [
    {
      "index": 1,
      "funnel_type": "<TOF|MOF|BOF>",
      "hook_score": <1 dan 10 gacha son>,
      "hook_analysis": "<dastlabki 3 soniya tahlili O'zbek tilida>",
      "emotional_trigger": "<qaysi hissiyotni ishlatadi O'zbek tilida>",
      "actual_likes": <son>,
      "expected_likes": <nechta bo'lishi kerak edi>,
      "performance_gap": "<nima uchun ko'p to'planmadi O'zbek tilida>",
      "viral_potential": <1 dan 10 gacha son>,
      "summary": "<video haqida qisqacha xulosa O'zbek tilida>",
      "deep_analysis": {
        "sentences": [
          {
            "original": "<transkripsiyadan original ibora>",
            "problem": "<nima uchun ishlamadi O'zbek tilida>",
            "fix": "<tuzatilgan variant O'zbek tilida>",
            "why_fix_works": "<nima uchun yangi variant yaxshiroq O'zbek tilida>",
            "trigger": "<yangi variantdagi hissiy trigger O'zbek tilida>"
          }
        ],
        "outcome": "<barcha tuzatishlar qo'llanilsa nima bo'ladi O'zbek tilida>"
      }
    }
  ],
  "executive_summary": "<umuman hisob haqida 3-4 gap O'zbek tilida>",
  "funnel_recommendations": "<TOF/MOF/BOF nisbatini o'zgartirish bo'yicha tavsiya O'zbek tilida>",
  "top_recommendations": [
    "<1-tavsiya O'zbek tilida>",
    "<2-tavsiya O'zbek tilida>",
    "<3-tavsiya O'zbek tilida>",
    "<4-tavsiya O'zbek tilida>",
    "<5-tavsiya O'zbek tilida>"
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
      analysis = {
        funnel: { tof: 60, mof: 30, bof: 10, verdict: 'Tahlil qilinmoqda...', niche: '—', niche_avg_er: '—' },
        missed_leads: { count: 0, explanation: '—' },
        videos: [],
        executive_summary: 'Tahlil yakunlandi.',
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
