const PREDICTIONS_URL = (process.env.PREDICTIONS_URL || "").replace(/\/+$/, "");
const MAIN_APP_URL = (process.env.MAIN_APP_URL || "").replace(/\/+$/, "");
const KEY = process.env.PREDICTION_SERVICE_KEY || "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function parseJsonOrText(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callPredictions(path: string, method = "POST") {
  const res = await fetch(`${PREDICTIONS_URL}${path}`, {
    method,
    headers: { "x-prediction-key": KEY },
  });
  return {
    ok: res.ok,
    status: res.status,
    data: await parseJsonOrText(res),
  };
}

async function getUpcomingCount() {
  const res = await fetch(`${MAIN_APP_URL}/api/predictions?upcoming=1`);
  const data = await parseJsonOrText(res);
  if (!res.ok) return { ok: false, status: res.status, upcomingCount: null, data };
  return {
    ok: true,
    status: res.status,
    upcomingCount: Array.isArray(data) ? data.length : null,
    data,
  };
}

function resolveAction(url: URL) {
  const action = (url.searchParams.get("action") || "").toLowerCase();
  if (action) return action;

  switch (url.pathname) {
    case "/api/health":
      return "health";
    case "/trigger/retrain":
      return "retrain";
    case "/trigger/predict":
      return "predict";
    case "/trigger/reconcile":
      return "reconcile";
    case "/trigger/refresh":
      return "refresh";
    case "/trigger/sync":
      return "sync";
    default:
      return "daily";
  }
}

Bun.serve({
  port: Number(process.env.PORT || 3000),
  async fetch(req) {
    if (!PREDICTIONS_URL || !MAIN_APP_URL || !KEY) {
      return json(500, {
        error: "missing_env",
        required: ["PREDICTIONS_URL", "MAIN_APP_URL", "PREDICTION_SERVICE_KEY"],
      });
    }

    const url = new URL(req.url);
    const action = resolveAction(url);

    try {
      if (action === "health") {
        const predictions = await fetch(`${PREDICTIONS_URL}/healthz`);
        const main = await fetch(`${MAIN_APP_URL}/healthz`);
        return json(200, {
          action,
          predictions: predictions.status,
          main: main.status,
        });
      }

      if (action === "retrain") {
        const retrain = await callPredictions("/trigger/retrain");
        return json(retrain.ok ? 200 : 502, { action, retrain });
      }

      if (action === "predict") {
        const predict = await callPredictions("/trigger/predict");
        const sync = await callPredictions("/trigger/sync");
        const upcoming = await getUpcomingCount();
        return json(predict.ok && sync.ok && upcoming.ok ? 200 : 502, {
          action,
          predict,
          sync,
          upcoming_count: upcoming.upcomingCount,
          main_status: upcoming.status,
        });
      }

      if (action === "reconcile") {
        const reconcile = await callPredictions("/trigger/reconcile");
        return json(reconcile.ok ? 200 : 502, { action, reconcile });
      }

      if (action === "refresh") {
        const refresh = await callPredictions("/trigger/refresh");
        const sync = await callPredictions("/trigger/sync");
        return json(refresh.ok && sync.ok ? 200 : 502, { action, refresh, sync });
      }

      if (action === "sync") {
        const sync = await callPredictions("/trigger/sync");
        return json(sync.ok ? 200 : 502, { action, sync });
      }

      const predict = await callPredictions("/trigger/predict");
      const reconcile = await callPredictions("/trigger/reconcile");
      const sync = await callPredictions("/trigger/sync");
      const upcoming = await getUpcomingCount();

      const ok = predict.ok && reconcile.ok && sync.ok && upcoming.ok;
      return json(ok ? 200 : 502, {
        action: "daily",
        predict,
        reconcile,
        sync,
        upcoming_count: upcoming.upcomingCount,
        main_status: upcoming.status,
      });
    } catch (err) {
      return json(500, {
        error: "function_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
