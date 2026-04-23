export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!username) return res.status(400).json({ error: 'Username required' });
  if (!APIFY_TOKEN) return res.status(500).json({ error: 'APIFY_TOKEN sozlanmagan — Vercel Settings → Environment Variables tekshiring' });

  try {
    const runRes = await fetch('https://api.apify.com/v2/acts/apify~instagram-scraper/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${APIFY_TOKEN}`
      },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: 'posts',
        resultsLimit: 50,
        addParentData: true
      })
    });

    if (!runRes.ok) {
      const errBody = await runRes.text();
      throw new Error(`Apify error: ${runRes.status} — ${errBody.slice(0, 200)}`);
    }
    const runData = await runRes.json();

    return res.status(200).json({
      runId: runData.data.id,
      datasetId: runData.data.defaultDatasetId
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
