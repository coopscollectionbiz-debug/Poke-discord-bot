// ==========================================================
// tools/dev/battle-records-preview.mjs — serves this checkout's Battle
// Records page over real Fight records (tools/fight-record-fixtures.mjs)
// for one synthetic player, from a temp store. The session check accepts
// that player only, so other ids get the real 403. Never deploy.
//
//   node tools/dev/battle-records-preview.mjs [port]
//   → http://localhost:<port>/  (redirects to the page with ?id=)
// Add ?empty=1 to the redirect URL's page to see a player with no fights:
//   /public/battlerecords/?id=100000000000000002
// ==========================================================

import express from "express";
import os from "os";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { fixtureRecords } from "../fight-record-fixtures.mjs";
import { createFightStore } from "../../utils/fightRecords.js";
import { createFightRecordHandlers } from "../../services/fightRecordsApi.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.argv[2] ?? 5199);
const EMPTY = "100000000000000002";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "battle-records-preview-"));
const store = createFightStore({ dir: () => dir });
const { me, records } = fixtureRecords({ days: 14 });
for (const r of records) await store.add(r);
const stats = await store.stats();

const app = express();
app.use("/public", express.static(path.join(ROOT, "public")));
const api = createFightRecordHandlers({ store, isAuthorized: (_req, id) => id === me || id === EMPTY });
app.get("/api/fight-records", (req, res) => api.list(req, res));
app.get("/api/fight-records/:fightId", (req, res) => api.get(req, res));
app.get("/", (_req, res) => res.redirect(`/public/battlerecords/?id=${me}`));
app.listen(port, () => console.log(`Battle Records preview: http://localhost:${port}/ (${records.length} records, ${stats.live} kept, store ${dir})`));
