/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */
const functions = require('firebase-functions');
const fetch = require('node-fetch');

exports.aiRecipeSuggestion = functions.https.onCall(async (data, context) => {
  const ingredients = data.ingredients;
  require('dotenv').config();
  const apiKey = process.env.OPENAI_KEY;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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

    const dataRes = await response.json();
    return dataRes.choices?.[0]?.message?.content?.trim() || '추천 불가';
  } catch (err) {
    console.error(err);
    throw new functions.https.HttpsError('internal', 'AI 호출 실패');
  }
});
// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
