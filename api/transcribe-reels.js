// api/transcribe-reels.js
// Aisha STT v2 — правильная интеграция

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reels } = req.body;
  if (!Array.isArray(reels) || reels.length === 0) {
    return res.status(400).json({ error: 'reels array required' });
  }

  const AISHA_KEY = process.env.AISHA_KEY;
  if (!AISHA_KEY) return res.status(500).json({ error: 'AISHA_KEY not set' });

  const results = [];

  for (const reel of reels) {
    const { id, videoUrl, shortcode } = reel;

    if (!videoUrl) {
      results.push({ id, shortcode, transcript: null, error: 'No videoUrl' });
      continue;
    }

    try {
      // ШАГ 1: Скачиваем видео через наш сервер
      console.log(`Downloading video for reel ${id}...`);
      const videoRes = await fetch(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.instagram.com/',
          'Accept': '*/*',
        },
        redirect: 'follow',
      });

      if (!videoRes.ok) {
        throw new Error(`Video download failed: ${videoRes.status}`);
      }

      const videoBuffer = await videoRes.arrayBuffer();
      console.log(`Downloaded ${videoBuffer.byteLength} bytes for reel ${id}`);

      // ШАГ 2: Отправляем в Aisha STT v2
      const formData = new FormData();
      const blob = new Blob([videoBuffer], { type: 'video/mp4' });
      const filename = `reel_${shortcode || id}.mp4`;

      formData.append('audio', blob, filename);
      formData.append('title', filename);
      formData.append('has_diarization', 'false');

      console.log(`Sending to Aisha STT: ${filename}`);
      const aishaRes = await fetch('https://back.aisha.group/api/v2/stt/post/', {
        method: 'POST',
        headers: {
          'x-api-key': AISHA_KEY,
          // Content-Type НЕ ставим — FormData сам добавит boundary
        },
        body: formData,
      });

      const responseText = await aishaRes.text();
      console.log(`Aisha response for ${id}: ${responseText.slice(0, 200)}`);

      if (!aishaRes.ok) {
        throw new Error(`Aisha error ${aishaRes.status}: ${responseText}`);
      }

      // Парсим ответ
      let aishaData;
      try {
        aishaData = JSON.parse(responseText);
      } catch {
        throw new Error(`Invalid JSON from Aisha: ${responseText}`);
      }

      // Aisha может вернуть текст в разных полях
      const transcript =
        aishaData?.text ||
        aishaData?.transcript ||
        aishaData?.result ||
        aishaData?.data?.text ||
        aishaData?.data?.transcript ||
        '';

      results.push({
        id,
        shortcode,
        transcript,
        duration: aishaData?.duration,
        language: aishaData?.language,
        raw: aishaData, // для дебага — потом можно убрать
      });

    } catch (err) {
      console.error(`Error transcribing reel ${id}:`, err.message);

      // Fallback на Deepgram
      console.log(`Trying Deepgram fallback for reel ${id}...`);
      const fallback = await tryDeepgram(videoUrl, process.env.DEEPGRAM_KEY);

      results.push({
        id,
        shortcode,
        transcript: fallback || null,
        error: fallback ? null : err.message,
        source: fallback ? 'deepgram' : null,
      });
    }
  }

  return res.status(200).json({ results });
}

// Fallback: Deepgram через прямой URL
async function tryDeepgram(videoUrl, deepgramKey) {
  if (!deepgramKey) return null;
  try {
    const res = await fetch(
      'https://api.deepgram.com/v1/listen?detect_language=true&punctuate=true&smart_format=true',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${deepgramKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: videoUrl }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || null;
  } catch {
    return null;
  }
}
