const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// 使用你的真实 API Key
const apiKey = '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';  // 替换成真实的
const proxyUrl = 'http://127.0.0.1:4780';
const httpsAgent = new HttpsProxyAgent(proxyUrl);

console.log('Testing with real API key...');

axios.post('https://api.openai.com/v1/chat/completions', {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Say hello' }],
  max_tokens: 50
}, {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  httpsAgent: httpsAgent,
  proxy: false,
  timeout: 60000
})
.then(response => {
  console.log('✅ SUCCESS!');
  console.log('Response:', response.data.choices[0].message.content);
})
.catch(error => {
  if (error.response) {
    console.log('❌ API Error:', error.response.status);
    console.log('Message:', error.response.data?.error?.message);
  } else {
    console.log('❌ Network Error:', error.message);
  }
});