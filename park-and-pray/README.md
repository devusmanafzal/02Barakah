# Park & Pray 🕌🚗

A tiny, mobile-first community parking app: people reserve a shared spot for **60 minutes**
so they can park and make it to Salah on time. No accounts, no traditional database — just
**Cloudflare Pages** for the page and **Cloudflare KV** (one key) for the shared state.

```
park-and-pray/
├── index.html            ← the whole app (one file)
├── functions/
│   └── api/
│       └── slots.js       ← the only backend code (KV-powered)
├── wrangler.toml          ← Pages + KV config
└── README.md
```

## How it works (in one paragraph)
The page calls `/api/slots`. A single KV key named `slots` stores a small JSON list of spots.
Reserving sets a name, phone, and an expiry 60 minutes out. Any read past that time clears the
hold automatically, so spots **release themselves** — no scheduled jobs needed. Phone numbers are
stored but never shown publicly; they're only used to let the reserver (or you, the admin) release.

> **Preview before deploying:** open `index.html` in a browser and it runs in *Preview mode*
> using your device's local storage (admin key is the word `demo`). Once deployed with KV bound,
> it switches automatically to the live, shared store.

---

## Deploy — Option A: Dashboard (easiest, like your other sites)

1. **Create the KV namespace**
   Cloudflare dashboard → *Storage & Databases → KV → Create namespace*, name it `PARKING`.

2. **Create the Pages project**
   *Workers & Pages → Create → Pages.* Connect this folder via Git, **or** drag-and-drop the folder
   (Direct Upload). No build command needed; framework preset = **None**.

3. **Bind KV to the project**
   Project → *Settings → Bindings (Functions) → Add → KV namespace.*
   - Variable name: `PARKING`
   - Namespace: the `PARKING` one you made in step 1.

4. **Set your admin key (secret)**
   Project → *Settings → Variables and Secrets → Add* → name `ADMIN_KEY`, value = a password only
   you know. This is what unlocks "Add / manage spots."

5. **Redeploy** (so the new bindings take effect). Done — visit your `*.pages.dev` URL. 🎉

---

## Deploy — Option B: CLI (Wrangler)

```bash
# from inside the park-and-pray/ folder
npm install -g wrangler          # if you don't have it
wrangler login

# 1) create the KV namespace, then paste the printed id into wrangler.toml
wrangler kv namespace create PARKING

# 2) set your admin secret
wrangler pages secret put ADMIN_KEY

# 3) deploy this folder
wrangler pages deploy .
```

---

## Linking from 02Barakah
On your Barakah "Tools" card for **Park & Pray**, point the link at the deployed URL
(your `*.pages.dev` address, or a custom subdomain like `park.02barakah.com`).
The app already links **back** to `https://www.02Barakah.com` in its header and footer.

## Everyday use
- **Reserve:** tap a spot → name + phone → it's yours for 60 min.
- **Release:** tap *Release* and enter the phone you reserved with (or your admin key).
- **Add a spot:** tap *“+ Add or manage spots”*, enter your admin key, fill in the details.
- It starts with one spot (**Spot 1**, owner *Usman Afzal*); add more anytime.

## Growing later (it's built to expand)
- More spots: just keep adding them — the same single KV key holds them all.
- Real accounts / many owners / spot photos: when you outgrow this, migrate the `/api/slots`
  function to **D1** (SQL) or **Supabase**. Because the page only talks to your own `/api/slots`
  endpoint, the front-end barely changes.

_Keep in Prayers 🙏 · Usman Afzal_
