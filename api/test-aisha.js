export default async function handler(req, res) {
  const AISHA_KEY = process.env.AISHA_KEY;
  
  // Берём реальный видео URL от Instagram
  const testVideoUrl = 'https://www.instagram.com/p/DWrCYeKDAM3/';
  
  try {
    // Скачиваем видео
    const videoRes = await fetch('https://scontent.cdninstagram.com/v/t50.2886-16/481392645_1196498558519997_4960470950436894283_n.mp4');
    console.log('Video fetch status:', videoRes.status);
    console.log('Content-Type:', videoRes.headers.get('content-type'));
    
    const videoBuffer = await videoRes.arrayBuffer();
    console.log('Video size:', videoBuffer.byteLength);
    
    if (videoBuffer.byteLength < 1000) {
      return res.status(200).json({ error: 'Video too small or not downloaded' });
    }

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

    console.log('Aisha status:', uploadRes.status);
    const uploadData = await uploadRes.json();
    console.log('Aisha response:', JSON.stringify(uploadData));

    return res.status(200).json({ 
      videoSize: videoBuffer.byteLength,
      aishaStatus: uploadRes.status,
      aishaResponse: uploadData 
    });

  } catch(e) {
    console.log('Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
