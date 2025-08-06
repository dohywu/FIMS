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

  try {
    const prompt = `다음 재료로 만들 수 있는 한국 요리 제목 5개 이하로 제안해줘. 다른 설명 없이 제목만 말해. 메뉴간에 쉼표를 넣어줘. 재료: ${ingredients.join(
      ', '
    )}`;
    const inputTokens = Math.ceil(prompt.length / 4); // 한글 토큰 대략 추정 (4~5자/토큰)

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

    const data = await response.json();
    console.log('📦 Gemini 응답:', JSON.stringify(data, null, 2));

    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({
        recipe: `추천 불가 (사유: ${data.error?.message || '응답 없음'})`,
      });
    }

    const suggestion = data.candidates[0].content.parts[0].text.trim();
    const outputTokens = Math.ceil(suggestion.length / 4);
    const totalTokens = inputTokens + outputTokens;

    // 요청 수 카운트
    requestCount++;
    const remainingFree = Math.max(1500 - requestCount, 0);

    res.status(200).json({
      recipe: suggestion,
      tokens: totalTokens,
      remainingFree,
    });
  } catch (err) {
    console.error('❌ Gemini API 호출 오류:', err);
    res.status(500).json({ error: 'AI 추천 실패', details: err.message });
  }
}
