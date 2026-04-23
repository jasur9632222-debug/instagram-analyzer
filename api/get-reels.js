export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username, limit = 10 } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;

  if (!username) return res.status(400).json({ error: 'Username required' });
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN sozlanmagan — Vercel Settings → Environment Variables tekshiring' });

  const apifyAuth = { 'Authorization': `Bearer ${APIFY_TOKEN}` };

  try {
    const runRes = await fetch('https://api.apify.com/v2/acts/apify~instagram-scraper/runs', {
      method: 'POST',
      headers: { ...apifyAuth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/reels/`],
        resultsType: 'posts',
        resultsLimit: Number(limit),
        addParentData: false
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!runRes.ok) {
      const errBody = await runRes.text();
      throw new Error(`Apify error: ${runRes.status} — ${errBody.slice(0, 200)}`);
    }
    const runData = await runRes.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    let status = 'RUNNING';
    let attempts = 0;
    while (['RUNNING', 'READY', 'ABORTING'].includes(status)) {
      await new Promise(r => setTimeout(r, 4000));
      attempts++;
      if (attempts > 45) throw new Error('Timeout: 3 daqiqa ichida natija kelmadi');
      const sRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
        headers: apifyAuth,
        signal: AbortSignal.timeout(10000)
      });
      if (!sRes.ok) {
        const sErr = await sRes.text();
        throw new Error(`Run status xatosi: ${sRes.status} — ${sErr.slice(0, 100)}`);
      }
      const sData = await sRes.json();
      status = sData.data.status;
      if (['FAILED', 'ABORTED'].includes(status)) throw new Error('Apify run failed: ' + status);
    }

    const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?limit=${Number(limit)}`, {
      headers: apifyAuth,
      signal: AbortSignal.timeout(30000)
    });
    if (!dataRes.ok) throw new Error('Dataset error: ' + dataRes.status);
    const posts = await dataRes.json();

    console.log('Total posts from reels page:', posts.length);
    if (posts[0]) {
      console.log('First post type:', posts[0].type);
      console.log('First post videoUrl:', posts[0].videoUrl ? 'YES' : 'NO');
    }

    const reels = posts
      .filter(p => p && p.shortCode)
      .map(p => ({
        shortCode: p.shortCode || '',
        url: p.url || ('https://www.instagram.com/p/' + (p.shortCode || '')),
        caption: (p.caption || '').slice(0, 200),
        likesCount: p.likesCount || 0,
        commentsCount: p.commentsCount || 0,
        timestamp: p.timestamp || null,
        videoUrl: p.videoUrl || null,
        subtitleUrls: p.subtitleUrls || null,
        accessibilityCaption: p.accessibilityCaption || null
      }));

    console.log('Reels found:', reels.length);
    console.log('With videoUrl:', reels.filter(r => r.videoUrl).length);

    return res.status(200).json({ reels });
  } catch(e) {
    console.log('ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
