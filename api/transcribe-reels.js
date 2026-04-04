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
      if (!reel || !reel.videoUrl) {
        console.log('No videoUrl for reel');
        return null;
      }

      const videoUrl = reel.videoUrl;
      console.log('Fetching video:', videoUrl.slice(0, 60));

      const videoRes = await fetch(videoUrl);
      console.log('Video status:', videoRes.status);
      if (!videoRes.ok) return null;

      const videoBuffer = await videoRes.arrayBuffer();
      console.log('Video size:', videoBuffer.byteLength);
      if (!videoBuffer || videoBuffer.byteLength < 1000) return null;

      const uint8Array = new Uint8Array(videoBuffer);
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const beforeFile =
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n' +
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
        console.log('Groq error:', err.slice(0, 200));
        return null;
      }

      const rawText = await groqRes.text();
      console.log('Raw transcript:', rawText ? rawText.slice(0, 100) : 'EMPTY');
      if (!rawText || rawText.length < 5) return null;

      // Постобработка через Claude
      const fixRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `Quyidagi matn ovozni matnga o'tkazish natijasi. O'zbek tilida aytilgan lekin boshqa turkiy tilda (qozoq, ozarbayjon yoki boshqa) transkripsiya qilingan bo'lishi mumkin.

Vazifang: Bu matnni to'g'ri o'zbek tilida yoz. So'zlarni o'zbek tiliga to'g'irla, imlo va grammatikani tuzat. Agar matn allaqachon o'zbek tilida bo'lsa, faqat imlo xatolarini tuzat. Faqat tuzatilgan matnni qaytар — hech qanday tushuntirish, izoh yoki qo'shimcha matn yo'q.

Matn:
${rawText}`
          }]
        })
      });

      if (!fixRes.ok) {
        console.log('Claude fix failed, returning raw');
        return rawText;
      }
      const fixData = await fixRes.json();
      const fixedText = fixData.content[0].text.trim();
      console.log('Fixed transcript:', fixedText ? fixedText.slice(0, 100) : 'EMPTY');
      return fixedText || rawText;

    } catch(e) {
      console.log('Transcribe error:', e.message);
      return null;
    }
  }

  try {
    console.log('Processing', reels.length, 'reels');

    // Фильтруем null и undefined
    const validReels = reels.filter(r => r && r.videoUrl);
    console.log('Valid reels with videoUrl:', validReels.length);

    const transcriptResults = await Promise.all(reels.map(async (reel, idx) => {
      if (!reel) return {
        shortCode: '', url: '', caption: '', likes: 0, comments: 0, date: '?',
        transcript: '(mavjud emas)'
      };
      console.log('Reel', idx + 1, '- videoUrl:', reel.videoUrl ? 'YES' : 'NO');
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

    const avgLikes = Math.round(reels.filter(r => r).reduce((s, r) => s + (r.likesCount || 0), 0) / reels.length);

    const reelsForClaude = transcriptResults.map((r, i) =>
      'REEL ' + (i+1) + ':\nCaption: ' + r.caption + '\nLayklar: ' + r.likes + ' | Izohlar: ' + r.comments + '\nTranskripsiya: ' + r.transcript
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
    } catch(parseErr) {
      console.log('JSON parse error:', analysisText.slice(0, 200));
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
