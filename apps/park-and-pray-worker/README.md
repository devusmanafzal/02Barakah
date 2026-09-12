# Park & Pray Worker

This Cloudflare Worker owns the single shared parking reservation. Its Durable Object transaction ensures only one concurrent booking succeeds.

## Deploy

```sh
cd apps/park-and-pray-worker
npm install
npx wrangler login
npm run deploy
```

Copy the deployed `workers.dev` URL into `apiUrl` in `../park-and-pray/parking-slots.json`, then publish the site again.

The API stores only the reservation ID, slot ID, prayer ID, and timestamps. Names and phone numbers remain in the visitor's browser.