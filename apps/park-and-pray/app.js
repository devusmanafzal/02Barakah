"use strict";

const STORAGE_KEY = "park-and-pray-local-reservations-v1";
const CONTACT_KEY = "park-and-pray-local-contact-v1";
const RESERVATION_DURATION_MS = 60 * 60 * 1000;

const state = {
  config: null,
  prayerId: null,
  reservations: readStorage(STORAGE_KEY, []),
  sharedReservation: null,
  apiReady: false,
};

const elements = {
  todayDate: document.getElementById("today-date"),
  communityName: document.getElementById("community-name"),
  prayerTabs: document.getElementById("prayer-tabs"),
  prayerDisclaimer: document.getElementById("prayer-disclaimer"),
  availability: document.getElementById("availability"),
  slotList: document.getElementById("slot-list"),
  message: document.getElementById("message"),
  backdrop: document.getElementById("booking-backdrop"),
  closeBooking: document.getElementById("close-booking"),
  bookingPrayer: document.getElementById("booking-prayer"),
  bookingTitle: document.getElementById("booking-title"),
  bookingSlotId: document.getElementById("booking-slot-id"),
  bookingForm: document.getElementById("booking-form"),
  memberName: document.getElementById("member-name"),
  memberPhone: document.getElementById("member-phone"),
  formError: document.getElementById("form-error"),
};

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    showMessage("This browser blocked local storage, so the parking reservation could not be saved.", true);
    return false;
  }
}

async function apiRequest(path, options = {}) {
  const configuredUrl = state.config.apiUrl?.trim().replace(/\/$/, "");
  const localApiUrl = ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:8787"
    : "";
  const apiUrl = configuredUrl || localApiUrl;
  if (!apiUrl) throw new Error("The shared booking service is not configured yet.");

  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers,
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "The shared booking service could not complete the request.");
    error.status = response.status;
    error.details = result;
    throw error;
  }
  return result;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function localParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: state.config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isFriday() {
  return new Intl.DateTimeFormat("en", { timeZone: state.config.timeZone, weekday: "long" }).format(new Date()) === "Friday";
}

function displayPrayerName(prayer) {
  const fridayPrayer = state.config.fridayPrayer;
  return isFriday() && fridayPrayer && prayer.id === fridayPrayer.replacePrayerId
    ? fridayPrayer.name
    : prayer.name;
}

function renderToday() {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: state.config.timeZone,
    weekday: "long",
    day: "numeric",
    month: "short",
  }).formatToParts(now);
  const values = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  elements.todayDate.textContent = `${values.weekday}, ${values.day} ${values.month}`;
  elements.todayDate.dateTime = localDateKey();
}

function localDateKey() {
  const parts = localParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localMinuteOfDay() {
  const parts = localParts(new Date());
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function minutesFromTime(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function safeImagePath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const path = value.trim();
  return /^(?:[a-z]+:|\/\/|\/|\.\.)/i.test(path) ? null : path;
}

function mapUrlFor(slot) {
  if (state.config.mapEnabled !== true || slot.mapEnabled === false) return null;
  if (typeof slot.mapUrl === "string" && /^https:\/\//i.test(slot.mapUrl.trim())) return slot.mapUrl.trim();
  if (typeof slot.mapAddress === "string" && slot.mapAddress.trim()) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(slot.mapAddress.trim())}`;
  }
  if (Number.isFinite(slot.latitude) && Number.isFinite(slot.longitude)) {
    const destination = encodeURIComponent(`${slot.latitude},${slot.longitude}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  }
  return null;
}

function isPrayerOpen(prayer) {
  if (state.config.testMode === true) return true;
  const startMinute = minutesFromTime(prayer.startTime);
  let endMinute = minutesFromTime(prayer.endTime);
  if (endMinute < startMinute) endMinute += 24 * 60;
  const bookingStart = startMinute - state.config.bookingPaddingMinutesBefore;
  const bookingEnd = endMinute + state.config.bookingPaddingMinutesAfter;
  const currentMinute = localMinuteOfDay();
  return [currentMinute - 24 * 60, currentMinute, currentMinute + 24 * 60]
    .some((minute) => minute >= bookingStart && minute <= bookingEnd);
}

function currentPrayer() {
  return state.config.prayers.find(isPrayerOpen) || null;
}

function validateConfig(config) {
  if (!config || !Array.isArray(config.prayers) || !Array.isArray(config.slots)) {
    throw new Error("The parking configuration is incomplete.");
  }
  const prayerIds = new Set();
  if (!Number.isFinite(config.bookingPaddingMinutesBefore) || config.bookingPaddingMinutesBefore < 0
    || !Number.isFinite(config.bookingPaddingMinutesAfter) || config.bookingPaddingMinutesAfter < 0) {
    throw new Error("The prayer booking window is invalid.");
  }
  const timePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  config.prayers.forEach((prayer) => {
    if (!prayer.id || !prayer.name || !timePattern.test(prayer.startTime) || !timePattern.test(prayer.endTime)
      || prayer.startTime === prayer.endTime || prayerIds.has(prayer.id)) {
      throw new Error("A prayer entry is invalid or duplicated.");
    }
    prayerIds.add(prayer.id);
  });
  const slotIds = new Set();
  config.slots.forEach((slot) => {
    if (!slot.id || !slot.label || slotIds.has(slot.id)) throw new Error("A parking slot ID is invalid or duplicated.");
    slotIds.add(slot.id);
  });
  new Intl.DateTimeFormat("en", { timeZone: config.timeZone }).format();
  return config;
}

function pruneReservations() {
  const now = Date.now();
  const previousReservations = JSON.stringify(state.reservations);
  const activeReservations = state.reservations
    .map((reservation) => {
      if (reservation.expiresAt) return reservation;
      const createdTime = Date.parse(reservation.createdAt);
      return { ...reservation, expiresAt: new Date(createdTime + RESERVATION_DURATION_MS).toISOString() };
    })
    .filter((reservation) => Number.isFinite(Date.parse(reservation.expiresAt)) && Date.parse(reservation.expiresAt) > now);
  state.reservations = activeReservations;
  if (JSON.stringify(activeReservations) !== previousReservations) writeStorage(STORAGE_KEY, activeReservations);
}

function reservationFor(slotId) {
  const shared = sharedReservationFor(slotId);
  if (!shared) return null;
  return state.reservations.find((reservation) => reservation.id === shared.id) || null;
}

function reservationForPrayer() {
  const shared = activeSharedReservation();
  if (!shared) return null;
  return state.reservations.find((reservation) => reservation.id === shared.id) || null;
}

function activeSharedReservation() {
  return state.sharedReservation && Date.parse(state.sharedReservation.expiresAt) > Date.now()
    ? state.sharedReservation
    : null;
}

function sharedReservationFor(slotId) {
  const reservation = activeSharedReservation();
  return reservation?.slotId === slotId ? reservation : null;
}

async function refreshSharedReservation(showErrors = false) {
  const previousSharedReservation = JSON.stringify(state.sharedReservation);
  const previousReservations = JSON.stringify(state.reservations);
  const wasApiReady = state.apiReady;
  try {
    const localId = state.reservations[0]?.id;
    const result = await apiRequest("/status", {
      headers: localId ? { "X-Reservation-Id": localId } : undefined,
    });
    state.sharedReservation = result.reservation || null;
    state.apiReady = true;

    const sharedId = state.sharedReservation?.owned ? state.sharedReservation.id : null;
    const localReservations = state.reservations.filter((reservation) => reservation.id === sharedId);
    if (localReservations.length !== state.reservations.length) {
      state.reservations = localReservations;
      writeStorage(STORAGE_KEY, state.reservations);
    }
  } catch (error) {
    state.apiReady = false;
    if (showErrors) showMessage(error.message, true);
  }
  const reservationChanged = previousSharedReservation !== JSON.stringify(state.sharedReservation)
    || previousReservations !== JSON.stringify(state.reservations);
  if (state.config && (reservationChanged || wasApiReady !== state.apiReady)) renderSlots();
}

function remainingTime(reservation) {
  const totalSeconds = Math.max(0, Math.ceil((Date.parse(reservation.expiresAt) - Date.now()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function releaseTime(reservation) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: state.config.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(reservation.expiresAt));
}

function updateReleaseTimers() {
  elements.slotList.querySelectorAll("[data-expires-at]").forEach((timer) => {
    const countdown = timer.querySelector("span");
    if (countdown) countdown.textContent = remainingTime({ expiresAt: timer.dataset.expiresAt });
  });
}

function renderPrayers() {
  const openPrayer = currentPrayer();
  const selectedPrayer = state.config.prayers.find((prayer) => prayer.id === state.prayerId);
  state.prayerId = state.config.testMode && selectedPrayer ? selectedPrayer.id : openPrayer?.id || null;
  elements.prayerTabs.innerHTML = state.config.prayers.map((prayer) => {
    const active = prayer.id === state.prayerId;
    const disabled = state.config.testMode !== true && !active;
    return `<button class="prayer-tab${active ? " active" : ""}" type="button" role="tab" data-prayer-id="${escapeHtml(prayer.id)}" aria-selected="${active}" ${disabled ? "disabled" : ""}>
      <strong>${escapeHtml(displayPrayerName(prayer))}</strong>
    </button>`;
  }).join("");
}

function renderSlots() {
  const enabledCount = state.config.slots.filter((slot) => slot.enabled !== false).length;
  const bookingOpen = Boolean(currentPrayer());
  const ownReservation = reservationForPrayer();
  const sharedReservation = activeSharedReservation();
  elements.availability.textContent = !state.apiReady
    ? "Connecting..."
    : sharedReservation ? "Parking reserved" : bookingOpen ? `${enabledCount} available` : "Booking closed";

  elements.slotList.innerHTML = state.config.slots.map((slot) => {
    const saved = reservationFor(slot.id);
    const shared = sharedReservationFor(slot.id);
    const enabled = slot.enabled !== false;
    const className = saved ? "slot-card saved" : shared || !enabled ? "slot-card disabled" : "slot-card";
    const status = shared ? "Reserved" : enabled ? "Available" : "Unavailable";
    const statusClass = shared || !enabled ? "status unavailable" : "status";
    const imagePath = safeImagePath(slot.image);
    const mapUrl = mapUrlFor(slot);
    const photo = imagePath
      ? `<div class="slot-photo"><img src="${escapeHtml(imagePath)}" alt="${escapeHtml(slot.label)} parking location" loading="lazy"><span>${escapeHtml(slot.id)}</span></div>`
      : `<div class="slot-photo image-missing" aria-label="No parking photo added"><span>${escapeHtml(slot.id)}</span></div>`;
    const mapAction = mapUrl
      ? `<a class="map-button" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open directions to ${escapeHtml(slot.label)}">Directions</a>`
      : "";
    const releaseTimer = shared
      ? `<div class="release-timer" data-expires-at="${escapeHtml(shared.expiresAt)}"><strong>Releases in</strong><span>${remainingTime(shared)}</span><small>at ${releaseTime(shared)}</small></div>`
      : "";
    let action;
    if (saved) {
      action = `<button class="action-button remove" type="button" data-remove-id="${escapeHtml(saved.id)}">Remove</button>`;
    } else if (shared) {
      action = `<button class="action-button" type="button" disabled>Reserved</button>`;
    } else {
      const disabled = !enabled || !bookingOpen || ownReservation || !state.apiReady;
      const label = !state.apiReady ? "Wait" : bookingOpen ? "Choose" : "Closed";
      action = `<button class="action-button" type="button" data-slot-id="${escapeHtml(slot.id)}" ${disabled ? "disabled" : ""}>${label}</button>`;
    }
    return `<article class="${className}">
      ${photo}
      <div class="slot-copy">
        <div class="slot-heading"><h3>${escapeHtml(slot.label)}</h3><span class="${statusClass}">${status}</span></div>
        <p>${escapeHtml(slot.description || "Community parking space")}</p>
        ${releaseTimer}
      </div>
      <div class="slot-actions">${mapAction}${action}</div>
    </article>`;
  }).join("");

  elements.slotList.querySelectorAll(".slot-photo img").forEach((image) => {
    image.addEventListener("error", () => {
      image.parentElement.classList.add("image-missing");
      image.remove();
    }, { once: true });
  });
}

function render() {
  renderPrayers();
  renderSlots();
}

function showMessage(text, isError) {
  elements.message.textContent = text;
  elements.message.className = isError ? "message error" : "message";
  elements.message.hidden = false;
}

function hideMessage() {
  elements.message.hidden = true;
}

function openBooking(slotId) {
  const slot = state.config.slots.find((item) => item.id === slotId);
  const prayer = state.config.prayers.find((item) => item.id === state.prayerId);
  if (!slot || !prayer || !isPrayerOpen(prayer) || !state.apiReady || activeSharedReservation()) return;
  const contact = readStorage(CONTACT_KEY, {});
  elements.bookingSlotId.value = slot.id;
  elements.bookingPrayer.textContent = displayPrayerName(prayer);
  elements.bookingTitle.textContent = `Save ${slot.label}`;
  elements.memberName.value = contact.name || "";
  elements.memberPhone.value = contact.phone || "";
  elements.formError.hidden = true;
  elements.backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  window.setTimeout(() => elements.memberName.focus(), 0);
}

function closeBooking() {
  elements.backdrop.hidden = true;
  document.body.style.overflow = "";
}

async function saveReservation(event) {
  event.preventDefault();
  const name = elements.memberName.value.trim();
  const phone = elements.memberPhone.value.trim();
  const prayer = state.config.prayers.find((item) => item.id === state.prayerId);
  if (!prayer || !isPrayerOpen(prayer)) {
    elements.formError.textContent = "The booking window for this prayer has closed.";
    elements.formError.hidden = false;
    return;
  }
  if (name.length < 2 || phone.replace(/\D/g, "").length < 7) {
    elements.formError.textContent = "Enter your name and a valid mobile number.";
    elements.formError.hidden = false;
    return;
  }
  if (reservationForPrayer()) {
    elements.formError.textContent = "Parking is already reserved on this phone.";
    elements.formError.hidden = false;
    return;
  }
  const reservation = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    date: localDateKey(),
    prayerId: state.prayerId,
    slotId: elements.bookingSlotId.value,
    name,
    phone,
  };
  const submitButton = elements.bookingForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  elements.formError.hidden = true;

  try {
    const result = await apiRequest("/reserve", {
      method: "POST",
      body: JSON.stringify({ id: reservation.id, slotId: reservation.slotId, prayerId: reservation.prayerId }),
    });
    const localReservation = { ...reservation, ...result.reservation };
    state.sharedReservation = result.reservation;
    state.reservations = [localReservation];
    if (!writeStorage(STORAGE_KEY, state.reservations)) {
      await apiRequest("/release", { method: "POST", body: JSON.stringify({ id: reservation.id }) }).catch(() => {});
      return;
    }
    writeStorage(CONTACT_KEY, { name, phone });
    closeBooking();
    render();
    showMessage("Parking reserved for 1 hour. Other visitors can now see it is unavailable.", false);
  } catch (error) {
    if (error.details?.reservation) state.sharedReservation = error.details.reservation;
    elements.formError.textContent = error.message;
    elements.formError.hidden = false;
    renderSlots();
  } finally {
    submitButton.disabled = false;
  }
}

async function removeReservation(id) {
  try {
    await apiRequest("/release", { method: "POST", body: JSON.stringify({ id }) });
    state.sharedReservation = null;
    state.reservations = state.reservations.filter((reservation) => reservation.id !== id);
    writeStorage(STORAGE_KEY, state.reservations);
    render();
    showMessage("Parking reservation removed and available to other visitors.", false);
  } catch (error) {
    showMessage(error.message, true);
    await refreshSharedReservation();
  }
}

async function start() {
  try {
    const response = await fetch("parking-slots.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Parking settings could not be loaded.");
    state.config = validateConfig(await response.json());
    document.title = state.config.siteName;
    elements.communityName.textContent = state.config.communityName;
    if (state.config.testMode === true) {
      elements.prayerDisclaimer.textContent = "Test mode is active: booking is open for every prayer at any time.";
    }
    renderToday();
    state.prayerId = currentPrayer()?.id || null;
    pruneReservations();
    render();
    await refreshSharedReservation(true);
  } catch (error) {
    elements.availability.textContent = "Unavailable";
    elements.slotList.innerHTML = "";
    showMessage(`${error.message} Serve this folder from GitHub Pages or another static web host.`, true);
  }
}

elements.prayerTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-prayer-id]");
  if (!button || button.disabled) return;
  const prayer = state.config.prayers.find((item) => item.id === button.dataset.prayerId);
  if (!prayer || !isPrayerOpen(prayer)) return;
  state.prayerId = prayer.id;
  hideMessage();
  render();
});

elements.slotList.addEventListener("click", (event) => {
  const chooseButton = event.target.closest("[data-slot-id]");
  const removeButton = event.target.closest("[data-remove-id]");
  if (chooseButton && !chooseButton.disabled) openBooking(chooseButton.dataset.slotId);
  if (removeButton) removeReservation(removeButton.dataset.removeId);
});

elements.closeBooking.addEventListener("click", closeBooking);
elements.backdrop.addEventListener("click", (event) => { if (event.target === elements.backdrop) closeBooking(); });
elements.bookingForm.addEventListener("submit", saveReservation);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.backdrop.hidden) closeBooking(); });

start();

window.setInterval(() => {
  const previousCount = state.reservations.length;
  pruneReservations();
  if (!state.config) return;
  if (previousCount > state.reservations.length || (state.sharedReservation && !activeSharedReservation())) {
    state.sharedReservation = null;
    renderSlots();
    if (previousCount > state.reservations.length) showMessage("Your 1-hour parking reservation has ended.", false);
  } else {
    updateReleaseTimers();
  }
}, 1000);

window.setInterval(() => {
  if (state.config) refreshSharedReservation();
}, 5000);
