export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username, limit = 10 } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;

  try {
    // Используем прямую ссылку на раздел reels
    const runRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/reels/`],
        resultsType: 'posts',
        resultsLimit: limit,
        addParentData: true
      })
    });

    if (!runRes.ok) throw new Error('Apify error: ' + runRes.status);
    const runData = await runRes.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    let status = 'RUNNING';
    let attempts = 0;
    while (['RUNNING', 'READY', 'ABORTING'].includes(status)) {
      await new Promise(r => setTimeout(r, 4000));
      attempts++;
      if (attempts > 45) throw new Error('Timeout');
      const sRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs/${runId}?token=${APIFY_TOKEN}`);
      const sData = await sRes.json();
      status = sData.data.status;
      if (['FAILED', 'ABORTED'].includes(status)) throw new Error('Apify failed: ' + status);
    }

    const dataRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&limit=${limit}`);
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
