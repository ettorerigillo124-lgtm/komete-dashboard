// api/sync-lemlist.js — backfill: porta i lead delle campagne Lemlist nelle liste Attio.
// Chiamalo così (una campagna per volta): /api/sync-lemlist?secret=komsync&c=nautico
//   c = nautico | icp1 | icp2 | icp3   —   offset per batch successivi
const SECRET = "komsync";
const LEMLIST_KEY = process.env.LEMLIST_API_KEY;
const ATTIO_KEY = process.env.ATTIO_API_KEY;

const JOBS = {
  nautico: { campaign: "cam_HZBbMGcYZxg5xK6Rn", list: "campagna_lemlist_1_2", icp: null },
  icp1:    { campaign: "cam_vhsi3Cgq2E3pdc5eL", list: "campagna_lemlist_1",   icp: "ICP 1" },
  icp2:    { campaign: "cam_exsEpZNi6xjj4AxWP", list: "campagna_lemlist_1",   icp: "ICP 2" },
  icp3:    { campaign: "cam_6XjC5Ysctd7SMvRcg", list: "campagna_lemlist_1",   icp: "ICP 3" },
};
const BATCH = 25;

const lemAuth = () => "Basic " + Buffer.from(":" + LEMLIST_KEY).toString("base64");
async function lemlistCSV(path) {
  const r = await fetch("https://api.lemlist.com/api" + path, { headers: { Authorization: lemAuth() } });
  if (!r.ok) throw new Error(`Lemlist ${path} → ${r.status}: ${await r.text()}`);
  return r.text();
}
async function attio(method, path, body) {
  const r = await fetch("https://api.attio.com/v2" + path, {
    method,
    headers: { Authorization: `Bearer ${ATTIO_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Attio ${method} ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

function parseCSV(text) {
  const rows = []; let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function mapStage(lastState, status) {
  const s = (status || "").toLowerCase(), ls = (lastState || "").toLowerCase();
  if (s === "interested" || ls.includes("interested") || ls === "meetingbooked") return "Vinto";
  if (s === "notinterested" || ls.includes("notinterested") || ls.includes("unsub") || ls.includes("bounced") || ls.includes("failed")) return "Lost";
  if (s === "paused") return "Nurturing";
  if (ls.startsWith("aircall") || ls.startsWith("manual") || ls.includes("call") || ls.includes("phone")) return "Sequenza Cold Calling";
  if (ls.startsWith("emails")) return "Sequenza email";
  if (ls.startsWith("linkedin") || ["contacted","hooked","attracted","warmed"].includes(ls)) return "Contattati";
  return null;
}

async function upsertPerson(email, first, last, job) {
  const values = { email_addresses: [email], name: [{ first_name: first || "", last_name: last || "", full_name: (`${first || ""} ${last || ""}`).trim() || email }] };
  if (job) values.job_title = [{ value: job }];
  const res = await attio("PUT", "/objects/people/records?matching_attribute=email_addresses", { data: { values } });
  return res.data.id.record_id;
}
async function findOrCreateCompany(name) {
  const q = await attio("POST", "/objects/companies/records/query", { filter: { name }, limit: 1 });
  if (q.data && q.data.length) return q.data[0].id.record_id;
  const c = await attio("POST", "/objects/companies/records", { data: { values: { name: [{ value: name }] } } });
  return c.data.id.record_id;
}
async function linkPersonCompany(personId, companyId) {
  await attio("PATCH", `/objects/people/records/${personId}`, { data: { values: { company: [{ target_object: "companies", target_record_id: companyId }] } } });
}
async function upsertEntry(list, companyId, stage, icp) {
  const entry_values = {};
  if (stage) entry_values.campagna_1 = [{ status: stage }];
  if (icp) entry_values.icp = [{ option: icp }];
  await attio("POST", `/lists/${list}/entries`, { data: { parent_object: "companies", parent_record_id: companyId, entry_values } });
}

export default async function handler(req, res) {
  try {
    const { secret, c, offset } = req.query;
    if (secret !== SECRET) return res.status(403).json({ error: "secret errato" });
    const job = JOBS[c];
    if (!job) return res.status(400).json({ error: "usa ?c=nautico|icp1|icp2|icp3" });
    if (!LEMLIST_KEY || !ATTIO_KEY) return res.status(500).json({ error: "manca LEMLIST_API_KEY o ATTIO_API_KEY su Vercel" });

    const csv = await lemlistCSV(`/campaigns/${job.campaign}/export/leads?state=all`);
    const rows = parseCSV(csv);
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name) => header.indexOf(name);
    const iEmail = col("email"), iFirst = col("firstname"), iLast = col("lastname"),
          iComp = col("companyname"), iLast2 = col("laststate"), iStat = col("status"), iJob = col("jobtitle");

    const start = parseInt(offset || "0", 10);
    const leads = rows.slice(1).filter((r) => r[iEmail]);
    const slice = leads.slice(start, start + BATCH);

    const out = [];
    for (const r of slice) {
      const email = (r[iEmail] || "").trim();
      try {
        const personId = await upsertPerson(email, r[iFirst], r[iLast], iJob >= 0 ? r[iJob] : "");
        const compName = (r[iComp] || "").trim() || `${r[iFirst] || ""} ${r[iLast] || ""}`.trim() || email;
        const companyId = await findOrCreateCompany(compName);
        await linkPersonCompany(personId, companyId);
        const stage = mapStage(iLast2 >= 0 ? r[iLast2] : "", iStat >= 0 ? r[iStat] : "");
        await upsertEntry(job.list, companyId, stage, job.icp);
        out.push({ email, stage, ok: true });
      } catch (e) { out.push({ email, ok: false, error: String(e.message || e) }); }
    }
    const done = start + slice.length;
    return res.status(200).json({
      campaign: c, processed: slice.length, from: start, done,
      total: leads.length,
      nextUrl: done < leads.length ? `/api/sync-lemlist?secret=${SECRET}&c=${c}&offset=${done}` : null,
      results: out,
    });
  } catch (err) { console.error(err); return res.status(500).json({ error: String(err.message || err) }); }
}
