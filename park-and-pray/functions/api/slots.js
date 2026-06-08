// Park & Pray — tiny KV-backed API (no database, no accounts)
// One KV key ("slots") holds a small JSON array of spots.
// A reservation is just three fields on a spot; it auto-expires after 60 min.

const KEY = "slots";
const HOLD_MS = 60 * 60 * 1000; // 60 minutes

function firstSpot() {
  return {
    id: crypto.randomUUID(),
    label: "Spot 1",
    owner: "Usman Afzal",
    note: "A private spot, kindly shared for prayer times.",
    reservedName: null,
    reservedPhone: null,
    reservedUntil: null, // epoch ms
  };
}

// Read all spots, lazily clearing any expired reservation.
async function readSlots(env) {
  const raw = await env.PARKING.get(KEY);
  if (!raw) {
    const slots = [firstSpot()];
    await env.PARKING.put(KEY, JSON.stringify(slots));
    return slots;
  }
  const slots = JSON.parse(raw);
  const now = Date.now();
  let changed = false;
  for (const s of slots) {
    if (s.reservedUntil && s.reservedUntil <= now) {
      s.reservedName = null;
      s.reservedPhone = null;
      s.reservedUntil = null;
      changed = true;
    }
  }
  if (changed) await env.PARKING.put(KEY, JSON.stringify(slots));
  return slots;
}

// What the public sees — note we DO NOT expose reservers' phone numbers.
function publicView(slots) {
  const now = Date.now();
  return slots.map((s) => {
    const reserved = s.reservedUntil && s.reservedUntil > now;
    return {
      id: s.id,
      label: s.label,
      owner: s.owner,
      note: s.note ?? null,
      status: reserved ? "reserved" : "available",
      reservedName: reserved ? s.reservedName : null,
      reservedUntil: reserved ? s.reservedUntil : null,
    };
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ env }) {
  if (!env.PARKING) return json({ error: "KV namespace 'PARKING' is not bound." }, 500);
  const slots = await readSlots(env);
  return json({ slots: publicView(slots) });
}

export async function onRequestPost({ request, env }) {
  if (!env.PARKING) return json({ error: "KV namespace 'PARKING' is not bound." }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const slots = await readSlots(env);
  const now = Date.now();
  const action = body.action;

  if (action === "reserve") {
    const { id, name, phone } = body;
    if (!name || !phone) return json({ error: "Please enter your name and phone number." }, 400);
    const slot = slots.find((s) => s.id === id);
    if (!slot) return json({ error: "That spot no longer exists." }, 404);
    if (slot.reservedUntil && slot.reservedUntil > now)
      return json({ error: "Sorry — that spot was just taken." }, 409);
    slot.reservedName = String(name).trim().slice(0, 60);
    slot.reservedPhone = String(phone).trim().slice(0, 40);
    slot.reservedUntil = now + HOLD_MS;
    await env.PARKING.put(KEY, JSON.stringify(slots));
    return json({ slots: publicView(slots) });
  }

  if (action === "release") {
    const { id, phone, adminKey } = body;
    const slot = slots.find((s) => s.id === id);
    if (!slot) return json({ error: "That spot no longer exists." }, 404);
    const isAdmin = adminKey && env.ADMIN_KEY && adminKey === env.ADMIN_KEY;
    const phoneMatch =
      phone && slot.reservedPhone && String(phone).trim() === slot.reservedPhone;
    if (!isAdmin && !phoneMatch)
      return json({ error: "To release, enter the phone number used to reserve it." }, 403);
    slot.reservedName = null;
    slot.reservedPhone = null;
    slot.reservedUntil = null;
    await env.PARKING.put(KEY, JSON.stringify(slots));
    return json({ slots: publicView(slots) });
  }

  if (action === "add") {
    const { label, owner, note, adminKey } = body;
    if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY)
      return json({ error: "Incorrect admin key." }, 403);
    if (!label) return json({ error: "Please give the spot a name." }, 400);
    slots.push({
      id: crypto.randomUUID(),
      label: String(label).trim().slice(0, 60),
      owner: owner ? String(owner).trim().slice(0, 60) : "Community",
      note: note ? String(note).trim().slice(0, 160) : null,
      reservedName: null,
      reservedPhone: null,
      reservedUntil: null,
    });
    await env.PARKING.put(KEY, JSON.stringify(slots));
    return json({ slots: publicView(slots) });
  }

  if (action === "remove") {
    const { id, adminKey } = body;
    if (!env.ADMIN_KEY || adminKey !== env.ADMIN_KEY)
      return json({ error: "Incorrect admin key." }, 403);
    const idx = slots.findIndex((s) => s.id === id);
    if (idx === -1) return json({ error: "That spot no longer exists." }, 404);
    slots.splice(idx, 1);
    await env.PARKING.put(KEY, JSON.stringify(slots));
    return json({ slots: publicView(slots) });
  }

  return json({ error: "Unknown action." }, 400);
}
