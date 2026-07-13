// Vercel serverless function: aggrega le due liste Attio in un'unica risposta
// per la dashboard. Cache lato edge 60s per non martellare l'API Attio.
// Env variable richiesta: ATTIO_API_KEY (impostala nel dashboard Vercel).

const ATTIO_TOKEN = process.env.ATTIO_API_KEY;
const LIST_RIATT = "outbound_fiere_2";   // slug Attio per "Riattivazioni"
const LIST_FIERE = "riattivazione_demo"; // slug Attio per "Outbound Fiere"

async function attioFetch(path, body) {
  const res = await fetch(`https://api.attio.com/v2${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ATTIO_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Attio ${path} → ${res.status}: ${t}`);
  }
  return res.json();
}

// Estrae un valore leggibile da un attribute value di Attio.
// Gli attributi in Attio sono array di value objects; per status/select
// il titolo sta in .status.title o .option.title o .value.
function readAttr(entryValues, slug) {
  const arr = entryValues && entryValues[slug];
  if (!arr || !arr.length) return null;
  const v = arr[0];
  return (
    (v.status && v.status.title) ||
    (v.option && v.option.title) ||
    v.value ||
    null
  );
}

async function fetchAllEntries(listSlug) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < 40; page++) {
    const json = await attioFetch(`/lists/${listSlug}/entries/query`, {
      limit: 50,
      offset,
    });
    const data = json.data || [];
    all.push(
      ...data.map((e) => ({
        entry_id: e.id && e.id.entry_id,
        record_id:
          (e.parent_record_id) ||
          (e.parent_record && e.parent_record.record_id),
        stage: readAttr(e.entry_values, "outreach") || "Da contattare",
        fiera: readAttr(e.entry_values, "fiera") || "Non assegnato",
        priority: readAttr(e.entry_values, "priority"),
        gestito_da: readAttr(e.entry_values, "gestito_da"),
      }))
    );
    if (data.length < 50) break;
    offset += 50;
  }
  return all;
}

export default async function handler(req, res) {
  if (!ATTIO_TOKEN) {
    return res.status(500).json({
      error:
        "ATTIO_API_KEY non configurato. Vai su Vercel → Project → Settings → Environment Variables e aggiungilo.",
    });
  }
  try {
    const [riatt, fiere] = await Promise.all([
      fetchAllEntries(LIST_RIATT),
      fetchAllEntries(LIST_FIERE),
    ]);
    // Edge cache: 60s fresh, 5 minuti stale-while-revalidate.
    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );
    return res.status(200).json({
      riatt,
      fiere,
      counts: { riatt: riatt.length, fiere: fiere.length },
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
