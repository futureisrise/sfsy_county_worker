// export default {
//     async fetch(request, env) {
//         return handleRequest(request, env);
//     },
// };

// расширяем экспорт — добавляем обработчик Cron
export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCronTasks(env));
  },
};

// общий раннер
async function runCronTasks(env) {
  await Promise.allSettled([
    refreshInstagramToken(env),
    refreshFacebookToken(env),
  ]);
}

const AVAILABLE_LIST = ["facebook", "instagram", "youtube", "tiktok", "pinterest", "x", "telegram"];



async function fetchFacebookData(env) {
    const token = await getToken(env.TOKENS_KV, "FACEBOOK_ACCESS_TOKEN", env.FACEBOOK_ACCESS_TOKEN);
    const url = `https://graph.facebook.com/v22.0/${env.FACEBOOK_PAGE_ID}?` +
        new URLSearchParams({
            access_token: token,
            fields: "followers_count",
        }).toString();
    
    return fetchData(url, "Facebook");
}

async function fetchInstagramData(env) {
    const token = await getToken(env.TOKENS_KV, "INSTAGRAM_ACCESS_TOKEN", env.INSTAGRAM_ACCESS_TOKEN);
    
    const url = `https://graph.instagram.com/v17.0/${env.INSTAGRAM_PAGE_ID}?` +
        new URLSearchParams({
            access_token: token,
            fields: "followers_count",
        }).toString();

    return fetchData(url, "Instagram");
}

async function fetchYoutubeData(env) {
    const url = `https://www.googleapis.com/youtube/v3/channels?` +
        new URLSearchParams({
            part: "statistics",
            id: env.YOUTUBE_CHANNEL_ID,
            key: env.YOUTUBE_API_KEY,
        }).toString();

    return fetchData(url, "YouTube");
}

async function fetchTiktokData(env) {
    const url = `https://www.tiktok.com/@${env.TIKTOK_USER}`;

    try {
        const response = await fetch(url, { headers: getHeaders() });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const html = await response.text();
        const followerMatch = html.match(/"followerCount":(\d+)/);
        const likeMatch = html.match(/"heartCount":(\d+)/);

        return {
            subscribers: followerMatch ? parseInt(followerMatch[1]) : 0,
            likes: likeMatch ? parseInt(likeMatch[1]) : 0,
        };
    } catch (error) {
        console.error("❌ Error fetching TikTok data:", error);
        return { subscribers: 0, likes: 0 };
    }
}

async function fetchPinterestData(env) {
    const url = "https://api.pinterest.com/v5/user_account";

    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${env.PINTEREST_ACCESS_TOKEN}` },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        return { subscribers: data.follower_count || 0 };
    } catch (error) {
        console.error("❌ Error fetching Pinterest data:", error);
        return { subscribers: 0 };
    }
}

async function fetchXData(env) {
    const url = `https://api.twitter.com/2/users/by/username/${env.X_USER_ID}?user.fields=public_metrics`;

    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        return { subscribers: data.data.public_metrics.followers_count || 0 };
    } catch (error) {
        console.error("❌ Error fetching Twitter data:", error);
        return { subscribers: 0 };
    }
}

async function fetchTelegramData(env) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMembersCount?chat_id=${env.TELEGRAM_CHAT_ID}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.ok) {
            throw new Error("Failed to fetch Telegram data");
        }

        return { subscribers: data.result || 0 };
    } catch (error) {
        console.error("❌ Error fetching Telegram data:", error);
        return { subscribers: 0 };
    }
}

async function fetchData(url, platform) {
    try {
        const response = await fetch(url, { headers: getHeaders() });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        return platform === "YouTube"
            ? {
                subscribers: data.items?.[0]?.statistics?.subscriberCount || 0,
                views: data.items?.[0]?.statistics?.viewCount || 0,
            }
            : { subscribers: data.member_count || data.followers_count || 0 };
    } catch (error) {
        console.error(`❌ Error fetching ${platform} data:`, error);
        return { subscribers: 0 };
    }
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const platform = url.searchParams.get("platform")?.toLowerCase();

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 200, headers: getCorsHeaders() });
    }

    if (platform && AVAILABLE_LIST.includes(platform)) {
        let data = {};
        if (platform === "facebook") data = await fetchFacebookData(env);
        else if (platform === "instagram") data = await fetchInstagramData(env);
        else if (platform === "youtube") data = await fetchYoutubeData(env);
        else if (platform === "tiktok") data = await fetchTiktokData(env);
        else if (platform === "pinterest") data = await fetchPinterestData(env);
        else if (platform === "x") data = await fetchXData(env);
        else if (platform === "telegram") data = await fetchTelegramData(env);

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { ...getCorsHeaders(), "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ error: "Invalid platform" }), {
        status: 422,
        headers: { ...getCorsHeaders(), "Content-Type": "application/json" },
    });
}

function getCorsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    };
}

function getHeaders() {
    return {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "Accept-Language": "en",
    };
}

async function getToken(kv, key, fallback) {
  const v = await kv.get(key);
  return (v || fallback || "").trim();
}

async function setToken(kv, key, value) {
  if (!value) return;
  await kv.put(key, value, { expirationTtl: 60 * 24 * 60 * 60 }); // 60 дней на всякий
}


// === Instagram: продление long-lived токена (rolling 60 days) ===
async function refreshInstagramToken(env) {
  const current = await getToken(env.TOKENS_KV, "INSTAGRAM_ACCESS_TOKEN", env.INSTAGRAM_ACCESS_TOKEN);
  if (!current || !current.startsWith("IGQVJ")) {
    // нет токена или это не long-lived IG — пропускаем
    return;
  }
  const url = `https://graph.instagram.com/refresh_access_token?` + new URLSearchParams({
    grant_type: "ig_refresh_token",
    access_token: current,
  });
  const res = await fetch(url);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (data.access_token) {
    await setToken(env.TOKENS_KV, "INSTAGRAM_ACCESS_TOKEN", data.access_token);
    await env.TOKENS_KV.put("INSTAGRAM_UPDATED_AT", String(Date.now()));
    console.log("✅ IG token refreshed");
  } else {
    console.error("❌ IG refresh error:", data);
  }
}

// === Facebook: переобмен long-lived на новый long-lived (каждые ~45 дней) ===
async function refreshFacebookToken(env) {
  const current = await getToken(env.TOKENS_KV, "FACEBOOK_ACCESS_TOKEN", env.FACEBOOK_ACCESS_TOKEN);
  if (!current) return;

  const url = `https://graph.facebook.com/v22.0/oauth/access_token?` + new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.FACEBOOK_APP_ID,
    client_secret: env.FACEBOOK_APP_SECRET,
    fb_exchange_token: current,
  });
  const res = await fetch(url);
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (data.access_token) {
    await setToken(env.TOKENS_KV, "FACEBOOK_ACCESS_TOKEN", data.access_token);
    await env.TOKENS_KV.put("FACEBOOK_UPDATED_AT", String(Date.now()));
    console.log("✅ FB token refreshed");
  } else {
    console.error("❌ FB refresh error:", data);
  }
}
