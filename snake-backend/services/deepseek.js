const fetch = require('node-fetch');

const DEEPSEEK_API_KEY = 'YOUR_DEEPSEEK_KEY';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Cache AI responses briefly to reduce API calls
const responseCache = new Map();
const CACHE_TTL = 3000;

async function askDeepSeek(messages, temperature = 0.7) {
  const cacheKey = JSON.stringify({ messages, temperature });

  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature,
        max_tokens: 200,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[DeepSeek] API error:', res.status, err);
      return null;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    responseCache.set(cacheKey, { time: Date.now(), data: text });

    // Limit cache size
    if (responseCache.size > 500) {
      const firstKey = responseCache.keys().next().value;
      responseCache.delete(firstKey);
    }

    return text;
  } catch (e) {
    console.error('[DeepSeek] Fetch error:', e.message);
    return null;
  }
}

/**
 * Ask DeepSeek for a bot's next move direction.
 * Returns { dx, dy } or null if API fails.
 */
async function getBotMove(botState) {
  const prompt = `You control a snake in a multiplayer Snake.io game. Your goal: trap and kill other snakes.

GAME STATE:
- You are at (${Math.round(botState.x)}, ${Math.round(botState.y)}), angle ${botState.angle.toFixed(2)} rad
- Your length: ${botState.length}, score: ${botState.score}
- Players nearby: ${botState.nearbyPlayers.map(p => `"${p.name}" at (${Math.round(p.x)},${Math.round(p.y)}), length ${p.length}, heading ${p.angle.toFixed(2)}`).join('; ') || 'none'}
- Food nearby: ${botState.nearbyFood.map(f => `(${Math.round(f.x)},${Math.round(f.y)}) ${f.type}`).join(', ') || 'none'}
- Power-ups nearby: ${botState.nearbyPowerUps.map(p => `${p.type} at (${Math.round(p.x)},${Math.round(p.y)})`).join(', ') || 'none'}
- Boost available: ${botState.boostReady ? 'yes' : 'no'}

Respond with ONLY a JSON object: {"direction": "left|right|straight", "boost": true|false}
- "left": turn ~0.3 rad left
- "right": turn ~0.3 rad right
- "straight": keep current heading
- "boost": use speed boost if available

Choose to trap players by cutting off their path, or chase food if you need to grow.
JSON:`;

  try {
    const result = await askDeepSeek([
      { role: 'system', content: 'You are a competitive Snake.io bot. You output only JSON. You are strategic: you try to cut off other players and trap them against walls or your body.' },
      { role: 'user', content: prompt },
    ], 0.6);

    if (!result) return null;

    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    let dx = 0, dy = 0;

    if (parsed.direction === 'left') {
      dx = Math.cos(botState.angle - 0.3) * 3;
      dy = Math.sin(botState.angle - 0.3) * 3;
    } else if (parsed.direction === 'right') {
      dx = Math.cos(botState.angle + 0.3) * 3;
      dy = Math.sin(botState.angle + 0.3) * 3;
    } else {
      dx = Math.cos(botState.angle) * 3;
      dy = Math.sin(botState.angle) * 3;
    }

    return { dx, dy, boost: !!parsed.boost };
  } catch (e) {
    console.error('[DeepSeek] Parse error:', e.message);
    return null;
  }
}

/**
 * Post-game analysis for a player.
 */
async function getGameAnalysis(playerName, playerStats, gameEvents) {
  const prompt = `Analyze this Snake.io game for player "${playerName}":
- Final score: ${playerStats.score}, length: ${playerStats.length}, kills: ${playerStats.kills}, deaths: ${playerStats.deaths}
- Died by: ${gameEvents.deathCause || 'survived'}
- Longest streak: ${gameEvents.longestStreak || 0}s

Give a SHORT analysis (2-3 sentences) in Turkish: what they did wrong, and one tip to play better next time. Be encouraging.`;

  try {
    const result = await askDeepSeek([
      { role: 'system', content: 'Sen bir Snake.io koçusun. Kısa, öz ve cesaretlendirici analizler yaparsın. Her zaman Türkçe cevap verirsin.' },
      { role: 'user', content: prompt },
    ], 0.8);

    return result || 'Harika bir oyundu! Bir dahaki sefere rakiplerin hareketlerini tahmin edip yollarını kesmeyi dene.';
  } catch (e) {
    return 'İyi bir oyundu! Daha fazla yiyecek toplayıp büyüyerek rakiplerine üstünlük kurabilirsin.';
  }
}

module.exports = { askDeepSeek, getBotMove, getGameAnalysis };
