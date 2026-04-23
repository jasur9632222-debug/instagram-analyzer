export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username, reels } = req.body;
  if (!reels || !reels.length) return res.status(400).json({ error: 'Reels required' });

  const OPENAI_KEY = process.env.OPENAI_KEY;
  const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

  async function downloadVideo(url) {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) throw new Error('Download ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  }

  async function whisper(buf, name) {
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'video/mp4' }), name);
    form.append('model', 'whisper-1');
    form.append('language', 'uz');
    form.append('response_format', 'text');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY },
      body: form,
      signal: AbortSignal.timeout(60000)
    });
    if (!r.ok) throw new Error('Whisper ' + r.status + ': ' + (await r.text()).slice(0, 100));
    return (await r.text()).trim();
  }

  async function deepgram(buf) {
    const r = await fetch('https://api.deepgram.com/v1/listen?language=ru&punctuate=true', {
      method: 'POST',
      headers: { 'Authorization': 'Token ' + DEEPGRAM_KEY, 'Content-Type': 'video/mp4' },
      body: buf,
      signal: AbortSignal.timeout(60000)
    });
    if (!r.ok) throw new Error('Deepgram ' + r.status);
    const d = await r.json();
    return d?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  }

  async function transcribeOne(reel, i) {
    if (!reel.videoUrl) {
      return { ...reel, transcript: "(video yo'q)", source: 'none', index: i };
    }
    try {
      const buf = await downloadVideo(reel.videoUrl);
      const text = await whisper(buf, 'r' + i + '.mp4');
      return { ...reel, transcript: text || "(bo'sh)", source: 'whisper(uz)', index: i };
    } catch (e1) {
      console.log('[whisper ' + i + ']', e1.message);
      try {
        const buf = await downloadVideo(reel.videoUrl);
        const text = await deepgram(buf);
        return { ...reel, transcript: text || "(bo'sh)", source: 'deepgram', index: i };
      } catch (e2) {
        console.log('[deepgram ' + i + ']', e2.message);
        return { ...reel, transcript: '(transkripsiya xatosi)', source: 'error', index: i };
      }
    }
  }

  async function withConcurrency(fns, limit) {
    const results = new Array(fns.length);
    let next = 0;
    async function worker() {
      while (next < fns.length) {
        const i = next++;
        try { results[i] = await fns[i](); }
        catch (e) { results[i] = null; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
    return results;
  }

  try {
    const fns = reels.map((r, i) => () => transcribeOne(r, i));
    const transcripts = await withConcurrency(fns, 5);

    const ok = t => t && t.source !== 'error' && t.source !== 'none' && !t.transcript.includes('xatosi') && !t.transcript.includes("yo'q");
    const transcribedCount = transcripts.filter(ok).length;
    const avgLikes = reels.length ? Math.round(reels.reduce((s, r) => s + (r.likesCount || 0), 0) / reels.length) : 0;

    const reelsText = transcripts.map((t, i) => {
      if (!t) return `[REEL ${i + 1}] — ma'lumot yo'q`;
      return [
        `[REEL ${i + 1}]`,
        `Layk: ${t.likesCount || 0} | Izoh: ${t.commentsCount || 0}`,
        `Sarlavha: ${(t.caption || '').slice(0, 150)}`,
        `Transkripsiya (${t.source}): ${t.transcript || '(mavjud emas)'}`
      ].join('\n');
    }).join('\n---\n');

    const n = reels.length;

    const prompt = `Sen Instagram marketing mutaxassisi va kontent strategistisan. Barcha javoblarni O'ZBEK tilida ber.

Akkaunt: @${username}
Reels soni: ${n} ta | O'rtacha layk: ${avgLikes}

REELS MA'LUMOTLARI:
${reelsText}

Quyidagi JSON formatida to'liq tahlil yoz. MUHIM: faqat JSON qaytir, hech qanday izoh yoki markdown yo'q.

{
  "executive_summary": "Akkaunning umumiy tahlili va baholash (3-5 jumla). Asosiy kuchli va zaif tomonlar. Eng muhim topilmalar.",
  "account_analysis": {
    "content_style": "Kontent uslubi va yo'nalishi tavsifi",
    "main_topics": ["asosiy mavzu 1", "mavzu 2", "mavzu 3"],
    "strengths": ["akkaunning kuchli tomoni 1", "kuchli tomon 2", "kuchli tomon 3"],
    "weaknesses": ["zaif tomon 1", "zaif tomon 2", "zaif tomon 3"]
  },
  "funnel": {
    "tof": 50,
    "mof": 30,
    "bof": 20,
    "niche_avg_er": "3-5%",
    "verdict": "Voronka tahlili — hozirgi holat, nima yaxshi, nima muammo",
    "funnel_recommendations": "Voronkani muvozanatlash uchun aniq tavsiyalar"
  },
  "missed_leads": {
    "count": 200,
    "explanation": "Nima sababdan bu potensial mijozlar yo'qoldi"
  },
  "videos": [
    {
      "index": 0,
      "funnel_type": "TOF",
      "hook_score": 8,
      "viral_potential": 7,
      "pros": ["kuchli tomon 1", "kuchli tomon 2"],
      "cons": ["zaif tomon 1", "zaif tomon 2"],
      "hook_analysis": "Hook qanchalik kuchli va nima uchun — 1-2 jumla",
      "emotional_trigger": "Asosiy his-tuyg'u triggeri",
      "performance_gap": "Nega kutilganidan kam yoki ko'p layk oldi",
      "expected_likes": 5000,
      "summary": "Reel haqida 1-2 jumla xulosa",
      "recommendations": ["bu reelni yaxshilash uchun tavsiya 1", "tavsiya 2"]
    }
  ],
  "top_recommendations": [
    "1-eng muhim tavsiya",
    "2-tavsiya",
    "3-tavsiya",
    "4-tavsiya",
    "5-tavsiya"
  ]
}

QOIDALAR:
- videos massivida AYNAN ${n} ta element bo'lsin (index 0 dan ${n - 1} gacha)
- funnel_type: faqat "TOF", "MOF" yoki "BOF" (boshqa qiymat yo'q)
- TOF = yangi auditoriya jalb qilish | MOF = ishonch oshirish | BOF = sotish va CTA
- hook_score va viral_potential: 1 dan 10 gacha son
- pros va cons: har biri 2-3 ta aniq, konkret nuqta
- recommendations: har bir reel uchun 2-3 ta amaliy tavsiya
- O'zbek tilida yoz
- FAQAT JSON qaytir`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 12000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      throw new Error('Claude ' + claudeRes.status + ': ' + err.slice(0, 200));
    }

    const claudeData = await claudeRes.json();
    const raw = claudeData.content[0].text;

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude JSON qaytarmadi: ' + raw.slice(0, 200));

    let analysis;
    try {
      analysis = JSON.parse(match[0]);
    } catch (e) {
      throw new Error('JSON parse xatosi: ' + e.message);
    }

    if (!analysis.videos || !Array.isArray(analysis.videos)) {
      analysis.videos = [];
    }

    return res.status(200).json({
      status: 'done',
      username,
      transcribedCount,
      avgLikes,
      transcripts,
      analysis
    });

  } catch (e) {
    console.log('XATO:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
