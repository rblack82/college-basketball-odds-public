const ORIGIN = "https://rblack82.github.io";
const OWNER = "rblack82";

const WORKFLOWS = [
  {
    repo: "college-basketball-odds",
    file: "collect-odds.yml"
  },
  {
    repo: "college-basketball-odds-public",
    file: "collect-dk-splits.yml"
  }
];

export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    };

    const reply = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers
      });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers
      });
    }

    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/refresh"
    ) {
      return reply({ error: "Not found" }, 404);
    }

    if (request.headers.get("Origin") !== ORIGIN) {
      return reply({ error: "Origin not allowed" }, 403);
    }

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      "unknown";

    const limit = await env.REFRESH_LIMITER.limit({
      key: ip
    });

    if (!limit.success) {
      return reply({
        error: "Too many attempts. Try again later."
      }, 429);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return reply({ error: "Invalid request" }, 400);
    }

    const supplied = String(body.pin || "");
    const expected = env.REFRESH_PASSCODE;

    if (!expected || !env.GITHUB_TOKEN) {
      return reply({
        error: "Server configuration missing"
      }, 500);
    }

    const encoder = new TextEncoder();
    const a = encoder.encode(supplied);
    const b = encoder.encode(expected);

    let difference = a.length ^ b.length;
    const length = Math.max(a.length, b.length);

    for (let i = 0; i < length; i++) {
      difference |= (a[i] || 0) ^ (b[i] || 0);
    }

    if (difference !== 0) {
      return reply({ error: "Incorrect PIN" }, 401);
    }

    const results = await Promise.all(
      WORKFLOWS.map(async ({ repo, file }) => {
        const url =
          `https://api.github.com/repos/${OWNER}/` +
          `${repo}/actions/workflows/${file}/dispatches`;

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
              "Accept": "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "basketball-model-refresh",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              ref: "main"
            })
          });

          return {
            collector: file,
            accepted: response.status === 204,
            status: response.status
          };
        } catch {
          return {
            collector: file,
            accepted: false,
            error: "GitHub request failed"
          };
        }
      })
    );

    const success = results.every(r => r.accepted);

    return reply({
      success,
      message: success
        ? "Both collectors triggered"
        : "One or more collectors could not be triggered",
      results
    }, success ? 202 : 502);
  }
};
