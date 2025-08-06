export default async function handler(req, res) {
  // ✅ CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ✅ Body 파싱
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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              '당신은 전문 요리사입니다. 주어진 재료를 최대한 활용해 만들 수 있는 한국 요리 이름 하나만 제안하세요. 다른 설명은 하지 마세요.',
          },
          {
            role: 'user',
            content: `남아있는 재료: ${ingredients.join(', ')}`,
          },
        ],
        max_tokens: 50,
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    // 📌 OpenAI 응답 전체를 Vercel 로그에 출력
    console.log('📦 OpenAI 응답 데이터:', JSON.stringify(data, null, 2));

    // 📌 응답이 없을 때 이유를 클라이언트로 전달
    if (!data.choices || !data.choices[0]?.message?.content) {
      return res.status(200).json({
        recipe: `추천 불가 (사유: ${data.error?.message || '응답 없음'})`,
      });
    }

    // ✅ 첫 줄만 추출
    const suggestion = (data.choices[0].message.content || '')
      .split('\n')[0]
      .trim();

    res.status(200).json({ recipe: suggestion });
  } catch (err) {
    console.error('❌ OpenAI API 호출 오류:', err);
    res.status(500).json({ error: 'AI 추천 실패' });
  }
}
