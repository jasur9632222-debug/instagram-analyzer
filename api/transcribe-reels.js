// api/transcribe-reels.js
// Видео скачиваем сами → отправляем в Deepgram как бинарный файл
export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username, reels } = req.body;
  if (!Array.isArray(reels) || reels.length === 0) {
    return res.status(400).json({ error: 'reels array required' });
  }

  const AISHA_KEY = process.env.AISHA_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;

  // ─── ШАГ 1: Транскрипция каждого рилса ───
  const transcripts = [];

  for (const reel of reels) {
    const { id, videoUrl, shortcode, likesCount, commentsCount, caption, timestamp } = reel;

    let transcript = null;
    let source = null;
    let videoBuffer = null;

    // Сначала скачиваем видео через наш сервер
    if (videoUrl) {
      try {
        console.log(`Downloading video: ${shortcode}`);
        const videoRes = await fetch(videoUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.instagram.com/',
            'Accept': '*/*',
          },
          redirect: 'follow',
        });
        if (videoRes.ok) {
          videoBuffer = await videoRes.arrayBuffer();
          console.log(`Downloaded ${videoBuffer.byteLength} bytes`);
        } else {
          console.error(`Video download failed: ${videoRes.status}`);
        }
      } catch (err) {
        console.error('Video download error:', err.message);
      }
    }

    // ── ОСНОВНОЙ: Deepgram с бинарным файлом ──
    if (videoBuffer && DEEPGRAM_KEY) {
      try {
        console.log(`Sending to Deepgram: ${shortcode}`);
        const dgRes = await fetch(
          'https://api.deepgram.com/v1/listen?detect_language=true&punctuate=true&smart_format=true',
          {
            method: 'POST',
            headers: {
              'Authorization': `Token ${DEEPGRAM_KEY}`,
              'Content-Type': 'video/mp4',
            },
            body: videoBuffer, // ← бинарный файл, не URL
          }
        );

        if (dgRes.ok) {
          const dgData = await dgRes.json();
          const detectedLang = dgData?.results?.channels?.[0]?.detected_language;
          transcript = dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript || null;
          if (transcript) {
            source = `deepgram(${detectedLang || 'auto'})`;
            console.log(`Deepgram OK: lang=${detectedLang}, chars=${transcript.length}`);
          }
        } else {
          const errText = await dgRes.text();
          console.error(`Deepgram error ${dgRes.status}:`, errText);
        }
      } catch (err) {
        console.error('Deepgram error:', err.message);
      }
    }

    // ── FALLBACK: Aisha с бинарным файлом ──
    if (!transcript && videoBuffer && AISHA_KEY) {
      try {
        console.log(`Aisha fallback: ${shortcode}`);
        const formData = new FormData();
        const blob = new Blob([videoBuffer], { type: 'video/mp4' });
        formData.append('audio', blob, `reel_${shortcode || id}.mp4`);
        formData.append('title', `reel_${shortcode || id}`);
        formData.append('has_diarization', 'false');
        formData.append('language', 'uz');

        const aishaRes = await fetch('https://back.aisha.group/api/v2/stt/post/', {
          method: 'POST',
          headers: { 'x-api-key': AISHA_KEY },
          body: formData,
        });

        if (aishaRes.ok) {
          const aishaData = await aishaRes.json();
          transcript =
            aishaData?.text ||
            aishaData?.transcript ||
            aishaData?.result ||
            aishaData?.data?.text ||
            null;
          if (transcript) source = 'aisha';
        } else {
          console.error('Aisha error:', aishaRes.status, await aishaRes.text());
        }
      } catch (err) {
        console.error('Aisha error:', err.message);
      }
    }

    transcripts.push({
      id,
      shortcode,
      caption: caption || '',
      likes: likesCount || 0,
      comments: commentsCount || 0,
      timestamp,
      transcript: transcript || '(mavjud emas)',
      source,
    });
  }

  const transcribedCount = transcripts.filter(
    t => t.transcript && t.transcript !== '(mavjud emas)'
  ).length;

  const avgLikes = reels.length
    ? Math.round(reels.reduce((s, r) => s + (r.likesCount || 0), 0) / reels.length)
    : 0;

  // ─── ШАГ 2: Claude анализ ───
  const reelsText = transcripts
    .map((t, i) => {
      return `[${i + 1}] ❤️${t.likes} 💬${t.comments} | ${
        t.caption ? t.caption.slice(0, 150) : '(подпись нет)'
      }\nТранскрипция: ${t.transcript || '(нет)'}`;
    })
    .join('\n\n---\n\n');

  let analysis = null;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: `Ты — Senior Content Strategist. Анализируй ${reels.length} рилсов аккаунта @${username}.
Верни ТОЛЬКО валидный JSON без лишнего текста, без \`\`\`json.

РИЛСЫ:
${reelsText}

Формат ответа:
{
  "executive_summary": "2-3 предложения об аккаунте и главный инсайт",
  "funnel": {
    "tof": 60,
    "mof": 30,
    "bof": 10,
    "niche_avg_er": "3.5%",
    "verdict": "Описание воронки",
    "funnel_recommendations": "Что изменить"
  },
  "missed_leads": {
    "count": 150,
    "explanation": "Почему упущены"
  },
  "videos": [
    {
      "funnel_type": "TOF",
      "summary": "О чём рилс",
      "hook_score": 7,
      "viral_potential": 6,
      "actual_likes": 1200,
      "expected_likes": 2000,
      "performance_gap": "Почему не дотянул",
      "emotional_trigger": "Любопытство",
      "hook_analysis": "Анализ первых 3 секунд",
      "deep_analysis": {
        "sentences": [
          {
            "original": "Оригинальная фраза из транскрипции",
            "problem": "В чём проблема",
            "fix": "Улучшенная версия",
            "why_fix_works": "Почему работает",
            "trigger": "Триггер"
          }
        ],
        "outcome": "Если исправить — результат"
      }
    }
  ],
  "top_recommendations": [
    "Рекомендация 1",
    "Рекомендация 2",
    "Рекомендация 3"
  ]
}`,
          },
        ],
      }),
    });

    if (claudeRes.ok) {
      const claudeData = await claudeRes.json();
      const raw = claudeData.content[0].text;
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleaned);
    }
  } catch (e) {
    console.error('Claude/parse error:', e.message);
  }

  if (!analysis) {
    analysis = {
      executive_summary: "Tahlil qila olmadi. Keyinroq urinib ko'ring.",
      funnel: { tof: 60, mof: 30, bof: 10, verdict: '', niche_avg_er: '—' },
      missed_leads: null,
      videos: [],
      top_recommendations: [],
    };
  }

  return res.status(200).json({
    status: 'done',
    username,
    transcribedCount,
    avgLikes,
    transcripts,
    analysis,
  });
}
