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
      console.log('videoUrl:', videoUrl ? 'YES' : 'NO');
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

      console.log('groq status:', groqRes.status);
      if (!groqRes.ok) {
        const err = await groqRes.text();
        console.log('groq error:', err);
        return null;
      }

      const rawText = await groqRes.text();
      console.log('raw transcript length:', rawText ? rawText.length : 0);
      if (!rawText || rawText.length < 5) return null;

      // Постобработка через Claude — исправляем на узбекский
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
            content: 'Quyidagi matn ovozni matnga o\'tkazish natijasi. O\'zbek tilida aytilgan lekin boshqa tilda transkripsiya qilingan bo\'lishi mumkin.\n\nVazifang: Bu matnni to\'g\'ri o\'zbek tilida yoz. So\'zlarni to\'g\'irla, grammatikani tuzat. Faqat matnni qaytар, hech qanday tushuntirish yo\'q.\n\nMatn:\n' + rawText
          }]
        })
      });

      if (!fixRes.ok) return rawText;
      const fixData = await fixRes.json();
      const fixedText = fixData.content[0].text;
      console.log('fixed transcript length:', fixedText ? fixedText.length : 0);
      return fixedText || rawText;

    } catch(e) {
      console.log('transcribe error:', e.message);
      return null;
    }
  }

  try {
    console.log('total reels:', reels.length);

    const transcriptResults = await Promise.all(reels.map(async (reel, idx) => {
      console.log('processing reel', idx + 1, 'videoUrl:', reel.videoUrl ? reel.videoUrl.slice(0, 50) : 'NONE');
      const transcript = await transcribeReel(reel);
      return {
        shortCode: reel.shortCode,
        url: reel.url,
        caption: (reel.caption || '').slice(0, 300),
        likes: reel.likesCount || 0,
        comments: reel.commentsCount || 0,
        date: reel.timestamp ? new Date(reel.timestamp * 1000).toLocaleDateString('ru') : '?',
        transcript: transcript || '(mavjud emas)'
      };
    }));

    const transcribedCount = transcriptResults.filter(r => r.transcript !== '(mavjud emas)').length;
    console.log('transcribed:', transcribedCount, '/', reels.length);

    const avgLikes = Math.round(reels.reduce((s, r) => s + (r.likesCount || 0), 0) / reels.length);

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
    const analysis = JSON.parse(analysisText);

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
