// api/lemlist.js — statistiche campagne Lemlist per la dashboard
const LEMLIST_KEY = process.env.LEMLIST_API_KEY;

// Campagne da mostrare (Nurturing esclusa di proposito)
const TARGETS = [
  { id: "cam_HZBbMGcYZxg5xK6Rn", group: "Settore Nautico" },
  { id: "cam_vhsi3Cgq2E3pdc5eL", group: "Campagne ICP" }, // ICP 1 Contoterzi
  { id: "cam_exsEpZNi6xjj4AxWP", group: "Campagne ICP" }, // ICP 2 Macchine OEM
  { id: "cam_6XjC5Ysctd7SMvRcg", group: "Campagne ICP" }, // ICP 3 HMLV
];

const authHeader = () => "Basic " + Buffer.from(":" + LEMLIST_KEY).toString("base64");

async function lemlist(path) {
  const r = await fetch("https://api.lemlist.com/api" + path, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Lemlist ${path} → ${r.status}: ${t}`); }
  return r.json();
}

async function getCampaignName(id) {
  try { const c = await lemlist("/campaigns/" + id); return c.name || id; } catch { return id; }
}

async function getCampaignStats(id) {
  const counts = {}; const leads = new Set(); let offset = 0;
  for (let page = 0; page < 20; page++) {
    const acts = await lemlist(`/activities?campaignId=${id}&limit=100&offset=${offset}`);
    if (!Array.isArray(acts) || acts.length === 0) break;
    for (const a of acts) { counts[a.type] = (counts[a.type] || 0) + 1; if (a.leadId) leads.add(a.leadId); }
    if (acts.length < 100) break; offset += 100;
  }
  const c = (t) => counts[t] || 0;
  return {
    leadsTouched: leads.size,
    sent: c("emailsSent") + c("linkedinSent"),
    opened: c("emailsOpened") + c("linkedinOpened"),
    replied: c("emailsReplied") + c("linkedinReplied"),
    interested: c("interested") + c("emailsInterested") + c("linkedinInterested") + c("manualInterested"),
    meetingBooked: c("meetingBooked"),
    bounced: c("emailsBounced"),
  };
}

export default async function handler(req, res) {
  if (!LEMLIST_KEY) return res.status(500).json({ error: "LEMLIST_API_KEY non configurato su Vercel." });
  try {
    const campaigns = [];
    for (const t of TARGETS) {
      const [name, stats] = await Promise.all([getCampaignName(t.id), getCampaignStats(t.id)]);
      campaigns.push({ id: t.id, name, group: t.group, ...stats });
    }
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json({ campaigns, updated_at: new Date().toISOString() });
  } catch (err) { console.error(err); return res.status(500).json({ error: String(err.message || err) }); }
}
