// 상단에 전역 카운터 (서버 재시작 시 리셋됨, 배포 환경에선 캐시나 DB 사용 가능)
let requestCount = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' });

  let body = '';
  await new Promise((resolve) => {
    req.on('data', (chunk) => (body += chunk));
    req.on('end', resolve);
  });

  let ingredients;
  try {
    const parsed = JSON.parse(body);
    ingredients = parsed.ingredients || [];
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: 'No ingredients provided' });
  }

  try {
    const prompt = `다음 재료로 만들 수 있는 한국 요리 제목 5개만 제안해줘. 그리고 요리마다 쉼표 넣어주고. 다른 설명 없이 제목만 말해. 재료: ${ingredients.join(
      ', '
    )}`;
    const inputTokens = Math.ceil(prompt.length / 4);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    console.log('📡 AI API 상태코드:', response.status);
    const text = await response.text();
    console.log('📦 AI API 원본 응답:', text);

    if (!response.ok) {
      return res.status(response.status).json({
        recipe: `추천 불가 (사유: ${text || '응답 없음'})`,
      });
    }

    if (!text) {
      return res.status(200).json({
        recipe: `추천 불가 (사유: 빈 응답)`,
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ JSON 파싱 오류. 응답 내용:', text);
      return res.status(200).json({
        recipe: `추천 불가 (사유: JSON 파싱 실패)`,
        raw: text,
      });
    }

    console.log('📦 Gemini 응답 파싱 완료:', JSON.stringify(data, null, 2));

    if (data.error?.message) {
      return res.status(200).json({
        recipe: `추천 불가 (사유: ${data.error.message})`,
        raw: data,
      });
    }

    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({
        recipe: `추천 불가 (사유: 유효한 텍스트 없음)`,
        raw: data,
      });
    }

    const suggestion = data.candidates[0].content.parts[0].text.trim();
    const outputTokens = Math.ceil(suggestion.length / 4);
    const totalTokens = inputTokens + outputTokens;

    requestCount++;
    const remainingFree = Math.max(1500 - requestCount, 0);

    return res.status(200).json({
      recipe: suggestion,
      tokens: totalTokens,
      remainingFree,
    });
  } catch (err) {
    console.error('❌ Gemini API 호출 오류:', err);
    return res
      .status(500)
      .json({ error: 'AI 추천 실패', details: err.message || err.toString() });
  }
}
