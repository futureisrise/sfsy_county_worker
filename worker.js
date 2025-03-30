export default {
    async fetch(request, env) {
        return handleRequest(request, env);
    },
};

const AVAILABLE_LIST = ["facebook", "instagram", "youtube", "tiktok"];
const CACHE_TTL = 60;

async function fetchFacebookData(env) {
    const url = `https://graph.facebook.com/v22.0/${env.FACEBOOK_GROUP_ID}?` +
        new URLSearchParams({
            access_token: env.FACEBOOK_ACCESS_TOKEN,
            fields: "member_count",
        }).toString();

    return fetchData(url, "Facebook");
}

async function fetchInstagramData(env) {
    const url = `https://graph.instagram.com/v17.0/${env.INSTAGRAM_PAGE_ID}?` +
        new URLSearchParams({
            access_token: env.INSTAGRAM_ACCESS_TOKEN,
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

async function getCachedData(env, key) {
    const cached = await env.KV_SOCIAL_STATS.get(key, { type: "json" });
    return cached || null;
}

async function setCachedData(env, key, data) {
    await env.KV_SOCIAL_STATS.put(key, JSON.stringify(data), { expirationTtl: CACHE_TTL });
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const platform = url.searchParams.get("platform")?.toLowerCase();

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 200, headers: getCorsHeaders() });
    }

    if (platform && AVAILABLE_LIST.includes(platform)) {
        const cacheKey = `stats_${platform}`;

        const cachedData = await getCachedData(env, cacheKey);
        if (cachedData) {
            console.log(`✅ Serving cached ${platform} data`);
            return new Response(JSON.stringify(cachedData), {
                status: 200,
                headers: { ...getCorsHeaders(), "Content-Type": "application/json" },
            });
        }

        let data = {};
        if (platform === "facebook") data = await fetchFacebookData(env);
        else if (platform === "instagram") data = await fetchInstagramData(env);
        else if (platform === "youtube") data = await fetchYoutubeData(env);
        else if (platform === "tiktok") data = await fetchTiktokData(env);

        // Зберігаємо дані у кеш
        await setCachedData(env, cacheKey, data);

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