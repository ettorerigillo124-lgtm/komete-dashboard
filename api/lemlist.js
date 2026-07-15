// api/lemlist.js
// Serverless Vercel: legge le statistiche delle campagne da Lemlist
// aggregando le "activities" per campagna.
// Env variable richiesta: LEMLIST_API_KEY (già impostata su Vercel).

const LEMLIST_KEY = process.env.LEMLIST_API_KEY;

// Filtra le campagne per nome. "Nautico" = solo le nautiche (veloce).
// Metti "" per prenderle tutte.
const FILTER = "Nautico";

function authHeader() {
  // Basic auth Lemlist: login vuoto, password = API key
  return "Basic " + Buffer.from(":" + LEMLIST_KEY).toString("base64");
}

async function lemlist(path) {
  const r = await fetch("https://api.lemlist.com/api" + path, {
    headers: { Authorization: authHeader(), Accept: "application/json" },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Lemlist ${path} → ${r.status}: ${t}`);
  }
  return r.json();
}

async function getCampaigns() {
  const data = await lemlist("/campaigns?limit=100");
  return Array.isArray(data) ? data : [];
}

async function getCampaignStats(campaignId) {
  const counts = {};
  const leads = new Set();
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const acts = await lemlist(
      `/activities?campaignId=${campaignId}&limit=100&offset=${offset}`
    );
    if (!Array.isArray(acts) || acts.length === 0) break;
    for (const a of acts) {
      counts[a.type] = (counts[a.type] || 0) + 1;
      if (a.leadId) leads.add(a.leadId);
    }
    if (acts.length < 100) break;
    offset += 100;
  }
  const c = (t) => counts[t] || 0;
  return {
    leadsTouched: leads.size,
    sent: c("emailsSent") + c("linkedinSent"),
    opened: c("emailsOpened") + c("linkedinOpened"),
    replied: c("emailsReplied") + c("linkedinReplied"),
    interested:
      c("interested") + c("emailsInterested") +
      c("linkedinInterested") + c("manualInterested"),
    meetingBooked: c("meetingBooked"),
    bounced: c("emailsBounced"),
  };
}

export default async function handler(req, res) {
  if (!LEMLIST_KEY) {
    return res.status(500).json({
      error: "LEMLIST_API_KEY non configurato su Vercel.",
    });
  }
  try {
    const campaigns = await getCampaigns();
    const targets = FILTER
      ? campaigns.filter((c) =>
          (c.name || "").toLowerCase().includes(FILTER.toLowerCase()))
      : campaigns;

    const results = [];
    for (const camp of targets) {
      const stats = await getCampaignStats(camp._id);
      results.push({ id: camp._id, name: camp.name, ...stats });
    }

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json({ campaigns: results, updated_at: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
