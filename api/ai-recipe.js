export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { ingredients } = await req.json();

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
              '당신은 요리사입니다. 주어진 재료로 만들 수 있는 요리 제목 하나만 제안하세요.',
          },
          { role: 'user', content: `남아있는 재료: ${ingredients.join(', ')}` },
        ],
        max_tokens: 20,
      }),
    });

    const data = await response.json();
    const suggestion =
      data.choices?.[0]?.message?.content?.trim() || '추천 불가';

    res.status(200).json({ recipe: suggestion });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI 추천 실패' });
  }
}
