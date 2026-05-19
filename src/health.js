import http from "http";
import { getRuntimeState } from "./state.js";

export function startHealthServer({ config, state, getStatus }) {
  if (!config.runtime.healthcheckEnabled) return null;

  const server = http.createServer((req, res) => {
    if (req.url !== "/health" && req.url !== "/") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    const runtime = getRuntimeState(state);
    const body = {
      ok: true,
      status: getStatus(),
      paused: runtime.paused,
      lastScanAt: runtime.lastScanAt,
      lastScanSuccessAt: runtime.lastScanSuccessAt,
      lastScanErrorAt: runtime.lastScanErrorAt,
      lastScanError: runtime.lastScanError
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  server.listen(config.runtime.healthcheckPort);
  return server;
}
