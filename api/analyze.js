export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username } = req.body;
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!username) return res.status(400).json({ error: 'Username required' });

  try {
    const runRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-reel-scraper/runs?token=${APIFY_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: 'posts',
        resultsLimit: 50,
        addParentData: true
      })
    });

    if (!runRes.ok) throw new Error('Apify error: ' + runRes.status);
    const runData = await runRes.json();

    return res.status(200).json({
      runId: runData.data.id,
      datasetId: runData.data.defaultDatasetId
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
