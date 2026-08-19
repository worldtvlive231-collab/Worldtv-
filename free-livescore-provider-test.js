// Temporary Free Livescore API inspection route.
// Registers the route on the Express app before server.js installs its 404 handler.
const express = require("express");

const originalUse = express.application.use;
let installed = false;

function installProviderTestRoute(app){
  if(installed) return;
  installed = true;

  app.get("/api/football/provider-test", async (req, res) => {
    try {
      const host = process.env.FOOTBALL_API_HOST;
      const key = process.env.FOOTBALL_API_KEY;
      if (!host || !key) {
        return res.status(500).json({
          ok: false,
          error: "FOOTBALL_API_HOST or FOOTBALL_API_KEY is missing"
        });
      }

      const search = String(req.query.search || "romania").trim().slice(0, 80) || "romania";
      const url = `https://${host}/livescore-get-search?sportname=soccer&search=${encodeURIComponent(search)}`;
      const response = await global.fetch(url, {
        headers: {
          "Content-Type": "application/json",
          "x-rapidapi-key": key,
          "x-rapidapi-host": host
        }
      });

      const text = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch { data = { raw_text: text }; }

      return res.status(response.ok ? 200 : response.status).json({
        ok: response.ok,
        provider_status: response.status,
        provider_host: host,
        endpoint: "/livescore-get-search",
        query: { sportname: "soccer", search },
        data
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
}

express.application.use = function patchedUse(...args){
  installProviderTestRoute(this);
  return originalUse.apply(this, args);
};
