export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Body 파싱
  let body = '';
  await new Promise((resolve) => {
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', resolve);
  });

  let ingredients;
  try {
    const parsed = JSON.parse(body);
    ingredients = parsed.ingredients || [];
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `다음 재료로 만들 수 있는 한국 요리 제목 하나만 제안해줘. 다른 설명 없이 제목만 말해. 재료: ${ingredients.join(
                    ', '
                  )}`,
                },
              ],
            },
          ],
        }),
      }
    );

    const data = await response.json();
    console.log('📦 Gemini 응답:', JSON.stringify(data, null, 2));

    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({
        recipe: `추천 불가 (사유: ${data.error?.message || '응답 없음'})`,
      });
    }

    const suggestion =
      data.candidates[0].content.parts[0].text.trim() || '추천 불가';

    res.status(200).json({ recipe: suggestion });
  } catch (err) {
    console.error('❌ Gemini API 호출 오류:', err);
    res.status(500).json({ error: 'AI 추천 실패', details: err.message });
  }
}
