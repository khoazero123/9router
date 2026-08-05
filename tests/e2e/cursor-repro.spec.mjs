import { test, expect } from '@playwright/test';

const BASE_URL = process.env.NINEROUTER_BASE_URL || 'http://localhost:20128';
const MODEL = process.env.NINEROUTER_MODEL || 'openai/gpt-5.6-luna';
const API_KEY = process.env.NINEROUTER_API_KEY;

test('Cursor-style request: tools + reasoning_effort', async ({ request }) => {
  console.log(`Testing ${MODEL} on ${BASE_URL}`);

  const response = await request.post(`${BASE_URL}/v1/chat/completions`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    data: {
      model: MODEL,
      messages: [{ role: 'user', content: 'Say hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the current weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        }
      ],
      reasoning_effort: 'medium',
      stream: false
    }
  });

  const status = response.status();
  const text = await response.text();
  console.log('Response Status:', status);
  console.log('Response Text:', text);

  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse JSON:', e.message);
    throw e;
  }

  if (status === 400 && JSON.stringify(body).includes('reasoning_effort')) {
    console.log('Response Body:', JSON.stringify(body, null, 2));
    throw new Error('❌ BUG REPRODUCED: reasoning_effort was not normalized');
  } else if (status === 200) {
    console.log('✅ SUCCESS: Request accepted');
  } else {
    console.log('Response Status:', status);
    console.log('Response Body:', JSON.stringify(body, null, 2));
  }
});
