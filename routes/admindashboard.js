// routes/adminDashboard.js
import express from "express";

export function mountAdminDashboard(app, deps) {
  // deps = { getTrainerData: () => trainerDataObject, saveTrainerData: async (trainerDataObject) => void }
  const router = express.Router();

  // ---- SIMPLE TOKEN GATE ----
  // Visit: /admindashboard?token=YOUR_TOKEN
  // Or send header: x-admin-token: YOUR_TOKEN
  const ADMIN_TOKEN = process.env.ADMIN_DASH_TOKEN || "";

  function requireAdmin(req, res, next) {
    if (!ADMIN_TOKEN) {
      return res
        .status(500)
        .send("ADMIN_DASH_TOKEN is not set on the server.");
    }

    const token =
      req.query.token ||
      req.headers["x-admin-token"] ||
      (req.cookies ? req.cookies["admin_token"] : null);

    if (token !== ADMIN_TOKEN) return res.status(401).send("Unauthorized");
    next();
  }

  // Optional convenience: set cookie once
  router.get("/admin/login", (req, res) => {
    const token = req.query.token;
    if (!token || token !== ADMIN_TOKEN) return res.status(401).send("Unauthorized");
    res.cookie("admin_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true if behind HTTPS
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    });
    res.redirect("/admindashboard");
  });

  // Serve the dashboard UI (static file)
  router.get("/admindashboard", requireAdmin, (req, res) => {
    // This assumes you mount /public as static and place files in /public/admindashboard
    res.sendFile("index.html", { root: "public/admindashboard" });
  });

  // ---- API: list all users ----
  router.get("/api/admin/users", requireAdmin, (req, res) => {
    const trainerData = deps.getTrainerData();
    if (!trainerData || typeof trainerData !== "object") return res.json({ users: [] });

    const users = Object.entries(trainerData).map(([userId, u]) => ({
      userId,
      // Common fields you use (safe if missing)
      name: u?.name ?? u?.username ?? u?.displayName ?? "",
      rank: u?.rank ?? "",
      tp: Number(u?.tp ?? 0),
      cc: Number(u?.cc ?? 0),

      // Counts
      pokemonCount: u?.pokemon ? Object.keys(u.pokemon).length : 0,
      trainerCount: u?.trainers ? Object.keys(u.trainers).length : 0,

      // Anything else you want surfaced quickly
      lastDaily: u?.lastDaily ?? null,
      lastWeekly: u?.lastWeekly ?? null,
      createdAt: u?.createdAt ?? null,
      updatedAt: u?.updatedAt ?? null,

      // Full object for drilldown (UI can request full by id too; but returning here is convenient)
      raw: u,
    }));

    res.json({ users });
  });

  // ---- API: single user ----
  router.get("/api/admin/user/:id", requireAdmin, (req, res) => {
    const trainerData = deps.getTrainerData();
    const user = trainerData?.[req.params.id];
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ userId: req.params.id, user });
  });

  // ---- API: update basic fields ----
  // Body: { tp?: number, cc?: number, rank?: string, name?: string }
  router.post("/api/admin/user/:id", requireAdmin, express.json(), async (req, res) => {
    const trainerData = deps.getTrainerData();
    const id = req.params.id;
    if (!trainerData?.[id]) return res.status(404).json({ error: "User not found" });

    const u = trainerData[id];
    const patch = req.body || {};

    // Minimal validation
    if (patch.tp !== undefined) u.tp = Math.max(0, Number(patch.tp) || 0);
    if (patch.cc !== undefined) u.cc = Math.max(0, Number(patch.cc) || 0);
    if (patch.rank !== undefined) u.rank = String(patch.rank);
    if (patch.name !== undefined) u.name = String(patch.name);

    // Mark updated timestamp if you use one
    u.updatedAt = new Date().toISOString();

    await deps.saveTrainerData(trainerData);

    res.json({ ok: true, userId: id, user: u });
  });

  app.use(router);
}
