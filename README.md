# Komete · Dashboard Liste — Deploy su Vercel

Landing 24/7 che replica la slide 8 del report Liste e tira i numeri in tempo reale dalle due liste attive su Attio (**Riattivazioni** e **Outbound Fiere**).

## Cosa contiene questa cartella

```
komete-dashboard-vercel/
├── index.html            # la dashboard (front-end, self-contained)
├── api/
│   └── data.js           # serverless function che parla con Attio
├── package.json
├── vercel.json           # config Vercel (URL puliti, timeout function)
├── .gitignore
├── .env.local.example    # template per il token in locale
└── README.md             # questo file
```

## Come funziona

- La `index.html` fa una chiamata `fetch('/api/data')` al caricamento.
- La serverless function `api/data.js` gira su Vercel, legge `ATTIO_API_KEY` dalle env variables e chiama `https://api.attio.com/v2/lists/{slug}/entries/query` per le due liste.
- La risposta è cachata 60 secondi sull'edge Vercel (parametro tunable in `api/data.js`) per non martellare l'API Attio.
- La pagina si auto-refresha ogni 5 minuti in background.

## Deploy step-by-step

### 1. Prerequisiti

- Un account **GitHub** (gratis).
- Un account **Vercel** (gratis, si logga con GitHub).
- Il token API di Attio con permessi read sulle liste (già generato — quello che inizia per `sk-...`).

### 2. Push del repo su GitHub

Dal terminale, dentro questa cartella:

```bash
git init
git add .
git commit -m "Komete dashboard — initial"
```

Poi crea un repo vuoto su GitHub (privato, chiamalo `komete-dashboard`) e collega:

```bash
git remote add origin git@github.com:<tuo-user>/komete-dashboard.git
git branch -M main
git push -u origin main
```

### 3. Deploy su Vercel

1. Vai su [vercel.com/new](https://vercel.com/new).
2. **Import Git Repository** → seleziona `komete-dashboard`.
3. Nella pagina di configurazione:
   - **Framework Preset**: `Other` (è già HTML statico + function).
   - **Root Directory**: lascia `./`.
   - **Environment Variables**: aggiungi
     - `Name` = `ATTIO_API_KEY`
     - `Value` = il tuo token Attio (`sk-...`)
     - `Environment` = `Production, Preview, Development` (tutti e tre)
4. Click **Deploy**.

Dopo ~30 secondi Vercel ti dà un URL tipo `https://komete-dashboard-<hash>.vercel.app`. Aprilo: la dashboard carica i dati live.

### 4. (Opzionale) Password protection

Se vuoi che il link non sia aperto a tutti:

- **Piano Hobby (free)**: Project → Settings → Deployment Protection → **Vercel Authentication**. Chi apre l'URL deve loggarsi con un account Vercel invitato al progetto.
- **Piano Pro**: puoi mettere una password unica per il deployment con **Password Protection**.

In alternativa, si aggiunge un middleware basic-auth di ~10 righe (dimmelo se ti serve).

### 5. (Opzionale) Dominio custom

Project → Settings → Domains → aggiungi `dashboard.komete.io` (o quello che preferisci). Vercel ti dà i record DNS da mettere nel gestore del dominio Komete.

## Sviluppo in locale (opzionale)

Se vuoi provare localmente prima di deployare:

```bash
npm i -g vercel
cp .env.local.example .env.local
# apri .env.local e metti il tuo ATTIO_API_KEY
vercel dev
```

Apri `http://localhost:3000`.

## Personalizzazioni rapide

### Cambiare la cache

In `api/data.js` alla riga con `s-maxage=60`, alza/abbassa il valore. `s-maxage=300` = 5 minuti.

### Cambiare le liste

In `api/data.js` in cima:

```js
const LIST_RIATT = "outbound_fiere_2";
const LIST_FIERE = "riattivazione_demo";
```

Sono i **slug** delle liste Attio (li vedi nel workspace, oppure li si ricava da `GET /v2/lists`).

### Cambiare la frequenza di auto-refresh

In `index.html`, ultima riga:

```js
setInterval(() => { loadAll().catch(() => {}); }, 5 * 60 * 1000);
```

`5 * 60 * 1000` = 5 minuti. Metti `60 * 1000` per 1 minuto.

## Troubleshooting

**"Errore nel caricamento dati da Attio"** in pagina
→ Controlla su Vercel → Project → Deployments → l'ultimo deployment → View Function Logs. Vedrai il messaggio esatto dell'errore Attio.

**"ATTIO_API_KEY non configurato"**
→ Env variable non impostata. Settings → Environment Variables → aggiungi e ridi-eploy.

**403 / 401 da Attio**
→ Token scaduto o senza permessi. Rigenera il token su Attio (Settings → Developers → API) con scope `list_configuration:read`, `list_entries:read`, `record_permission:read`, `object_configuration:read`.

**Numeri non aggiornati**
→ La cache Vercel è a 60 secondi. Se hai appena modificato uno stage su Attio, aspetta 1 minuto e ricarica. Oppure abbassa la cache come sopra.

## Costi

- **Vercel Hobby (free)**: ampiamente sufficiente. Bandwidth 100 GB/mese, 100 GB-hours di function execution.
- **Attio API**: incluso nel piano workspace, nessun costo aggiuntivo per queste chiamate.

Se la dashboard viene aperta da >10-20 persone al giorno di continuo, monitora il tab **Usage** su Vercel. Con la cache di 60 secondi non dovresti mai avvicinarti ai limiti.
