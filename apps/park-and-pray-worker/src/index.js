const RESERVATION_KEY = "active-reservation";
const RESERVATION_DURATION_MS = 60 * 60 * 1000;

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function validIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function visibleReservation(reservation, ownerId) {
  if (!reservation) return null;
  const owned = reservation.id === ownerId;
  const visible = {
    slotId: reservation.slotId,
    prayerId: reservation.prayerId,
    createdAt: reservation.createdAt,
    expiresAt: reservation.expiresAt,
    owned,
  };
  if (owned) visible.id = reservation.id;
  return visible;
}

export class ParkingSlot {
  constructor(state) {
    this.storage = state.storage;
  }

  async activeReservation(transaction = this.storage) {
    const reservation = await transaction.get(RESERVATION_KEY);
    if (!reservation) return null;
    if (Date.parse(reservation.expiresAt) > Date.now()) return reservation;
    await transaction.delete(RESERVATION_KEY);
    return null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/status") {
      const reservation = await this.activeReservation();
      const ownerId = request.headers.get("X-Reservation-Id");
      return jsonResponse({ reserved: Boolean(reservation), reservation: visibleReservation(reservation, ownerId) });
    }

    if (request.method === "POST" && url.pathname === "/reserve") {
      let details;
      try {
        details = await request.json();
      } catch (error) {
        return jsonResponse({ error: "Invalid request body." }, 400);
      }

      if (!validIdentifier(details.id) || !validIdentifier(details.slotId) || !validIdentifier(details.prayerId)) {
        return jsonResponse({ error: "Reservation details are invalid." }, 400);
      }
      const durationSeconds = details.durationSeconds ?? RESERVATION_DURATION_MS / 1000;
      if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > RESERVATION_DURATION_MS / 1000) {
        return jsonResponse({ error: "Reservation duration is invalid." }, 400);
      }

      const result = await this.storage.transaction(async (transaction) => {
        const existing = await this.activeReservation(transaction);
        if (existing) return { conflict: true, reservation: existing };

        const now = Date.now();
        const reservation = {
          id: details.id,
          slotId: details.slotId,
          prayerId: details.prayerId,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + durationSeconds * 1000).toISOString(),
        };
        await transaction.put(RESERVATION_KEY, reservation);
        return { conflict: false, reservation };
      });

      return result.conflict
        ? jsonResponse({
          error: "This parking space was just reserved by another visitor.",
          reserved: true,
          reservation: visibleReservation(result.reservation),
        }, 409)
        : jsonResponse({ reserved: true, reservation: visibleReservation(result.reservation, result.reservation.id) }, 201);
    }

    if (request.method === "POST" && url.pathname === "/release") {
      let details;
      try {
        details = await request.json();
      } catch (error) {
        return jsonResponse({ error: "Invalid request body." }, 400);
      }

      if (!validIdentifier(details.id)) return jsonResponse({ error: "Reservation ID is required." }, 400);

      const released = await this.storage.transaction(async (transaction) => {
        const reservation = await this.activeReservation(transaction);
        if (!reservation || reservation.id !== details.id) return false;
        await transaction.delete(RESERVATION_KEY);
        return true;
      });

      return released
        ? jsonResponse({ reserved: false })
        : jsonResponse({ error: "This reservation cannot be released from this device." }, 409);
    }

    return jsonResponse({ error: "Not found." }, 404);
  }
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", request.headers.get("Origin") || "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Reservation-Id");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request);

    const objectId = env.PARKING_SLOT.idFromName("community-parking-slot");
    const response = await env.PARKING_SLOT.get(objectId).fetch(request);
    return withCors(response, request);
  },
};