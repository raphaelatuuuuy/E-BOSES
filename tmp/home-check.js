var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../packages/ui/src/lib/utils.ts
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
function cn(...inputs) {
  return twMerge(clsx(inputs));
}
var init_utils = __esm({
  "../../packages/ui/src/lib/utils.ts"() {
    "use strict";
  }
});

// src/lib/api.ts
function apiBaseUrl() {
  const raw = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).trim();
  if (!raw || raw === "/" || raw === "/api") return "/api";
  return raw.replace(/\/$/, "");
}
function csrfToken() {
  return document.cookie.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))?.split("=")[1];
}
function isUnsafeMethod(method) {
  return !["GET", "HEAD", "OPTIONS", "TRACE"].includes(method.toUpperCase());
}
function setAuthTokens(access) {
  accessToken = access;
}
function clearAuthTokens() {
  accessToken = null;
}
async function ensureCsrfCookie() {
  await fetch(`${apiBaseUrl()}/auth/csrf/`, {
    credentials: "include"
  });
}
async function refreshSession() {
  refreshPromise ??= apiRequest(
    "/auth/refresh/",
    { method: "POST" },
    { auth: false, refreshOnUnauthorized: false, csrf: true }
  ).then((result) => {
    if (!result) return null;
    setAuthTokens(result.access);
    return result;
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}
function errorMessage(data, fallback) {
  if (data && typeof data === "object") {
    const detail = data.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first === "string") return first;
    }
    for (const value of Object.values(data)) {
      if (typeof value === "string" && value.trim()) return value;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.trim()) return item;
          if (Array.isArray(item) && typeof item[0] === "string") return item[0];
        }
      }
    }
  }
  return fallback;
}
function isNetworkFetchError(error) {
  if (!(error instanceof Error)) return false;
  const msg = (error.message || "").toLowerCase();
  return error.name === "TypeError" || msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed") || msg.includes("load failed") || msg.includes("fetch failed");
}
function networkErrorMessage(error) {
  void error;
  const base = apiBaseUrl();
  return `Cannot reach the API (${base}). Make sure the backend is running (usually on port 8000) and the Vite proxy can reach it, then refresh. For phones on Wi\u2011Fi, open the HTTPS Vite URL (not :8000) so location APIs work in a secure context.`;
}
async function request(path, init, options) {
  const headers = new Headers(init.headers);
  const isFormData = init.body instanceof FormData;
  const method = init.method ?? "GET";
  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth !== false && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (options.csrf && isUnsafeMethod(method)) {
    let token = csrfToken();
    if (!token) {
      await ensureCsrfCookie();
      token = csrfToken();
    }
    if (token) {
      headers.set("X-CSRFToken", decodeURIComponent(token));
    }
  }
  const timeoutMs = options.timeoutMs;
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller && timeoutMs ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers,
      credentials: "include",
      signal: controller?.signal ?? init.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "The server took too long to respond (OCR can be slow). Keep the API running and try again with a clearer, smaller photo.",
        0,
        { message: "Request timed out." }
      );
    }
    if (isNetworkFetchError(error)) {
      throw new ApiError(networkErrorMessage(error), 0, {
        message: networkErrorMessage(error),
        reasons: ["Network error \u2014 API unreachable."]
      });
    }
    throw error;
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  }
  if (response.status === 204) {
    return void 0;
  }
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new ApiError(errorMessage(data, "Request failed."), response.status, data);
  }
  return data;
}
async function apiRequest(path, init = {}, options = {}) {
  try {
    return await request(path, init, options);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && options.auth !== false && options.refreshOnUnauthorized !== false) {
      try {
        await refreshSession();
      } catch {
        clearAuthTokens();
        throw error;
      }
      return request(path, init, { ...options, refreshOnUnauthorized: false });
    }
    throw error;
  }
}
var DEFAULT_API_BASE_URL, CSRF_COOKIE_NAME, accessToken, refreshPromise, ApiError;
var init_api = __esm({
  "src/lib/api.ts"() {
    DEFAULT_API_BASE_URL = "/api";
    CSRF_COOKIE_NAME = "csrftoken";
    accessToken = null;
    refreshPromise = null;
    ApiError = class extends Error {
      status;
      data;
      constructor(message, status, data) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
      }
    };
  }
});

// src/features/dashboard/components/location-picker.tsx
var location_picker_exports = {};
__export(location_picker_exports, {
  default: () => LocationPickerModal
});
import { useCallback as useCallback3, useEffect as useEffect4, useRef as useRef4, useState as useState4 } from "react";
import { createPortal as createPortal3 } from "react-dom";
import { HospitalIcon, SearchIcon as SearchIcon2, ShieldIcon, XIcon as XIcon3 } from "lucide-react";
function formatNominatimParts(data) {
  const a = data.address ?? {};
  const house = a.house_number;
  const road = a.road || a.pedestrian || a.path || a.residential;
  const primary = house && road ? `${house} ${road}` : road || a.neighbourhood || a.suburb || a.village || a.town || a.city || (data.display_name ?? "").split(",")[0]?.trim() || "Selected location";
  const secondaryBits = [
    a.suburb || a.neighbourhood || a.village,
    a.city || a.town || a.municipality || a.city_district
  ].filter(Boolean);
  const secondary = secondaryBits.filter((part, i, arr) => part !== primary && arr.indexOf(part) === i).slice(0, 2).join(", ");
  return {
    primary,
    secondary,
    full: secondary ? `${primary}, ${secondary}` : primary
  };
}
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "E-Boses/1.0 (barangay-concern-reports)"
      }
    });
    if (!res.ok) throw new Error("reverse failed");
    return formatNominatimParts(await res.json());
  } catch {
    const fallback = `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`;
    return { primary: fallback, secondary: "", full: fallback };
  }
}
function poiDivIcon(L, type) {
  const style = POI_STYLE[type] || POI_STYLE.other;
  const html = `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:${style.bg};border:2px solid #fff;box-shadow:0 0 0 1.5px ${style.ring},0 3px 10px rgba(0,0,0,0.28)">
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${style.glyph}</svg>
  </div>`;
  return L.divIcon({
    className: "eboses-poi-marker",
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    tooltipAnchor: [0, -18]
  });
}
function LocationPickerModal({
  open,
  onClose,
  onConfirm,
  initialLat,
  initialLng,
  initialAddress = ""
}) {
  const containerRef = useRef4(null);
  const mapRef = useRef4(null);
  const poiLayerRef = useRef4(null);
  const reverseTimer = useRef4(null);
  const ignoreMove = useRef4(false);
  const searchInputRef = useRef4(null);
  const [previewParts, setPreviewParts] = useState4({
    primary: initialAddress || "Move the map to adjust",
    secondary: "",
    full: initialAddress || "Move the map to adjust"
  });
  const [previewLatLng, setPreviewLatLng] = useState4(
    initialLat != null && initialLng != null ? { lat: initialLat, lng: initialLng } : null
  );
  const [geocoding, setGeocoding] = useState4(false);
  const [search, setSearch] = useState4("");
  const [results, setResults] = useState4([]);
  const [searching, setSearching] = useState4(false);
  const [searchFocused, setSearchFocused] = useState4(false);
  const [mapContext, setMapContext] = useState4(null);
  const [showPois, setShowPois] = useState4(false);
  const [locationClass, setLocationClass] = useState4(null);
  const scheduleReverseAndValidate = useCallback3((lat, lng) => {
    setPreviewLatLng({ lat, lng });
    if (reverseTimer.current) window.clearTimeout(reverseTimer.current);
    reverseTimer.current = window.setTimeout(() => {
      setGeocoding(true);
      void Promise.all([
        reverseGeocode(lat, lng),
        apiRequest("/locations/validate/", {
          method: "POST",
          body: JSON.stringify({ latitude: lat, longitude: lng })
        }).catch(
          () => ({
            status: "inside",
            zone: "unknown",
            accepted: true,
            warning: null,
            message: "",
            distance_meters: null
          })
        )
      ]).then(([parts, classification]) => {
        setPreviewParts(parts);
        setLocationClass(classification);
        setGeocoding(false);
      });
    }, 350);
  }, []);
  useEffect4(() => {
    if (!open) return;
    void apiRequest("/locations/map-context/").then(setMapContext).catch(() => setMapContext(null));
  }, [open]);
  useEffect4(() => {
    if (!open) return;
    let cancelled = false;
    let map = null;
    async function init() {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !containerRef.current) return;
      const center = initialLat != null && initialLng != null ? [initialLat, initialLng] : mapContext ? [mapContext.center.latitude, mapContext.center.longitude] : DEFAULT_CENTER;
      map = L.map(containerRef.current, {
        center,
        zoom: mapContext?.center.zoom ?? 15,
        zoomControl: false,
        attributionControl: false
      });
      L.control.zoom({ position: "topright" }).addTo(map);
      containerRef.current.querySelector(".leaflet-control-zoom")?.classList.add("eboses-map-zoom");
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OSM &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19
      }).addTo(map);
      poiLayerRef.current = L.layerGroup().addTo(map);
      map.on("moveend", () => {
        if (ignoreMove.current || !map) return;
        const c = map.getCenter();
        scheduleReverseAndValidate(c.lat, c.lng);
      });
      mapRef.current = map;
      requestAnimationFrame(() => {
        map?.invalidateSize();
        const c = map?.getCenter();
        if (c) scheduleReverseAndValidate(c.lat, c.lng);
      });
    }
    void init();
    return () => {
      cancelled = true;
      if (reverseTimer.current) window.clearTimeout(reverseTimer.current);
      map?.remove();
      mapRef.current = null;
      poiLayerRef.current = null;
    };
  }, [open, scheduleReverseAndValidate]);
  useEffect4(() => {
    const map = mapRef.current;
    if (!open || !map || !mapContext) return;
    void import("leaflet").then((L) => {
      const geometry = mapContext.boundary?.geometry;
      if (geometry) {
        L.geoJSON(geometry, {
          style: {
            color: "#ff6a1a",
            weight: 2,
            fillColor: "#ff6a1a",
            fillOpacity: 0.04,
            opacity: 0.75
          }
        }).addTo(map);
        try {
          map.fitBounds(L.geoJSON(geometry).getBounds(), {
            padding: [28, 28],
            maxZoom: 16
          });
        } catch {
        }
      }
      const layer = poiLayerRef.current;
      if (!layer) return;
      layer.clearLayers();
      if (!showPois) return;
      for (const poi of mapContext.pois || []) {
        const marker = L.marker([poi.latitude, poi.longitude], {
          icon: poiDivIcon(L, poi.type),
          keyboard: false
        });
        const sector = poi.sector === "private" ? "Private" : poi.sector === "public" ? "Public" : "";
        marker.bindTooltip(
          `${poi.label}${sector ? ` \xB7 ${sector}` : ""}: ${poi.name}`,
          {
            direction: "top",
            opacity: 0.95,
            className: "eboses-poi-tooltip"
          }
        );
        marker.addTo(layer);
      }
    });
  }, [open, mapContext, showPois]);
  useEffect4(() => {
    if (!open) return;
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      setSearching(true);
      void apiRequest(
        `/locations/search/?q=${encodeURIComponent(search.trim())}`
      ).then((data) => setResults(data.results || [])).catch(() => setResults([])).finally(() => setSearching(false));
    }, 350);
    return () => window.clearTimeout(t);
  }, [search, open]);
  function flyTo(lat, lng, parts) {
    const map = mapRef.current;
    if (!map) return;
    ignoreMove.current = true;
    map.setView([lat, lng], 17);
    setPreviewLatLng({ lat, lng });
    if (parts) setPreviewParts(parts);
    scheduleReverseAndValidate(lat, lng);
    window.setTimeout(() => {
      ignoreMove.current = false;
    }, 500);
  }
  function handleConfirm() {
    const map = mapRef.current;
    const center = map?.getCenter();
    const lat = previewLatLng?.lat ?? center?.lat;
    const lng = previewLatLng?.lng ?? center?.lng;
    if (lat == null || lng == null) return;
    if (locationClass && !locationClass.accepted) {
      return;
    }
    onConfirm({
      lat,
      lng,
      address: previewParts.full,
      addressPrimary: previewParts.primary,
      addressSecondary: previewParts.secondary,
      source: "manual_pin",
      zone: locationClass?.zone,
      warning: locationClass?.warning
    });
    onClose();
  }
  useEffect4(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const hasQuery = search.trim().length >= 2;
  const sheetMode = !hasQuery ? "collapsed" : searchFocused ? "expanded" : "peek";
  const canConfirm = !locationClass || locationClass.accepted;
  if (!open) return null;
  return createPortal3(
    /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 z-[320] flex items-center justify-center p-3 sm:p-6" }, /* @__PURE__ */ React.createElement("style", null, `
        .eboses-pin-pulse::before,
        .eboses-pin-pulse::after {
          content: "";
          position: absolute;
          inset: 50%;
          width: 12px;
          height: 12px;
          margin: -6px 0 0 -6px;
          border-radius: 9999px;
          background: rgba(43, 127, 255, 0.35);
          animation: eboses-pin-scan 1.8s ease-out infinite;
          pointer-events: none;
        }
        .eboses-pin-pulse::after {
          animation-delay: 0.9s;
          background: rgba(43, 127, 255, 0.22);
        }
        @keyframes eboses-pin-scan {
          0% { transform: scale(1); opacity: 0.7; }
          70% { transform: scale(2.8); opacity: 0; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        .eboses-map-zoom.leaflet-control-zoom {
          border: none !important;
          border-radius: 10px !important;
          overflow: hidden;
          box-shadow: 0 4px 14px rgba(0,0,0,0.28) !important;
        }
        .eboses-map-zoom .leaflet-control-zoom-in,
        .eboses-map-zoom .leaflet-control-zoom-out {
          width: 36px !important;
          height: 36px !important;
          line-height: 36px !important;
          font-size: 22px !important;
          font-weight: 700 !important;
          color: #18181b !important;
          background: #fff !important;
          border: none !important;
          border-bottom: 1px solid #e4e4e7 !important;
        }
        .eboses-map-zoom .leaflet-control-zoom-out { border-bottom: none !important; }
        .eboses-map-zoom a:hover { background: #f4f4f5 !important; color: #000 !important; }
        .eboses-map-search-expanded .leaflet-control-zoom {
          visibility: hidden !important;
          pointer-events: none !important;
        }
        .eboses-poi-tooltip {
          border: none !important;
          border-radius: 8px !important;
          padding: 4px 8px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
        }
        .eboses-poi-marker {
          background: transparent !important;
          border: none !important;
        }
      `), /* @__PURE__ */ React.createElement("div", { className: "absolute inset-0 bg-black/50", onClick: onClose }), /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl",
          "h-[min(640px,92vh)]"
        )
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3" }, /* @__PURE__ */ React.createElement("h2", { className: "text-[17px] font-semibold text-neutral-900" }, "Move map to pin location"), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          onClick: onClose,
          className: "flex size-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100",
          "aria-label": "Close"
        },
        /* @__PURE__ */ React.createElement(XIcon3, { className: "size-5", strokeWidth: 2 })
      )),
      /* @__PURE__ */ React.createElement(
        "div",
        {
          className: cn(
            "relative min-h-0 flex-1 overflow-hidden",
            sheetMode === "expanded" && "eboses-map-search-expanded"
          )
        },
        /* @__PURE__ */ React.createElement("div", { ref: containerRef, className: "absolute inset-0 z-0" }),
        sheetMode !== "expanded" ? /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            onClick: () => setShowPois((v) => !v),
            className: cn(
              "absolute left-3 top-3 z-[1200] inline-flex items-center gap-1.5 rounded-full border bg-white/95 px-3 py-2 text-[12px] font-semibold shadow-md backdrop-blur-sm transition-colors",
              showPois ? "border-[#ff6a1a]/40 text-[#ff6a1a]" : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
            )
          },
          /* @__PURE__ */ React.createElement(HospitalIcon, { className: "size-3.5", strokeWidth: 2 }),
          /* @__PURE__ */ React.createElement(ShieldIcon, { className: "size-3.5", strokeWidth: 2 }),
          "Services"
        ) : null,
        sheetMode !== "expanded" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
          "div",
          {
            className: "pointer-events-none absolute left-1/2 top-1/2 z-[1100] h-0 w-0 overflow-visible",
            "aria-hidden": true
          },
          /* @__PURE__ */ React.createElement(
            "img",
            {
              src: "/contents/map-pin-gps.png",
              alt: "",
              width: 56,
              height: 56,
              className: "absolute left-0 top-0 h-14 w-14 max-w-none object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]",
              style: {
                marginLeft: -28,
                marginTop: -(56 + 28)
              },
              draggable: false
            }
          ),
          /* @__PURE__ */ React.createElement(
            "span",
            {
              className: "eboses-pin-pulse absolute left-0 top-0 size-3 rounded-full bg-[#2b7fff]",
              style: {
                marginLeft: -6,
                marginTop: -6,
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)"
              }
            }
          )
        ), /* @__PURE__ */ React.createElement(
          "div",
          {
            className: cn(
              "pointer-events-none absolute inset-x-0 z-[1100] flex flex-col items-center gap-2 px-4",
              sheetMode === "peek" ? "top-[calc(50%+24px)]" : "top-[calc(50%+36px)]"
            )
          },
          locationClass?.warning ? /* @__PURE__ */ React.createElement("p", { className: "pointer-events-none max-w-[min(100%,320px)] rounded-xl bg-amber-50 px-3 py-2 text-center text-[12px] font-medium text-amber-800 shadow-sm ring-1 ring-amber-200/80" }, locationClass.warning) : null,
          locationClass && !locationClass.accepted ? /* @__PURE__ */ React.createElement("p", { className: "pointer-events-none max-w-[min(100%,320px)] rounded-xl bg-red-50 px-3 py-2 text-center text-[12px] font-medium text-red-700 shadow-sm ring-1 ring-red-200/80" }, locationClass.message) : null,
          /* @__PURE__ */ React.createElement(
            "button",
            {
              type: "button",
              onClick: handleConfirm,
              disabled: !canConfirm || geocoding,
              className: cn(
                "pointer-events-auto flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform",
                canConfirm ? "hover:scale-[1.02] active:scale-[0.99]" : "cursor-not-allowed opacity-60"
              )
            },
            /* @__PURE__ */ React.createElement("span", { className: "text-[16px] font-semibold leading-none text-neutral-900" }, "Use this location"),
            /* @__PURE__ */ React.createElement("span", { className: "mt-1.5 line-clamp-2 text-[14px] font-medium leading-snug text-neutral-500" }, geocoding ? "Finding address\u2026" : previewParts.primary)
          )
        )) : null,
        /* @__PURE__ */ React.createElement(
          "div",
          {
            className: cn(
              "absolute inset-x-0 bottom-0 z-[1400] flex h-full flex-col overflow-hidden bg-white",
              "rounded-t-2xl border-t border-neutral-200 shadow-[0_-8px_28px_rgba(0,0,0,0.12)]",
              "transition-transform duration-300 ease-out will-change-transform",
              sheetMode === "expanded" && "translate-y-0 rounded-none border-0 shadow-none",
              sheetMode === "peek" && "translate-y-[calc(100%-100px)]",
              sheetMode === "collapsed" && "translate-y-[calc(100%-72px)]"
            ),
            onClick: () => {
              if (sheetMode === "peek") {
                setSearchFocused(true);
                searchInputRef.current?.focus();
              }
            }
          },
          /* @__PURE__ */ React.createElement("div", { className: "shrink-0 px-4 pb-2 pt-3" }, /* @__PURE__ */ React.createElement("div", { className: "relative" }, /* @__PURE__ */ React.createElement(SearchIcon2, { className: "pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" }), /* @__PURE__ */ React.createElement(
            "input",
            {
              ref: searchInputRef,
              type: "text",
              value: search,
              onChange: (e) => setSearch(e.target.value),
              onFocus: () => setSearchFocused(true),
              onBlur: () => {
                window.setTimeout(() => setSearchFocused(false), 180);
              },
              placeholder: "Search streets in Marikina Heights",
              autoComplete: "off",
              className: cn(
                "h-11 w-full rounded-full border border-neutral-200 bg-white pl-10 pr-4 text-[15px] text-neutral-900 outline-none",
                "placeholder:text-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100"
              )
            }
          ))),
          /* @__PURE__ */ React.createElement(
            "ul",
            {
              className: cn(
                "min-h-0 flex-1 list-none overflow-y-auto",
                sheetMode === "collapsed" && "hidden",
                sheetMode === "peek" && "pointer-events-none select-none"
              )
            },
            searching ? /* @__PURE__ */ React.createElement("li", { className: "px-5 py-3 text-[14px] text-neutral-500" }, "Searching\u2026") : results.length === 0 && hasQuery ? /* @__PURE__ */ React.createElement("li", { className: "px-5 py-3 text-[14px] text-neutral-500" }, "No places found inside Marikina Heights (or its edge buffer)") : results.map((item) => /* @__PURE__ */ React.createElement(
              "li",
              {
                key: `${item.lat}-${item.lng}-${item.label}`,
                className: "border-b border-neutral-100 last:border-b-0"
              },
              /* @__PURE__ */ React.createElement(
                "button",
                {
                  type: "button",
                  className: "flex w-full flex-col px-5 py-3.5 text-left transition-colors hover:bg-neutral-50 active:bg-neutral-100",
                  onMouseDown: (e) => e.preventDefault(),
                  onClick: () => {
                    setSearch("");
                    setResults([]);
                    setSearchFocused(false);
                    flyTo(item.lat, item.lng, {
                      primary: item.primary,
                      secondary: item.secondary,
                      full: item.secondary ? `${item.primary}, ${item.secondary}` : item.primary
                    });
                  }
                },
                /* @__PURE__ */ React.createElement("span", { className: "text-[15px] font-semibold text-neutral-900" }, item.primary || item.label),
                item.secondary ? /* @__PURE__ */ React.createElement("span", { className: "mt-0.5 text-[13px] text-neutral-500" }, item.secondary) : null
              )
            ))
          )
        )
      )
    )),
    document.body
  );
}
var DEFAULT_CENTER, POI_STYLE;
var init_location_picker = __esm({
  "src/features/dashboard/components/location-picker.tsx"() {
    "use client";
    init_utils();
    init_api();
    DEFAULT_CENTER = [14.6507, 121.1133];
    POI_STYLE = {
      // Civic / government — warm brand orange
      barangay_hall: {
        bg: "#ff6a1a",
        ring: "#c2410c",
        glyph: '<path d="M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      },
      community: {
        bg: "#ea580c",
        ring: "#c2410c",
        glyph: '<path d="M16 21v-2a3 3 0 00-3-3H5a3 3 0 00-3 3v2M9 11a3 3 0 100-6 3 3 0 000 6zM22 21v-2a3 3 0 00-2.3-2.9M16 3.1a3 3 0 010 5.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
      },
      // Medical — red cross / green pharmacy
      hospital: {
        bg: "#dc2626",
        ring: "#991b1b",
        glyph: '<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4z" fill="#fff"/>'
      },
      health_center: {
        bg: "#e11d48",
        ring: "#9f1239",
        glyph: '<path d="M12 3v18M3 12h18" fill="none" stroke="#fff" stroke-width="2.75" stroke-linecap="round"/>'
      },
      clinic: {
        bg: "#0d9488",
        ring: "#0f766e",
        glyph: '<path d="M12 7v10M7 12h10" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="#fff" stroke-width="2"/>'
      },
      pharmacy: {
        bg: "#16a34a",
        ring: "#15803d",
        // Bowl of Hygieia / Rx-style green cross
        glyph: '<path d="M12 4v16M4 12h16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
      },
      dentist: {
        bg: "#06b6d4",
        ring: "#0e7490",
        glyph: '<path d="M12 3c-2.2 0-3.5 2-3.5 4.2 0 3.2 1.6 5.2 1.6 8.3h3.8c0-3.1 1.6-5.1 1.6-8.3C15.5 5 14.2 3 12 3zM8.8 15.5c-1.2 2-1.2 4.2 0 6.2M15.2 15.5c1.2 2 1.2 4.2 0 6.2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      },
      veterinary: {
        bg: "#7c3aed",
        ring: "#5b21b6",
        // Paw print simplified
        glyph: '<circle cx="9" cy="10" r="2" fill="#fff"/><circle cx="15" cy="10" r="2" fill="#fff"/><circle cx="7" cy="14.5" r="1.6" fill="#fff"/><circle cx="17" cy="14.5" r="1.6" fill="#fff"/><ellipse cx="12" cy="16.5" rx="3.2" ry="2.6" fill="#fff"/>'
      },
      ambulance: {
        bg: "#ef4444",
        ring: "#b91c1c",
        glyph: '<path d="M3 11h11v6H3zM14 13h3.5L20 16v1h-6v-4zM7 17.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM16.5 17.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM7 8v3M5.5 9.5h3" fill="none" stroke="#fff" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>'
      },
      // Safety / security
      police: {
        bg: "#1d4ed8",
        ring: "#1e3a8a",
        glyph: '<path d="M12 3l7 3v5c0 5-3.2 8.5-7 10-3.8-1.5-7-5-7-10V6l7-3z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M9.5 12l1.8 1.8L15 10" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      },
      tanod: {
        bg: "#2563eb",
        ring: "#1e40af",
        glyph: '<path d="M12 3l7 3v5c0 5-3.2 8.5-7 10-3.8-1.5-7-5-7-10V6l7-3z" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="11" r="2.2" fill="#fff"/>'
      },
      fire: {
        bg: "#f97316",
        ring: "#c2410c",
        glyph: '<path d="M12 21c3.5 0 6-2.6 6-6 0-3.5-2.5-5.2-2.5-8.5 0 0-1.6 1.8-3.5 3.5C11.2 7 11 4.5 11 4.5S6 8 6 15c0 3.4 2.5 6 6 6z" fill="#fff"/>'
      },
      bdrrmo: {
        bg: "#ca8a04",
        ring: "#a16207",
        glyph: '<path d="M12 3L2.5 19h19L12 3z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" fill="none" stroke="#fff" stroke-width="2.25" stroke-linecap="round"/>'
      },
      security: {
        bg: "#475569",
        ring: "#334155",
        glyph: '<rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="#fff" stroke-width="2"/><path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
      },
      // Places
      school: {
        bg: "#4f46e5",
        ring: "#3730a3",
        glyph: '<path d="M2 10l10-5 10 5-10 5L2 10z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M6 12v4.5c2.5 1.5 9.5 1.5 12 0V12M22 10v6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
      },
      evacuation: {
        bg: "#0891b2",
        ring: "#0e7490",
        glyph: '<path d="M4 12h12M12 7l5 5-5 5M4 20V4" fill="none" stroke="#fff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>'
      },
      other: {
        bg: "#71717a",
        ring: "#52525b",
        glyph: '<circle cx="12" cy="12" r="7.5" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 8v4l2.5 2" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
      }
    };
  }
});

// src/features/dashboard/pages/home.tsx
import { useEffect as useEffect10, useMemo as useMemo3, useState as useState11 } from "react";
import { Link as Link3 } from "react-router-dom";
import { toast as toast2 } from "sonner";
import {
  AlertTriangleIcon as AlertTriangleIcon3,
  ArrowBigUpIcon,
  CalendarDaysIcon,
  ChevronRightIcon as ChevronRightIcon2,
  FileTextIcon,
  FlagIcon,
  GlobeIcon as GlobeIcon2,
  ImageIcon as ImageIcon2,
  MessageCircleIcon,
  PencilIcon,
  XIcon as XIcon6
} from "lucide-react";

// ../../packages/ui/src/components/button.tsx
init_utils();
import { cva } from "class-variance-authority";
import { jsx } from "react/jsx-runtime";
var buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive: "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}) {
  return /* @__PURE__ */ jsx(
    "button",
    {
      type,
      "data-slot": "button",
      className: cn(buttonVariants({ variant, size, className })),
      ...props
    }
  );
}

// ../../packages/ui/src/components/input.tsx
init_utils();
import { jsx as jsx2 } from "react/jsx-runtime";
function Input({ className, type, ...props }) {
  return /* @__PURE__ */ jsx2(
    "input",
    {
      type,
      "data-slot": "input",
      className: cn(
        "border-input bg-white ring-offset-background placeholder:text-muted-foreground flex h-9 w-full rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_rgba(255,129,51,0.15)]",
        "aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]",
        className
      ),
      ...props
    }
  );
}

// ../../packages/ui/src/components/skeleton.tsx
init_utils();
import { jsx as jsx3 } from "react/jsx-runtime";
function Skeleton({ className, ...props }) {
  return /* @__PURE__ */ jsx3(
    "div",
    {
      "data-slot": "skeleton",
      className: cn("animate-pulse rounded-md bg-muted", className),
      ...props
    }
  );
}

// ../../packages/ui/src/components/popover.tsx
init_utils();
import * as React2 from "react";
import { createPortal } from "react-dom";
import { jsx as jsx4 } from "react/jsx-runtime";
var PopoverContext = React2.createContext(null);
function Popover({
  children,
  open: controlledOpen,
  onOpenChange
}) {
  const [internalOpen, setInternalOpen] = React2.useState(false);
  const open = controlledOpen ?? internalOpen;
  const triggerRef = React2.useRef(null);
  const setOpen = React2.useCallback(
    (value) => {
      setInternalOpen(value);
      onOpenChange?.(value);
    },
    [onOpenChange]
  );
  return /* @__PURE__ */ jsx4(PopoverContext.Provider, { value: { open, setOpen, triggerRef }, children });
}
function usePopover() {
  const ctx = React2.useContext(PopoverContext);
  if (!ctx) throw new Error("Popover components must be used within a Popover");
  return ctx;
}
var PopoverTrigger = React2.forwardRef(({ className, children, onClick, ...props }, ref) => {
  const { open, setOpen, triggerRef } = usePopover();
  const setRefs = React2.useCallback(
    (node) => {
      triggerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref, triggerRef]
  );
  return /* @__PURE__ */ jsx4(
    "button",
    {
      ref: setRefs,
      type: "button",
      className: cn(className),
      "aria-expanded": open,
      onClick: (event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      },
      ...props,
      children
    }
  );
});
PopoverTrigger.displayName = "PopoverTrigger";
function computePosition(trigger, content, side = "bottom") {
  const rect = trigger.getBoundingClientRect();
  const contentHeight = content.offsetHeight || 320;
  const contentWidth = Math.max(content.offsetWidth || 300, 280);
  const gap = 8;
  const viewportPadding = 12;
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const spaceAbove = rect.top - gap;
  let placeAbove = false;
  if (side === "top") {
    placeAbove = true;
  } else if (side === "auto") {
    placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
  } else {
    placeAbove = false;
  }
  let top = placeAbove ? Math.max(viewportPadding, rect.top - contentHeight - gap) : rect.bottom + gap;
  if (!placeAbove) {
    top = Math.max(top, rect.bottom + gap);
  }
  if (!placeAbove && top < rect.bottom + gap) {
    top = rect.bottom + gap;
  }
  let left = rect.left;
  left = Math.max(
    viewportPadding,
    Math.min(left, window.innerWidth - contentWidth - viewportPadding)
  );
  return { top, left, maxHeight: void 0 };
}
var PopoverContent = React2.forwardRef(({ className, style, side = "bottom", ...props }, ref) => {
  const { open, setOpen, triggerRef } = usePopover();
  const contentRef = React2.useRef(null);
  const [coords, setCoords] = React2.useState(null);
  const [mounted, setMounted] = React2.useState(false);
  React2.useEffect(() => {
    setMounted(true);
  }, []);
  const updatePosition = React2.useCallback(() => {
    const trigger = triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) return;
    const next = computePosition(trigger, content, side);
    setCoords({ top: next.top, left: next.left, maxHeight: next.maxHeight });
  }, [triggerRef, side]);
  React2.useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    const t = window.setTimeout(updatePosition, 50);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);
  React2.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      const target = e.target;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen, triggerRef]);
  if (!open || !mounted) return null;
  return createPortal(
    /* @__PURE__ */ jsx4(
      "div",
      {
        ref: (node) => {
          contentRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        },
        "data-slot": "popover-content",
        className: cn(
          "z-[200] w-auto overflow-visible rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          className
        ),
        style: {
          position: "fixed",
          top: coords?.top ?? -9999,
          left: coords?.left ?? -9999,
          maxHeight: coords?.maxHeight,
          visibility: coords ? "visible" : "hidden",
          ...style
        },
        ...props
      }
    ),
    document.body
  );
});
PopoverContent.displayName = "PopoverContent";

// src/features/dashboard/pages/home.tsx
init_utils();

// src/features/auth/auth-session.tsx
import * as React3 from "react";

// src/features/auth/api.ts
init_api();

// src/features/auth/auth-session.tsx
init_api();
var AuthSessionContext = React3.createContext(null);
function useAuthSession() {
  const context = React3.useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider.");
  }
  return context;
}

// src/features/dashboard/api.ts
init_api();
function createConcern(formData) {
  return apiRequest("/concerns/", {
    method: "POST",
    body: formData
  });
}
function checkConcernMedia(formData) {
  return apiRequest("/concerns/media/check/", {
    method: "POST",
    body: formData
  });
}
function listFeedConcerns(category, dateFrom, dateTo, search) {
  const params = new URLSearchParams();
  if (category && category !== "all") params.set("category", category);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
  if (search?.trim()) params.set("search", search.trim());
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiRequest(`/concerns/feed/${query}`);
}
function flagConcern(id, payload) {
  return apiRequest(`/concerns/${id}/flags/`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
function voteConcern(id, value) {
  return apiRequest(`/concerns/${id}/vote/`, {
    method: "POST",
    body: JSON.stringify({ value })
  });
}
function commentOnConcern(id, payload) {
  return apiRequest(`/concerns/${id}/comments/`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
function listAnnouncements() {
  return apiRequest("/announcements/");
}
function listTodayBarangayEvents() {
  return apiRequest("/barangay-events/today/");
}

// src/features/dashboard/components/create-report-dialog.tsx
init_utils();
import { lazy, Suspense, useEffect as useEffect5, useMemo, useRef as useRef5, useState as useState5 } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  CircleEllipsisIcon,
  GlobeIcon,
  ImageIcon,
  LayoutGridIcon,
  LeafIcon,
  LockIcon,
  MapPinIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
  XIcon as XIcon4
} from "lucide-react";

// src/features/dashboard/components/dialog.tsx
init_utils();
import { useEffect as useEffect3, useRef as useRef3 } from "react";
import { createPortal as createPortal2 } from "react-dom";
import { XIcon } from "lucide-react";
function Dialog({ open, onClose, maxW = "max-w-lg", children, containerClassName }) {
  const overlayRef = useRef3(null);
  const contentRef = useRef3(null);
  useEffect3(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  useEffect3(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal2(
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "fixed inset-0 flex items-center justify-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
          containerClassName ?? "z-[200]"
        )
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          ref: overlayRef,
          className: "absolute inset-0 bg-black/40",
          onClick: onClose
        }
      ),
      /* @__PURE__ */ React.createElement(
        "div",
        {
          ref: contentRef,
          className: cn(
            "z-10 flex w-full flex-col overflow-hidden bg-background",
            "fixed inset-0 md:relative md:max-h-[90vh] md:rounded-2xl md:border md:border-border md:shadow-2xl",
            "motion-safe:md:animate-in motion-safe:md:fade-in motion-safe:md:zoom-in-95 motion-safe:md:duration-200 motion-safe:md:ease-out",
            maxW
          )
        },
        children
      )
    ),
    document.body
  );
}
function DialogHeader({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn("shrink-0 border-b border-border/50 px-6 py-4", className),
      ...props
    }
  );
}
function DialogBody({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn("flex-1 overflow-y-auto px-6 py-5 space-y-5", className),
      style: { scrollbarWidth: "none" },
      ...props
    }
  );
}
function DialogFooter({ className, ...props }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn("shrink-0 border-t border-border/50 px-6 py-4", className),
      ...props
    }
  );
}
function DialogTitle({ className, ...props }) {
  return /* @__PURE__ */ React.createElement("h2", { className: cn("text-lg font-semibold text-foreground", className), ...props });
}

// src/features/dashboard/components/report-status-dialog.tsx
init_utils();
import { useState as useState3 } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  PencilLineIcon,
  SearchIcon,
  XIcon as XIcon2
} from "lucide-react";

// ../../packages/ui/src/components/badge.tsx
init_utils();
import { cva as cva2 } from "class-variance-authority";
import { jsx as jsx5 } from "react/jsx-runtime";
var badgeVariants = cva2(
  "inline-flex w-fit shrink-0 items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-white",
        outline: "border-border bg-background text-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function Badge({
  className,
  variant,
  ...props
}) {
  return /* @__PURE__ */ jsx5(
    "span",
    {
      "data-slot": "badge",
      className: cn(badgeVariants({ variant }), className),
      ...props
    }
  );
}

// src/features/dashboard/components/report-status-dialog.tsx
var STATUS_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" }
];
var MODE_CONFIG = {
  submitted: {
    statusLabel: "Submitted",
    statusColor: "bg-orange-100 text-orange-700 border-orange-200",
    image: "/contents/report-received.png",
    title: "Report was received",
    subtitle: "Your report has been received and is being reviewed by our barangay team."
  },
  assigned: {
    statusLabel: "Assigned",
    statusColor: "bg-[#eef3ff] text-[#07145f] border-[#cbd8ee]",
    image: "/contents/report-assigned.png",
    title: "Report was assigned",
    subtitle: "Your report has been assigned to a barangay staff member for action."
  },
  rejected: {
    statusLabel: "Rejected",
    statusColor: "bg-red-100 text-red-700 border-red-200",
    image: "/contents/report-rejected.png",
    title: "Report was not approved",
    subtitle: "Your report was reviewed but needs changes or additional details before it can proceed."
  },
  resolved: {
    statusLabel: "Resolved",
    statusColor: "bg-green-100 text-green-700 border-green-200",
    image: "/contents/report-resolved.png",
    title: "Report was resolved",
    subtitle: "Your report has been resolved. Below is the summary of action taken."
  }
};
function statusModeFromReport(report) {
  if (report.status === "assigned" || report.status === "in_progress") return "assigned";
  if (report.status === "rejected") return "rejected";
  if (report.status === "resolved") return "resolved";
  return "submitted";
}
function formatDate(value) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
function formatTime(value) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function formatDateTime(value) {
  return `${formatDate(value)} ${formatTime(value)}`;
}
function roleLabel(role) {
  return role.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function findEvent(report, status) {
  return report.status_events.find((event) => event.status === status);
}
function latestEvent(report, mode) {
  const status = mode === "assigned" ? report.status === "assigned" ? "assigned" : "in_progress" : mode === "submitted" ? report.status : mode;
  return [...report.status_events].reverse().find((event) => event.status === status) ?? report.status_events.at(-1);
}
function pickActor(report, mode) {
  const status = mode === "assigned" ? report.status === "assigned" ? "assigned" : "in_progress" : mode === "rejected" ? "rejected" : mode === "resolved" ? "resolved" : null;
  if (!status) return null;
  const event = findEvent(report, status);
  return event?.actor ? { actor: event.actor, time: event.created_at } : null;
}
function activeIndex(report, mode) {
  if (mode === "rejected") return 0;
  if (mode === "submitted") return 0;
  return Math.max(0, STATUS_STEPS.findIndex((step) => step.key === report.status));
}
function stepEvent(report, key) {
  if (key === "submitted") return findEvent(report, "submitted")?.created_at ?? report.created_at;
  return findEvent(report, key)?.created_at ?? null;
}
function extractActions(report) {
  const actions = report.status_events.map((event) => event.note).filter((note) => note && note !== "Report submitted." && note !== "Your report was received.");
  if (report.update_text && !actions.includes(report.update_text)) actions.push(report.update_text);
  return actions.length > 0 ? actions : ["Report received and logged."];
}
function cleanDetailText(report, event, fallback) {
  const trivialNotes = /* @__PURE__ */ new Set(["Report submitted.", "Your report was received."]);
  if (event?.note && !trivialNotes.has(event.note)) return event.note;
  return report.update_text || fallback;
}
function StatusLine({ report, mode }) {
  const currentIdx = activeIndex(report, mode);
  return /* @__PURE__ */ React.createElement("div", { className: "relative grid grid-cols-4 gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "absolute left-[10%] right-[10%] top-[13px] h-0.5 bg-[#dfe7f5]" }), /* @__PURE__ */ React.createElement("div", { className: "absolute left-[10%] right-[10%] top-[13px] h-0.5" }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn("h-full", mode === "rejected" ? "bg-red-500" : "bg-[#07145f]"),
      style: { width: `${Math.min(currentIdx, 3) / 3 * 100}%` }
    }
  )), STATUS_STEPS.map((step, index) => {
    const done = index < currentIdx || mode === "resolved" && index === currentIdx;
    const current = index === currentIdx && !done;
    const rejectedCurrent = mode === "rejected" && current;
    const date = stepEvent(report, step.key);
    return /* @__PURE__ */ React.createElement("div", { key: step.key, className: "relative z-10 flex flex-col items-center text-center" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "flex size-7 items-center justify-center rounded-full border text-[11px] font-extrabold",
          done && "border-[#07145f] bg-[#07145f] text-white",
          current && !rejectedCurrent && "border-[#ff6a1a] bg-[#ff6a1a] text-white",
          rejectedCurrent && "border-red-500 bg-red-500 text-white",
          !done && !current && "border-[#cbd8ee] bg-white text-[#68739c]"
        )
      },
      done ? /* @__PURE__ */ React.createElement(CheckIcon, { className: "size-4" }) : rejectedCurrent ? "!" : index + 1
    ), /* @__PURE__ */ React.createElement("p", { className: "mt-2 text-[11px] font-extrabold text-[#07145f]" }, step.label), /* @__PURE__ */ React.createElement("p", { className: "mt-1 text-[10px] font-medium leading-4 text-[#43507f]" }, date && (done || current) ? /* @__PURE__ */ React.createElement(React.Fragment, null, formatDate(date), /* @__PURE__ */ React.createElement("br", null), formatTime(date)) : "Pending"));
  }));
}
function ActorCard({ actor, label }) {
  const avatarKey = actor.actor.avatar;
  const initials = actor.actor.initials || actor.actor.full_name.charAt(0);
  return /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3 rounded-xl border border-[#dfe7f5] bg-white px-4 py-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#fff1ea] text-sm font-bold text-[#ff6a1a]" }, avatarKey ? /* @__PURE__ */ React.createElement("img", { src: `/contents/${avatarKey}.png`, alt: "", className: "h-full w-full object-cover" }) : initials), /* @__PURE__ */ React.createElement("div", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("p", { className: "text-[11px] font-bold text-[#68739c]" }, label), /* @__PURE__ */ React.createElement("p", { className: "truncate text-sm font-extrabold text-[#07145f]" }, actor.actor.full_name), /* @__PURE__ */ React.createElement("p", { className: "text-xs font-semibold text-[#43507f]" }, roleLabel(actor.actor.role), " - ", formatDateTime(actor.time))));
}
function ReportStatusDialog({
  open,
  onOpenChange,
  report,
  mode,
  onTrack
}) {
  const [copied, setCopied] = useState3(false);
  const resolvedMode = mode ?? statusModeFromReport(report);
  const config = MODE_CONFIG[resolvedMode];
  const isInProgress = resolvedMode === "assigned" && report.status === "in_progress";
  const statusTitle = isInProgress ? "Report is in progress" : config.title;
  const statusSubtitle = isInProgress ? "The assigned barangay team is currently working on your report." : config.subtitle;
  const statusLabel = isInProgress ? "In progress" : config.statusLabel;
  const actor = pickActor(report, resolvedMode);
  const actions = extractActions(report);
  const event = latestEvent(report, resolvedMode);
  const detailText = cleanDetailText(report, event, statusSubtitle);
  const showDetail = resolvedMode !== "submitted";
  function handleCopy() {
    navigator.clipboard.writeText(report.tracking_id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    });
  }
  function handleClose() {
    onOpenChange(false);
  }
  function handleTrack() {
    handleClose();
    onTrack?.();
  }
  return /* @__PURE__ */ React.createElement(Dialog, { open, onClose: handleClose, maxW: "max-w-2xl", containerClassName: "z-[300]" }, /* @__PURE__ */ React.createElement(DialogHeader, { className: "border-0 bg-[#07145f] px-4 py-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center justify-between" }, /* @__PURE__ */ React.createElement(DialogTitle, { className: "text-sm font-extrabold text-white" }, "Report Status"), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      "aria-label": "Close report status",
      onClick: handleClose,
      className: "flex size-8 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10"
    },
    /* @__PURE__ */ React.createElement(XIcon2, { className: "size-5" })
  ))), /* @__PURE__ */ React.createElement(DialogBody, { className: "space-y-5 bg-white px-6 py-6" }, /* @__PURE__ */ React.createElement("div", { className: "grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center" }, /* @__PURE__ */ React.createElement("div", { className: "flex justify-center sm:justify-start" }, /* @__PURE__ */ React.createElement("img", { src: config.image, alt: "", className: "h-36 w-auto object-contain sm:h-40" })), /* @__PURE__ */ React.createElement("div", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("h3", { className: "text-lg font-extrabold leading-tight text-[#07145f]" }, statusTitle), /* @__PURE__ */ React.createElement("p", { className: "mt-2 max-w-[34rem] text-xs font-semibold leading-5 text-[#07145f]" }, statusSubtitle), /* @__PURE__ */ React.createElement("div", { className: "mt-4 border-t border-[#dfe7f5] pt-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-wrap items-end justify-between gap-3" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "text-[11px] font-extrabold text-[#07145f]" }, "Tracking Number"), /* @__PURE__ */ React.createElement("div", { className: "mt-2 flex items-center gap-2" }, /* @__PURE__ */ React.createElement("p", { className: "font-mono text-sm font-extrabold tracking-wide text-[#07145f]" }, report.tracking_id || "EB-XXXXXXXX"), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: handleCopy,
      "aria-label": "Copy tracking number",
      className: "flex size-8 items-center justify-center rounded-md bg-[#eef3ff] text-[#07145f] transition-colors hover:bg-[#dfe7f5]"
    },
    copied ? /* @__PURE__ */ React.createElement(CheckIcon, { className: "size-4" }) : /* @__PURE__ */ React.createElement(CopyIcon, { className: "size-4" })
  ))), /* @__PURE__ */ React.createElement(Badge, { className: cn("rounded-md border px-3 py-1.5 text-xs font-bold", config.statusColor) }, statusLabel))))), /* @__PURE__ */ React.createElement(StatusLine, { report, mode: resolvedMode }), actor ? /* @__PURE__ */ React.createElement(
    ActorCard,
    {
      actor,
      label: resolvedMode === "resolved" ? "Resolved by" : resolvedMode === "rejected" ? "Rejected by" : "Assigned to"
    }
  ) : null, resolvedMode === "rejected" ? /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-red-700" }, /* @__PURE__ */ React.createElement(AlertTriangleIcon, { className: "size-7 shrink-0 fill-red-500 text-red-500" }), /* @__PURE__ */ React.createElement("p", { className: "text-sm font-medium" }, /* @__PURE__ */ React.createElement("span", { className: "font-extrabold" }, "Reason: "), detailText)) : showDetail ? /* @__PURE__ */ React.createElement("div", { className: "rounded-lg border border-[#dfe7f5] bg-white px-5 py-4" }, /* @__PURE__ */ React.createElement("p", { className: "text-sm font-medium leading-6 text-[#43507f]" }, /* @__PURE__ */ React.createElement("span", { className: "font-extrabold text-[#07145f]" }, resolvedMode === "resolved" ? "Action summary: " : resolvedMode === "assigned" ? "Current update: " : "Review note: "), detailText)) : null, (resolvedMode === "assigned" || resolvedMode === "resolved") && actions.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "rounded-lg border border-[#dfe7f5] bg-white px-5 py-4" }, /* @__PURE__ */ React.createElement("p", { className: "text-sm font-extrabold text-[#07145f]" }, resolvedMode === "resolved" ? "Actions Taken" : "Pending Actions"), /* @__PURE__ */ React.createElement("ul", { className: "mt-2 space-y-1.5" }, actions.map((action, index) => /* @__PURE__ */ React.createElement("li", { key: index, className: "flex items-start gap-2 text-sm font-medium text-[#43507f]" }, /* @__PURE__ */ React.createElement("span", { className: "mt-2 size-1.5 rounded-full bg-[#ff6a1a]" }), action)))) : null, resolvedMode === "resolved" && report.media.some((media) => media.mime_type?.startsWith("image/")) ? /* @__PURE__ */ React.createElement("div", { className: "rounded-lg border border-[#dfe7f5] bg-white px-5 py-4" }, /* @__PURE__ */ React.createElement("p", { className: "text-sm font-extrabold text-[#07145f]" }, "Photo Evidence"), /* @__PURE__ */ React.createElement("div", { className: "mt-3 grid grid-cols-2 gap-2" }, report.media.map(
    (media) => media.mime_type?.startsWith("image/") ? /* @__PURE__ */ React.createElement(
      "img",
      {
        key: media.id,
        src: media.preview_url,
        alt: media.original_filename,
        className: "h-28 w-full rounded-lg border border-[#dfe7f5] object-cover"
      }
    ) : null
  ))) : null), /* @__PURE__ */ React.createElement(DialogFooter, { className: "border-0 bg-white px-6 pb-6 pt-0" }, resolvedMode === "rejected" ? /* @__PURE__ */ React.createElement("div", { className: "flex w-full flex-col justify-center gap-3 sm:flex-row sm:justify-end" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: handleClose,
      className: "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#07145f] bg-white px-8 text-sm font-extrabold text-[#07145f] transition-colors hover:bg-[#eef3ff]"
    },
    /* @__PURE__ */ React.createElement(PencilLineIcon, { className: "size-4" }),
    "Revise Report"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: handleTrack,
      className: "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#ff5b14] px-8 text-sm font-extrabold text-white transition-colors hover:bg-[#e65011]"
    },
    /* @__PURE__ */ React.createElement(SearchIcon, { className: "size-4" }),
    "Track Report"
  )) : /* @__PURE__ */ React.createElement("div", { className: "flex w-full flex-col justify-center gap-3 sm:flex-row sm:justify-end" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: handleClose,
      className: "inline-flex h-11 items-center justify-center rounded-lg border border-[#07145f] bg-white px-8 text-sm font-extrabold text-[#07145f] transition-colors hover:bg-[#eef3ff]"
    },
    "Done"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: handleTrack,
      className: "inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#ff5b14] px-8 text-sm font-extrabold text-white transition-colors hover:bg-[#e65011]"
    },
    /* @__PURE__ */ React.createElement(SearchIcon, { className: "size-4" }),
    resolvedMode === "submitted" ? "Track Report" : "View Report"
  ))));
}

// src/features/dashboard/components/create-report-dialog.tsx
init_api();
var LocationPickerModal2 = lazy(() => Promise.resolve().then(() => (init_location_picker(), location_picker_exports)));
var concernConfig = [
  {
    label: "Infrastructure",
    value: "infrastructure",
    desc: "Roads, utilities, buildings",
    icon: TrafficConeIcon
  },
  {
    label: "Environment",
    value: "environment",
    desc: "Pollution, waste, nature",
    icon: LeafIcon
  },
  {
    label: "Public Safety",
    value: "public_safety",
    desc: "Safety risks, suspicious activity",
    icon: ShieldCheckIcon
  },
  {
    label: "Others",
    value: "others",
    desc: "Any other concern",
    icon: CircleEllipsisIcon
  }
];
var ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg"];
var ACCEPT_STRING = ".png,.jpg,.jpeg," + ALLOWED_TYPES.join(",");
var MAX_FILE_SIZE = 2 * 1024 * 1024;
var MAX_FILES = 5;
var descriptionMax = 1500;
var DRAFT_DB = "eboses-resident-drafts";
var DRAFT_STORE = "report-drafts";
var DRAFT_KEY = "current-report";
function openDraftDatabase() {
  return new Promise((resolve, reject) => {
    const request2 = indexedDB.open(DRAFT_DB, 1);
    request2.onupgradeneeded = () => request2.result.createObjectStore(DRAFT_STORE);
    request2.onsuccess = () => resolve(request2.result);
    request2.onerror = () => reject(request2.error);
  });
}
async function readDraft() {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const request2 = database.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).get(DRAFT_KEY);
    request2.onsuccess = () => resolve(request2.result);
    request2.onerror = () => reject(request2.error);
  }).finally(() => database.close());
}
async function writeDraft(draft) {
  const database = await openDraftDatabase();
  await new Promise((resolve, reject) => {
    const request2 = database.transaction(DRAFT_STORE, "readwrite").objectStore(DRAFT_STORE).put(draft, DRAFT_KEY);
    request2.onsuccess = () => resolve();
    request2.onerror = () => reject(request2.error);
  });
  database.close();
}
async function deleteDraft() {
  const database = await openDraftDatabase();
  await new Promise((resolve, reject) => {
    const request2 = database.transaction(DRAFT_STORE, "readwrite").objectStore(DRAFT_STORE).delete(DRAFT_KEY);
    request2.onsuccess = () => resolve();
    request2.onerror = () => reject(request2.error);
  });
  database.close();
}
function CreateReportDialog({
  open: controlledOpen,
  onOpenChange,
  trigger
} = {}) {
  const navigate = useNavigate();
  const { user } = useAuthSession();
  const [internalOpen, setInternalOpen] = useState5(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [concern, setConcern] = useState5("");
  const [description, setDescription] = useState5("");
  const [visibility, setVisibility] = useState5("community");
  const [visibilityMenuOpen, setVisibilityMenuOpen] = useState5(false);
  const [moreOpen, setMoreOpen] = useState5(false);
  const [locationOpen, setLocationOpen] = useState5(false);
  const [address, setAddress] = useState5("");
  const [addressPrimary, setAddressPrimary] = useState5("");
  const [addressSecondary, setAddressSecondary] = useState5("");
  const [locationPin, setLocationPin] = useState5(null);
  const [mediaFiles, setMediaFiles] = useState5([]);
  const [previewUrl, setPreviewUrl] = useState5(null);
  const [isSubmitting, setIsSubmitting] = useState5(false);
  const [isCheckingMedia, setIsCheckingMedia] = useState5(false);
  const [submittedReport, setSubmittedReport] = useState5(null);
  const [fieldErrors, setFieldErrors] = useState5({});
  const [draftRestored, setDraftRestored] = useState5(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState5(false);
  const clientRequestIdRef = useRef5(crypto.randomUUID());
  const fileInputRef = useRef5(null);
  const previewUrls = useMemo(
    () => mediaFiles.map((file) => URL.createObjectURL(file)),
    [mediaFiles]
  );
  const displayName = user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident" : "Resident";
  const letter = (user?.firstName?.[0] || user?.lastName?.[0] || displayName[0] || "?").toUpperCase();
  const rawStreet = (user?.address || "").split(",")[0]?.trim() || "";
  const userStreet = !rawStreet || rawStreet.toLowerCase() === "pending" ? "" : rawStreet;
  useEffect5(() => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), [previewUrls]);
  useEffect5(() => {
    if (!open || draftRestored) return;
    void readDraft().then((draft) => {
      if (!draft) return;
      setConcern(draft.concern);
      setDescription(draft.description);
      setAddress(draft.address);
      const parts = draft.address.split(",").map((p) => p.trim());
      setAddressPrimary(parts[0] || draft.address);
      setAddressSecondary(parts.slice(1).join(", "));
      setVisibility(draft.visibility);
      setLocationPin(draft.locationPin);
    }).finally(() => setDraftRestored(true));
  }, [open, draftRestored]);
  useEffect5(() => {
    if (!open || !draftRestored || !concern && !description && !address && !locationPin) return;
    const timeout = window.setTimeout(() => {
      void writeDraft({
        concern,
        title: description.trim().slice(0, 80),
        description,
        address,
        visibility,
        locationPin
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [open, draftRestored, concern, description, address, visibility, locationPin]);
  function resetForm() {
    setConcern("");
    setDescription("");
    setVisibility("community");
    setAddress("");
    setAddressPrimary("");
    setAddressSecondary("");
    setLocationPin(null);
    setMediaFiles([]);
    setPreviewUrl(null);
    setFieldErrors({});
    setMoreOpen(false);
    setLocationOpen(false);
    setVisibilityMenuOpen(false);
    setCloseConfirmOpen(false);
    clientRequestIdRef.current = crypto.randomUUID();
    setDraftRestored(false);
  }
  function hasDraftContent() {
    return Boolean(
      concern.trim() || description.trim() || address.trim() || locationPin || mediaFiles.length > 0
    );
  }
  function buildDraftPayload() {
    return {
      concern,
      title: description.trim().slice(0, 80),
      description,
      address,
      visibility,
      locationPin
    };
  }
  function requestClose() {
    if (isSubmitting) return;
    setMoreOpen(false);
    setLocationOpen(false);
    setVisibilityMenuOpen(false);
    if (hasDraftContent()) {
      setCloseConfirmOpen(true);
      return;
    }
    void deleteDraft().catch(() => void 0);
    setCloseConfirmOpen(false);
    setOpen(false);
  }
  async function confirmCloseAndSaveDraft() {
    try {
      if (hasDraftContent()) {
        await writeDraft(buildDraftPayload());
        toast("Draft saved.", {
          duration: 2800,
          className: "!rounded-2xl !border-0 !bg-[#5b6b7c] !px-5 !py-3 !text-[15px] !font-medium !text-white !shadow-lg"
        });
      } else {
        await deleteDraft();
      }
    } catch {
      toast.error("Could not save draft.");
    }
    setCloseConfirmOpen(false);
    setMoreOpen(false);
    setLocationOpen(false);
    setOpen(false);
  }
  function keepPosting() {
    setCloseConfirmOpen(false);
  }
  function validate() {
    const errors = {};
    if (!concern) errors.concern = "Choose a category.";
    if (!description.trim()) errors.description = "Describe what happened.";
    if (description.trim().length < 20)
      errors.description = "Please provide at least 20 characters for context.";
    if (!locationPin || !address.trim()) errors.address = "Pin a location for this report.";
    if (!mediaFiles.length) errors.media = "Add at least one clear photo as evidence.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }
  function cleanMediaErrorMessage(raw) {
    let text = raw.trim();
    const afterColon = text.includes(":") ? text.slice(text.lastIndexOf(":") + 1).trim() : text;
    text = afterColon || text;
    if (text.startsWith("[") && text.endsWith("]") || text.startsWith("('") && text.endsWith("')")) {
      text = text.replace(/^[\[(]+|[)\]]+$/g, "").trim();
    }
    text = text.replace(/^['"]+|['"]+$/g, "").trim();
    return text || "This photo could not be validated.";
  }
  function mediaErrorFromUnknown(error) {
    if (error instanceof ApiError && error.data && typeof error.data === "object") {
      const data = error.data;
      const media = data.media;
      if (Array.isArray(media) && media.length > 0) {
        return media.map((item) => cleanMediaErrorMessage(String(item))).filter(Boolean).join(" ");
      }
      const detail = data.detail;
      if (typeof detail === "string") return cleanMediaErrorMessage(detail);
    }
    if (error instanceof Error && error.message) {
      return cleanMediaErrorMessage(error.message);
    }
    return "This photo could not be validated.";
  }
  async function addFiles(files) {
    const errors = [];
    const valid = [];
    setIsCheckingMedia(true);
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push("Unsupported format. Use JPG or PNG.");
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push("File must be 2 MB or smaller.");
        continue;
      }
      if (mediaFiles.some(
        (existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified
      )) {
        errors.push("This file is already selected.");
        continue;
      }
      try {
        const checkData = new FormData();
        checkData.append("media", file);
        await checkConcernMedia(checkData);
        valid.push(file);
      } catch (error) {
        errors.push(mediaErrorFromUnknown(error));
      }
    }
    setMediaFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES));
    const unique = [...new Set(errors.filter(Boolean))];
    setFieldErrors((current) => ({
      ...current,
      // Newline-separated so the UI can list every media check message
      media: unique.length ? unique.join("\n") : ""
    }));
    setIsCheckingMedia(false);
  }
  async function handleSubmit() {
    if (!validate()) return;
    const title = description.trim().slice(0, 80);
    const formData = new FormData();
    formData.append("client_request_id", clientRequestIdRef.current);
    formData.append("title", title);
    formData.append("description", description.trim());
    formData.append(
      "category",
      concernConfig.find((c) => c.label === concern)?.value ?? "others"
    );
    formData.append("visibility", visibility);
    formData.append("address", address.trim());
    if (locationPin) {
      formData.append("latitude", locationPin.lat.toFixed(7));
      formData.append("longitude", locationPin.lng.toFixed(7));
      formData.append("location_source", locationPin.source ?? "manual_pin");
      if (locationPin.accuracy !== void 0 && locationPin.accuracy !== null) {
        formData.append("location_accuracy", String(locationPin.accuracy));
      }
    }
    for (const file of mediaFiles) formData.append("media", file);
    setIsSubmitting(true);
    try {
      const report = await createConcern(formData);
      await deleteDraft();
      setSubmittedReport(report);
      setOpen(false);
      window.dispatchEvent(new Event("eboses:report-created"));
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.data && typeof submitError.data === "object") {
        const nextErrors = {};
        for (const [key, value] of Object.entries(submitError.data)) {
          const first = Array.isArray(value) ? value[0] : value;
          if (typeof first === "string") nextErrors[key] = first;
        }
        setFieldErrors(nextErrors);
      }
      toast.error(
        submitError instanceof ApiError ? submitError.message : "Could not submit report. Try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }
  const selectedConcern = concernConfig.find((item) => item.label === concern);
  const isControlled = controlledOpen !== void 0;
  const hasMedia = mediaFiles.length > 0;
  return /* @__PURE__ */ React.createElement(React.Fragment, null, trigger ? trigger(() => setOpen(true)) : !isControlled ? /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setOpen(true),
      className: "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
    },
    /* @__PURE__ */ React.createElement(PlusIcon, { className: "size-5" }),
    "Create Report"
  ) : null, /* @__PURE__ */ React.createElement(
    Dialog,
    {
      open,
      onClose: requestClose,
      maxW: moreOpen ? "max-w-[820px]" : "max-w-[520px]"
    },
    /* @__PURE__ */ React.createElement(DialogBody, { className: "!space-y-0 !overflow-hidden !p-0 bg-white" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-h-[min(500px,88vh)] flex-col pt-4 md:flex-row md:pt-5" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-w-0 flex-1 flex-col" }, /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center gap-2.5 px-5" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: requestClose,
        className: "flex size-12 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100",
        "aria-label": "Close"
      },
      /* @__PURE__ */ React.createElement(XIcon4, { className: "size-6", strokeWidth: 2 })
    ), /* @__PURE__ */ React.createElement("div", { className: "relative ml-auto flex shrink-0 items-center gap-2.5" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setVisibilityMenuOpen((v) => !v),
        className: "inline-flex h-11 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-100/80 px-4 text-[15px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-100"
      },
      visibility === "community" ? /* @__PURE__ */ React.createElement(GlobeIcon, { className: "size-4" }) : /* @__PURE__ */ React.createElement(LockIcon, { className: "size-4" }),
      visibility === "community" ? "Anyone" : "Private",
      /* @__PURE__ */ React.createElement("span", { className: "text-[11px] text-neutral-400" }, "\u25BE")
    ), visibilityMenuOpen ? /* @__PURE__ */ React.createElement("div", { className: "absolute right-0 top-full z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg" }, [
      ["community", "Anyone", "Visible in the community feed"],
      ["private", "Private", "Only you and officials"]
    ].map(([value, label, helper]) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: value,
        type: "button",
        onClick: () => {
          setVisibility(value);
          setVisibilityMenuOpen(false);
        },
        className: cn(
          "flex w-full flex-col px-3.5 py-2.5 text-left hover:bg-neutral-50",
          visibility === value && "bg-neutral-50"
        )
      },
      /* @__PURE__ */ React.createElement("span", { className: "text-[13px] font-semibold text-neutral-900" }, label),
      /* @__PURE__ */ React.createElement("span", { className: "text-[11px] text-neutral-500" }, helper)
    ))) : null, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        disabled: isSubmitting || isCheckingMedia,
        onClick: () => void handleSubmit(),
        className: "inline-flex h-11 items-center justify-center rounded-full bg-[#ff6a1a] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#e85f12] disabled:opacity-60"
      },
      isSubmitting ? "Posting\u2026" : "Post"
    ))), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-3 px-5 pt-4" }, /* @__PURE__ */ React.createElement("span", { className: "inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-[#c5d0e6] text-[18px] font-semibold text-[#2c3a5a]" }, letter), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1" }, /* @__PURE__ */ React.createElement("p", { className: "truncate text-[16px] font-semibold leading-tight text-neutral-900" }, displayName), userStreet ? /* @__PURE__ */ React.createElement("p", { className: "truncate text-[13px] leading-tight text-neutral-500" }, userStreet) : null), selectedConcern ? /* @__PURE__ */ React.createElement("span", { className: "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] font-semibold text-neutral-700" }, /* @__PURE__ */ React.createElement(selectedConcern.icon, { className: "size-3.5", strokeWidth: 1.75 }), selectedConcern.label) : null), /* @__PURE__ */ React.createElement("div", { className: "flex min-h-0 flex-1 flex-col px-5 pt-4" }, /* @__PURE__ */ React.createElement(
      "textarea",
      {
        value: description,
        maxLength: descriptionMax,
        rows: 3,
        onChange: (e) => {
          setDescription(e.target.value);
          if (fieldErrors.description)
            setFieldErrors((prev) => ({ ...prev, description: "" }));
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
        },
        onInput: (e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
        },
        ref: (el) => {
          if (!el) return;
          el.style.height = "auto";
          el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 220)}px`;
        },
        placeholder: "What's happening in your barangay?",
        className: "max-h-[220px] min-h-[72px] w-full shrink-0 resize-none overflow-y-auto border-0 bg-transparent text-[17px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400"
      }
    ), hasMedia ? /* @__PURE__ */ React.createElement("div", { className: "mt-3 flex shrink-0 flex-wrap gap-2.5" }, mediaFiles.map((file, index) => {
      const url = previewUrls[index];
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: `${file.name}-${index}`,
          className: "relative h-[168px] w-[168px] overflow-hidden rounded-2xl bg-neutral-100 shadow-sm ring-1 ring-black/5 sm:h-[180px] sm:w-[180px]"
        },
        /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            className: "block h-full w-full",
            onClick: () => setPreviewUrl(url)
          },
          /* @__PURE__ */ React.createElement("img", { src: url, alt: "", className: "h-full w-full object-cover" })
        ),
        /* @__PURE__ */ React.createElement(
          "button",
          {
            type: "button",
            onClick: () => setMediaFiles((prev) => prev.filter((_, i) => i !== index)),
            className: "absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-[2px] transition-colors hover:bg-black/75",
            "aria-label": "Remove photo"
          },
          /* @__PURE__ */ React.createElement(XIcon4, { className: "size-4", strokeWidth: 2.25 })
        )
      );
    })) : null, /* @__PURE__ */ React.createElement("div", { className: "min-h-0 flex-1", "aria-hidden": true }), locationPin && address ? /* @__PURE__ */ React.createElement("div", { className: "mt-2 flex shrink-0 items-center gap-3 rounded-md border border-neutral-300 bg-white px-3.5 py-2.5" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setLocationOpen(true),
        className: "flex min-w-0 flex-1 items-center gap-3 text-left"
      },
      /* @__PURE__ */ React.createElement(
        "img",
        {
          src: "/contents/map-pin-gps.png",
          alt: "",
          className: "size-5 shrink-0 object-contain",
          "aria-hidden": true
        }
      ),
      /* @__PURE__ */ React.createElement("span", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("span", { className: "block truncate text-[14px] font-semibold leading-tight text-neutral-900" }, addressPrimary || address), addressSecondary ? /* @__PURE__ */ React.createElement("span", { className: "mt-0.5 block truncate text-[12px] leading-snug text-neutral-500" }, addressSecondary) : null)
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          setLocationPin(null);
          setAddress("");
          setAddressPrimary("");
          setAddressSecondary("");
        },
        className: "flex size-10 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800",
        "aria-label": "Remove location"
      },
      /* @__PURE__ */ React.createElement(XIcon4, { className: "size-6", strokeWidth: 1.75 })
    )) : null, (() => {
      const messages = [
        fieldErrors.description,
        fieldErrors.concern,
        // Media may contain multiple newline-separated check messages
        ...fieldErrors.media ? fieldErrors.media.split("\n").map((m) => m.trim()).filter(Boolean) : [],
        fieldErrors.address
      ].filter((msg) => Boolean(msg && msg.trim()));
      if (messages.length === 0) return null;
      return /* @__PURE__ */ React.createElement(
        "ul",
        {
          className: "mt-2 shrink-0 list-none space-y-1 text-xs font-medium text-destructive",
          role: "alert"
        },
        messages.map((msg) => /* @__PURE__ */ React.createElement("li", { key: msg }, msg))
      );
    })()), /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center gap-0.5 px-3 pb-3 pt-2 sm:px-4" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: fileInputRef,
        type: "file",
        accept: ACCEPT_STRING,
        multiple: true,
        className: "sr-only",
        onChange: (e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }
      }
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => fileInputRef.current?.click(),
        disabled: isCheckingMedia || mediaFiles.length >= MAX_FILES,
        className: cn(
          "flex size-11 items-center justify-center rounded-full transition-colors hover:bg-neutral-100 disabled:opacity-50",
          hasMedia ? "text-neutral-800" : "text-neutral-500 hover:text-neutral-800"
        ),
        "aria-label": "Add photo"
      },
      /* @__PURE__ */ React.createElement(ImageIcon, { className: "size-5", strokeWidth: 1.75 })
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setLocationOpen(true),
        className: cn(
          "flex size-11 items-center justify-center rounded-full transition-colors hover:bg-neutral-100",
          locationPin ? "text-neutral-800" : "text-neutral-500 hover:text-neutral-800"
        ),
        "aria-label": "Add location"
      },
      /* @__PURE__ */ React.createElement(MapPinIcon, { className: "size-5", strokeWidth: 1.75 })
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setMoreOpen((v) => !v),
        className: cn(
          "ml-auto inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors hover:bg-neutral-100",
          moreOpen || concern ? "text-neutral-800" : "text-neutral-500 hover:text-neutral-800"
        )
      },
      /* @__PURE__ */ React.createElement(LayoutGridIcon, { className: "size-4", strokeWidth: 1.75 }),
      "Category"
    ))), moreOpen ? /* @__PURE__ */ React.createElement("aside", { className: "flex min-h-0 w-full shrink-0 flex-col self-stretch bg-white md:w-[260px]" }, /* @__PURE__ */ React.createElement("div", { className: "mx-4 border-t border-neutral-200 md:hidden", "aria-hidden": true }), /* @__PURE__ */ React.createElement("div", { className: "relative flex min-h-0 flex-1 flex-col" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "pointer-events-none absolute bottom-5 left-0 top-5 hidden w-px bg-neutral-200 md:block",
        "aria-hidden": true
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "flex shrink-0 items-center px-4 pb-2 pt-4 md:pl-5" }, /* @__PURE__ */ React.createElement("h3", { className: "text-[15px] font-semibold text-neutral-900" }, "Category")), /* @__PURE__ */ React.createElement("div", { className: "flex min-h-0 flex-1 flex-col gap-1.5 px-2 pb-4 pt-1 md:min-h-[280px] md:pl-3" }, concernConfig.map((item) => {
      const Icon = item.icon;
      const selected = concern === item.label;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: item.label,
          type: "button",
          onClick: () => {
            setConcern(item.label);
            setFieldErrors((prev) => ({ ...prev, concern: "" }));
            setMoreOpen(false);
          },
          className: cn(
            "flex min-h-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left text-neutral-800 transition-colors",
            selected ? "bg-neutral-100" : "bg-transparent hover:bg-neutral-100"
          )
        },
        /* @__PURE__ */ React.createElement(Icon, { className: "size-5 shrink-0 text-neutral-600", strokeWidth: 1.75 }),
        /* @__PURE__ */ React.createElement("span", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("span", { className: "block text-[14px] font-semibold" }, item.label), /* @__PURE__ */ React.createElement("span", { className: "mt-0.5 block text-[12px] text-neutral-500" }, item.desc))
      );
    })))) : null))
  ), /* @__PURE__ */ React.createElement(Suspense, { fallback: null }, /* @__PURE__ */ React.createElement(
    LocationPickerModal2,
    {
      open: locationOpen,
      onClose: () => setLocationOpen(false),
      initialLat: locationPin?.lat,
      initialLng: locationPin?.lng,
      initialAddress: address,
      onConfirm: (payload) => {
        setLocationPin({
          lat: payload.lat,
          lng: payload.lng,
          accuracy: null,
          source: payload.source
        });
        setAddress(payload.address);
        setAddressPrimary(payload.addressPrimary);
        setAddressSecondary(payload.addressSecondary);
        setFieldErrors((prev) => ({ ...prev, address: "" }));
      }
    }
  )), submittedReport ? /* @__PURE__ */ React.createElement(
    ReportStatusDialog,
    {
      open: true,
      onOpenChange: (value) => {
        if (!value) {
          resetForm();
          setSubmittedReport(null);
          setOpen(false);
        }
      },
      report: submittedReport,
      mode: statusModeFromReport(submittedReport),
      onTrack: () => {
        const reportId = submittedReport.public_id;
        resetForm();
        setSubmittedReport(null);
        setOpen(false);
        navigate(`/dashboard/reports/${reportId}`);
      }
    }
  ) : null, closeConfirmOpen ? /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "fixed inset-0 z-[260] flex items-center justify-center p-4",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "close-without-posting-title"
    },
    /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "absolute inset-0 bg-black/45",
        onClick: keepPosting,
        "aria-hidden": true
      }
    ),
    /* @__PURE__ */ React.createElement("div", { className: "relative z-10 w-full max-w-[340px] rounded-2xl border border-neutral-200 bg-white px-6 pb-6 pt-7 shadow-2xl" }, /* @__PURE__ */ React.createElement(
      "h2",
      {
        id: "close-without-posting-title",
        className: "text-center text-[20px] font-semibold tracking-tight text-neutral-900"
      },
      "Close without posting?"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => void confirmCloseAndSaveDraft(),
        className: "mt-6 flex h-12 w-full items-center justify-center rounded-full bg-neutral-200 text-[16px] font-semibold text-neutral-900 transition-colors hover:bg-neutral-300 active:scale-[0.99]"
      },
      "Close"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: keepPosting,
        className: "mt-3 flex h-11 w-full items-center justify-center rounded-full text-[15px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
      },
      "Keep posting"
    ))
  ) : null, previewUrl ? /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4",
      onClick: () => setPreviewUrl(null)
    },
    /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => setPreviewUrl(null),
        className: "absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white",
        "aria-label": "Close preview"
      },
      /* @__PURE__ */ React.createElement(XIcon4, { className: "size-5" })
    ),
    /* @__PURE__ */ React.createElement(
      "img",
      {
        src: previewUrl,
        alt: "",
        className: "max-h-[90vh] max-w-full rounded-lg object-contain",
        onClick: (e) => e.stopPropagation()
      }
    )
  ) : null);
}

// src/features/dashboard/components/notification-popover.tsx
import * as React5 from "react";
import { useNavigate as useNavigate2 } from "react-router-dom";
import { createPortal as createPortal4 } from "react-dom";
import {
  AlertTriangleIcon as AlertTriangleIcon2,
  Building2Icon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  MegaphoneIcon,
  SearchIcon as SearchIcon3,
  SlidersHorizontalIcon,
  XIcon as XIcon5
} from "lucide-react";

// src/components/box-bell-icon.tsx
init_utils();
function BoxBellIcon({
  className,
  sizeClass = "size-6"
}) {
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      className: cn(
        "inline-block shrink-0 bg-current text-[#07145f]",
        sizeClass,
        className
      ),
      style: {
        WebkitMaskImage: "url(/contents/notification-bell.png)",
        maskImage: "url(/contents/notification-bell.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center"
      },
      "aria-hidden": "true"
    }
  );
}

// src/features/dashboard/components/notification-popover.tsx
init_utils();

// src/features/dashboard/components/notification-context.tsx
init_api();
import * as React4 from "react";

// src/features/dashboard/browser-notifications.ts
init_api();

// src/features/dashboard/components/notification-context.tsx
var NotificationContext = React4.createContext(null);
function useNotifications() {
  const ctx = React4.useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be inside NotificationProvider");
  return ctx;
}

// src/features/dashboard/components/notification-popover.tsx
var FILTERS = [
  { key: "all", label: "All" },
  { key: "announcements", label: "Announcements" },
  { key: "alerts", label: "Alerts" },
  { key: "reports", label: "Reports" }
];
function filterMatches(item, filter) {
  if (filter === "all") return true;
  const type = item.type.toLowerCase();
  if (filter === "announcements") return type.includes("announcement");
  if (filter === "alerts") return type.includes("emergency") || type.includes("alert") || Boolean(item.emergency_id);
  return Boolean(item.concern_id) || type.includes("report") || ["submitted", "assigned", "resolved", "rejected"].includes(type);
}
function timeAgo(value) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 6e4));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function reportStatusHeadline(item) {
  const status = (item.concern_status || item.type || "").toLowerCase();
  if (status === "submitted" || status === "under_review") return "Your report is under review.";
  if (status === "assigned" || status === "in_progress") return "Your report has been assigned.";
  if (status === "resolved") return "Your report has been resolved.";
  if (status === "rejected") return "Your report was not approved.";
  if (status === "appealed") return "Your appeal is under review.";
  return "Your report was updated.";
}
function notificationMeta(item) {
  const type = item.type.toLowerCase();
  if (type.includes("announcement")) {
    return {
      source: "BARANGAY ANNOUNCEMENT",
      icon: MegaphoneIcon,
      iconClass: "bg-[#6b8cff] text-white",
      cardClass: "border-[#d9deec] bg-[#f8f9fd]",
      unreadClass: "border-[#bdc9ff] bg-[#f3f6ff]",
      unreadDotClass: "bg-[#6b8cff]",
      titleClass: "text-[#07145f]",
      sourceClass: "text-[#07145f]",
      avatarText: item.title.trim().slice(0, 2).toUpperCase() || "BA"
    };
  }
  if (type.includes("emergency") || type.includes("alert") || item.emergency_id) {
    return {
      source: "E-BOSES ALERT",
      icon: AlertTriangleIcon2,
      iconClass: "bg-red-100 text-red-600",
      cardClass: "border-red-200 bg-red-50",
      unreadClass: "border-red-300 bg-red-50 shadow-[0_2px_8px_rgba(220,38,38,0.12)]",
      unreadDotClass: "bg-red-500",
      titleClass: "text-red-950",
      sourceClass: "text-red-700"
    };
  }
  if (type.includes("resolved")) {
    return {
      source: reportStatusHeadline(item),
      icon: CheckCircleIcon,
      iconClass: "bg-[#eef3ff] text-[#07145f]",
      cardClass: "border-[#dfe7f5] bg-white",
      unreadClass: "border-[#cbd8ee] bg-[#fbfcff]",
      unreadDotClass: "bg-red-500",
      titleClass: "text-[#07145f]",
      sourceClass: "text-[#0f9f46]"
    };
  }
  if (type.includes("barangay") || type.includes("advisory")) {
    return {
      source: "BARANGAY ANNOUNCEMENT",
      icon: Building2Icon,
      iconClass: "bg-[#6b8cff] text-white",
      cardClass: "border-[#d9deec] bg-[#f8f9fd]",
      unreadClass: "border-[#bdc9ff] bg-[#f3f6ff]",
      unreadDotClass: "bg-[#6b8cff]",
      titleClass: "text-[#07145f]",
      sourceClass: "text-[#07145f]",
      avatarText: item.title.trim().slice(0, 2).toUpperCase() || "BA"
    };
  }
  return {
    source: reportStatusHeadline(item),
    icon: ClipboardListIcon,
    iconClass: "bg-[#fff1ea] text-[#ff5003]",
    cardClass: "border-[#dfe7f5] bg-white",
    unreadClass: "border-[#ffd0bd] bg-[#fff9f5] shadow-[0_2px_8px_rgba(255,106,26,0.10)]",
    unreadDotClass: "bg-red-500",
    titleClass: "text-[#07145f]",
    sourceClass: "text-[#0f9f46]"
  };
}
function NotificationRow({
  item,
  onMarkRead
}) {
  const navigate = useNavigate2();
  const meta = notificationMeta(item);
  const Icon = meta.icon;
  return /* @__PURE__ */ React5.createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        if (!item.is_read) onMarkRead(item.id);
        if (item.emergency_id) {
          navigate(`/dashboard/emergency-history?alert=${item.emergency_public_id || item.emergency_id}`);
          return;
        }
        if (!item.concern_id) return;
        navigate(`/dashboard/reports/${item.concern_public_id || item.concern_id}`);
      },
      className: cn(
        "relative flex min-h-[86px] w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:border-[#cbd8ee] md:min-h-[90px]",
        item.is_read ? "border-[#d9deec] bg-[#f3f4f8] shadow-none" : cn("shadow-[0_1px_4px_rgba(7,20,95,0.10)]", meta.cardClass, meta.unreadClass)
      )
    },
    /* @__PURE__ */ React5.createElement("div", { className: cn("relative mt-1 flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold md:size-11", meta.iconClass) }, meta.avatarText ? meta.avatarText : /* @__PURE__ */ React5.createElement(Icon, { className: "size-5 md:size-5.5", strokeWidth: 2.4 }), !item.is_read ? /* @__PURE__ */ React5.createElement("span", { className: "absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-white bg-red-500" }) : null),
    /* @__PURE__ */ React5.createElement("div", { className: "min-w-0 flex-1 pr-12" }, /* @__PURE__ */ React5.createElement("p", { className: cn("text-[10px] font-black leading-3 tracking-normal", item.is_read ? "text-[#8b96b8]" : meta.sourceClass) }, meta.source), /* @__PURE__ */ React5.createElement("p", { className: cn("mt-1 truncate text-sm font-extrabold leading-tight md:text-[15px]", item.is_read ? "text-[#5f6885]" : meta.titleClass) }, item.title), item.body ? /* @__PURE__ */ React5.createElement("p", { className: cn("mt-1 line-clamp-2 text-xs font-medium leading-4 md:text-[13px]", item.is_read ? "text-[#7b849d]" : "text-[#43507f]") }, item.body) : null),
    /* @__PURE__ */ React5.createElement("span", { className: "absolute right-3 top-3 text-[10px] font-semibold text-[#8b96b8]" }, timeAgo(item.created_at))
  );
}
function NotificationList({
  notifications,
  filter,
  query,
  onMarkRead
}) {
  const needle = query.trim().toLowerCase();
  const filtered = notifications.filter((n) => filterMatches(n, filter)).filter((n) => {
    if (!needle) return true;
    return `${n.title} ${n.body} ${n.type}`.toLowerCase().includes(needle);
  });
  if (filtered.length === 0) {
    const emptyContent = (() => {
      if (filter === "announcements") return { img: "announcements.png", text: "No announcements", sub: "Check back later for new barangay updates." };
      if (filter === "alerts") return { img: "alerts.png", text: "No alerts", sub: "Stay attentive. No emergencies at the moment." };
      if (filter === "reports") return { img: "reports.png", text: "No reports", sub: "Your submitted reports progress will appear here." };
      return { img: "notifications.png", text: "No notifications yet", sub: "Stay tuned for updates from your barangay." };
    })();
    return /* @__PURE__ */ React5.createElement("div", { className: "flex flex-col items-center justify-center gap-1 py-12 text-[#68739c]" }, /* @__PURE__ */ React5.createElement("img", { src: `/contents/${emptyContent.img}`, alt: "", className: "mb-4 h-32 w-auto", "aria-hidden": "true" }), /* @__PURE__ */ React5.createElement("p", { className: "text-sm font-semibold" }, emptyContent.text), /* @__PURE__ */ React5.createElement("p", { className: "text-xs" }, emptyContent.sub));
  }
  return /* @__PURE__ */ React5.createElement("div", { className: "flex flex-col gap-3 px-4 py-4 pb-8 md:px-5" }, filtered.map((n) => /* @__PURE__ */ React5.createElement(NotificationRow, { key: n.id, item: n, onMarkRead })));
}
function DesktopPanel({
  loading,
  notifications,
  onMarkAllRead,
  onMarkRead,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  onClose
}) {
  return /* @__PURE__ */ React5.createElement("div", { className: "flex h-full min-h-0 flex-col overflow-hidden bg-white" }, /* @__PURE__ */ React5.createElement("div", { className: "flex shrink-0 items-center justify-between px-7 py-6" }, /* @__PURE__ */ React5.createElement("h3", { className: "font-heading text-2xl font-extrabold text-[#07145f]" }, "Notifications"), /* @__PURE__ */ React5.createElement("div", { className: "flex items-center gap-5" }, /* @__PURE__ */ React5.createElement(
    "button",
    {
      type: "button",
      onClick: onMarkAllRead,
      className: "text-sm font-bold text-[#0057ff] transition-colors hover:text-[#ff6a1a]"
    },
    "Mark all as read"
  ), /* @__PURE__ */ React5.createElement("button", { type: "button", onClick: onClose, className: "text-[#07145f] transition-colors hover:text-[#ff6a1a]", "aria-label": "Close notifications" }, /* @__PURE__ */ React5.createElement(XIcon5, { className: "size-6" })))), /* @__PURE__ */ React5.createElement("div", { className: "scrollbar-hide flex shrink-0 gap-5 overflow-x-auto border-b border-[#dfe7f5] px-7 pb-4", style: { scrollbarWidth: "none" } }, FILTERS.map((f) => /* @__PURE__ */ React5.createElement(
    "button",
    {
      key: f.key,
      type: "button",
      onClick: () => onFilterChange(f.key),
      className: cn(
        "shrink-0 rounded-full px-6 py-2.5 text-sm font-extrabold transition-colors",
        filter === f.key ? "bg-[#ff6a1a] text-white" : "text-[#07145f] hover:bg-[#eef3ff]"
      )
    },
    f.label
  ))), /* @__PURE__ */ React5.createElement("div", { className: "grid shrink-0 grid-cols-[130px_minmax(0,1fr)_48px] gap-3 px-7 py-5" }, /* @__PURE__ */ React5.createElement("button", { type: "button", className: "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#dfe7f5] bg-white text-sm font-semibold text-[#07145f]" }, "Newest first", /* @__PURE__ */ React5.createElement(ChevronRightIcon, { className: "size-4 rotate-90" })), /* @__PURE__ */ React5.createElement("div", { className: "relative" }, /* @__PURE__ */ React5.createElement(SearchIcon3, { className: "pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#2447b3]" }), /* @__PURE__ */ React5.createElement(
    "input",
    {
      value: query,
      onChange: (event) => onQueryChange(event.target.value),
      placeholder: "Search notifications",
      className: "h-10 w-full rounded-lg border border-[#dfe7f5] bg-white pl-11 pr-4 text-sm font-semibold text-[#07145f] outline-none placeholder:text-[#8b96b8] focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
    }
  )), /* @__PURE__ */ React5.createElement("button", { type: "button", className: "flex h-10 items-center justify-center rounded-lg border border-[#dfe7f5] bg-white text-[#2447b3] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a]", "aria-label": "Filter notifications" }, /* @__PURE__ */ React5.createElement(SlidersHorizontalIcon, { className: "size-5" }))), /* @__PURE__ */ React5.createElement("div", { className: "min-h-0 flex-1 overflow-y-auto", style: { scrollbarWidth: "none" } }, loading ? /* @__PURE__ */ React5.createElement("div", { className: "flex flex-col items-center justify-center gap-2 py-12 text-[#68739c]" }, /* @__PURE__ */ React5.createElement("p", { className: "text-sm font-semibold" }, "Loading...")) : /* @__PURE__ */ React5.createElement(
    NotificationList,
    {
      notifications,
      filter,
      query,
      onMarkRead
    }
  )));
}
function MobileSheet({
  unreadCount,
  loading,
  notifications,
  onMarkRead,
  filter,
  onFilterChange
}) {
  const [open, setOpen] = React5.useState(false);
  React5.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const sheet = open && typeof document !== "undefined" ? createPortal4(
    /* @__PURE__ */ React5.createElement(
      "div",
      {
        className: "fixed inset-0 z-[220] flex items-end justify-center bg-black/55 md:hidden",
        onClick: () => setOpen(false)
      },
      /* @__PURE__ */ React5.createElement(
        "div",
        {
          className: "flex h-[82dvh] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-t-[32px] bg-white shadow-2xl",
          onClick: (e) => e.stopPropagation()
        },
        /* @__PURE__ */ React5.createElement("div", { className: "mx-auto mt-4 h-2 w-24 shrink-0 rounded-full bg-[#d8deee]" }),
        /* @__PURE__ */ React5.createElement("div", { className: "flex shrink-0 items-center justify-between px-6 pb-4 pt-7" }, /* @__PURE__ */ React5.createElement("h3", { className: "font-heading text-2xl font-extrabold text-[#07145f]" }, "Notifications"), /* @__PURE__ */ React5.createElement(
          "button",
          {
            type: "button",
            onClick: () => setOpen(false),
            className: "flex size-9 items-center justify-center rounded-full text-[#07145f] hover:bg-[#eef3ff]",
            "aria-label": "Close notifications"
          },
          /* @__PURE__ */ React5.createElement(XIcon5, { className: "size-7", strokeWidth: 2 })
        )),
        /* @__PURE__ */ React5.createElement("div", { className: "scrollbar-hide flex shrink-0 gap-2 overflow-x-auto border-b border-[#dfe7f5] px-6 pb-4", style: { scrollbarWidth: "none" } }, FILTERS.map((f) => /* @__PURE__ */ React5.createElement(
          "button",
          {
            key: f.key,
            type: "button",
            onClick: () => onFilterChange(f.key),
            className: cn(
              "shrink-0 rounded-full px-4 py-2 text-sm font-extrabold transition-colors",
              filter === f.key ? "bg-[#ff6a1a] text-white" : "text-[#07145f] hover:bg-[#eef3ff]"
            )
          },
          f.label
        ))),
        /* @__PURE__ */ React5.createElement("div", { className: "min-h-0 flex-1 overflow-y-auto" }, loading ? /* @__PURE__ */ React5.createElement("div", { className: "flex flex-col items-center justify-center gap-2 py-12 text-[#68739c]" }, /* @__PURE__ */ React5.createElement("p", { className: "text-sm font-semibold" }, "Loading...")) : /* @__PURE__ */ React5.createElement(
          NotificationList,
          {
            notifications,
            filter,
            query: "",
            onMarkRead
          }
        ))
      )
    ),
    document.body
  ) : null;
  return /* @__PURE__ */ React5.createElement(React5.Fragment, null, /* @__PURE__ */ React5.createElement(
    "button",
    {
      type: "button",
      onClick: () => setOpen(true),
      className: "relative flex size-10 items-center justify-center rounded-full text-[#07145f] md:hidden",
      "aria-label": "Open notifications"
    },
    /* @__PURE__ */ React5.createElement(BoxBellIcon, { sizeClass: "size-5" }),
    unreadCount > 0 && /* @__PURE__ */ React5.createElement("span", { className: "absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white" }, unreadCount > 9 ? "9+" : unreadCount)
  ), sheet);
}
function NotificationPopover() {
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications();
  const [filter, setFilter] = React5.useState("all");
  const [query, setQuery] = React5.useState("");
  const [desktopOpen, setDesktopOpen] = React5.useState(false);
  React5.useEffect(() => {
    if (!desktopOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e) {
      if (e.key === "Escape") setDesktopOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [desktopOpen]);
  const desktopOverlay = desktopOpen && typeof document !== "undefined" ? createPortal4(
    /* @__PURE__ */ React5.createElement(
      "div",
      {
        className: "fixed inset-0 z-[220] hidden bg-black/55 md:block",
        onClick: () => setDesktopOpen(false)
      },
      /* @__PURE__ */ React5.createElement(
        "div",
        {
          className: "fixed bottom-0 right-0 top-0 flex w-[620px] max-w-[calc(100vw-3rem)] flex-col bg-white shadow-2xl",
          onClick: (e) => e.stopPropagation()
        },
        /* @__PURE__ */ React5.createElement(
          DesktopPanel,
          {
            loading,
            notifications,
            unreadCount,
            onMarkAllRead: () => void markAllAsRead(),
            onMarkRead: (id) => void markAsRead(id),
            filter,
            onFilterChange: setFilter,
            query,
            onQueryChange: setQuery,
            onClose: () => setDesktopOpen(false)
          }
        )
      )
    ),
    document.body
  ) : null;
  return /* @__PURE__ */ React5.createElement(React5.Fragment, null, /* @__PURE__ */ React5.createElement(
    "button",
    {
      type: "button",
      onClick: () => setDesktopOpen(true),
      className: "relative hidden size-10 items-center justify-center rounded-full text-[#07145f] md:flex",
      "aria-label": "Open notifications"
    },
    /* @__PURE__ */ React5.createElement(BoxBellIcon, { sizeClass: "size-6" }),
    unreadCount > 0 && /* @__PURE__ */ React5.createElement("span", { className: "absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#ff6a1a] text-[11px] font-extrabold text-white" }, unreadCount > 9 ? "9+" : unreadCount)
  ), desktopOverlay, /* @__PURE__ */ React5.createElement(
    MobileSheet,
    {
      unreadCount,
      loading,
      notifications,
      onMarkRead: (id) => void markAsRead(id),
      filter,
      onFilterChange: setFilter
    }
  ));
}

// src/features/dashboard/components/profile-account-menu.tsx
import { useState as useState8 } from "react";
import { Link, useNavigate as useNavigate3 } from "react-router-dom";
import { ChevronDownIcon, LogOutIcon, PlusCircleIcon } from "lucide-react";
init_utils();
function LetterAvatar({
  letter,
  className
}) {
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      className: cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[#c5d0e6] font-semibold text-[#2c3a5a]",
        className
      )
    },
    letter
  );
}
function ProfileAccountMenu({
  placeLabel = "Marikina Heights",
  className
}) {
  const { user, signOut } = useAuthSession();
  const navigate = useNavigate3();
  const [open, setOpen] = useState8(false);
  const [signingOut, setSigningOut] = useState8(false);
  const displayName = user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident" : "Resident";
  const letter = (user?.firstName?.[0] || displayName[0] || "?").toUpperCase();
  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate("/sign-in", { replace: true });
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  }
  return /* @__PURE__ */ React.createElement(Popover, { open, onOpenChange: setOpen }, /* @__PURE__ */ React.createElement(
    PopoverTrigger,
    {
      className: cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none",
        "hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-200",
        className
      ),
      "aria-label": "Account menu"
    },
    /* @__PURE__ */ React.createElement(LetterAvatar, { letter, className: "size-9 text-[16px]" }),
    /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-neutral-300",
        "aria-hidden": true
      },
      /* @__PURE__ */ React.createElement(ChevronDownIcon, { className: "size-2.5 text-neutral-800", strokeWidth: 3 })
    )
  ), /* @__PURE__ */ React.createElement(
    PopoverContent,
    {
      className: "w-[280px] overflow-hidden rounded-2xl border-[1.5px] border-solid border-[#d0d0d0] bg-white p-0 shadow-[0_8px_30px_rgba(15,23,42,0.12)]",
      side: "bottom"
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex flex-col items-center px-5 pb-4 pt-6 text-center" }, /* @__PURE__ */ React.createElement(LetterAvatar, { letter, className: "size-16 text-2xl" }), /* @__PURE__ */ React.createElement("p", { className: "mt-3 text-[16px] font-semibold leading-tight text-neutral-900" }, displayName), /* @__PURE__ */ React.createElement("p", { className: "mt-1 text-[13px] font-normal text-neutral-500" }, placeLabel), /* @__PURE__ */ React.createElement(
      Link,
      {
        to: "/dashboard/profile",
        onClick: () => setOpen(false),
        className: "mt-4 inline-flex h-9 items-center justify-center rounded-full border-[1.5px] border-solid border-[#d0d0d0] bg-white px-5 text-[14px] font-semibold text-neutral-800 no-underline transition-colors hover:bg-neutral-50"
      },
      "View profile"
    )),
    /* @__PURE__ */ React.createElement("div", { className: "border-t-[1.5px] border-solid border-[#d0d0d0]" }),
    /* @__PURE__ */ React.createElement(
      Link,
      {
        to: "/dashboard/settings",
        onClick: () => setOpen(false),
        className: "flex items-center gap-3 px-5 py-3.5 text-[15px] font-medium text-neutral-800 no-underline transition-colors hover:bg-neutral-50"
      },
      /* @__PURE__ */ React.createElement(PlusCircleIcon, { className: "size-5 shrink-0 text-neutral-700", strokeWidth: 1.75 }),
      "Settings"
    ),
    /* @__PURE__ */ React.createElement("div", { className: "border-t-[1.5px] border-solid border-[#d0d0d0]" }),
    /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        onClick: () => void handleSignOut(),
        disabled: signingOut,
        className: "flex w-full items-center gap-3 px-5 py-3.5 text-left text-[15px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-60"
      },
      /* @__PURE__ */ React.createElement(LogOutIcon, { className: "size-5 shrink-0 text-neutral-700", strokeWidth: 1.75 }),
      signingOut ? "Signing out\u2026" : "Sign out"
    )
  ));
}

// src/features/dashboard/components/resident-search-context.tsx
import * as React6 from "react";
var ResidentSearchContext = React6.createContext(null);
function useResidentSearch() {
  const ctx = React6.useContext(ResidentSearchContext);
  if (!ctx) {
    return {
      search: "",
      setSearch: (_) => {
      }
    };
  }
  return ctx;
}

// src/features/dashboard/components/resident-top-bar.tsx
import { Link as Link2, useLocation } from "react-router-dom";

// src/features/dashboard/components/rotating-search-field.tsx
init_utils();
import { useEffect as useEffect8, useState as useState10 } from "react";
import { SearchIcon as SearchIcon4 } from "lucide-react";
var SEARCH_WORDS = [
  "concerns",
  "reports",
  "flooding",
  "roads",
  "neighbors",
  "announcements",
  "streetlights",
  "garbage"
];
var LONGEST_WORD = SEARCH_WORDS.reduce((a, b) => a.length >= b.length ? a : b, SEARCH_WORDS[0]);
var CYCLE_MS = 2400;
var TEXT = "text-[15px] leading-none font-normal tracking-normal";
function RotatingSearchField({
  value,
  onChange,
  className,
  inputClassName,
  maxWidth = 420
}) {
  const [index, setIndex] = useState10(0);
  const [focused, setFocused] = useState10(false);
  const [reduceMotion, setReduceMotion] = useState10(false);
  useEffect8(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    function onMq() {
      setReduceMotion(mq.matches);
    }
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);
  useEffect8(() => {
    if (value.trim() || focused) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % SEARCH_WORDS.length);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [value, focused]);
  const showHint = !value.trim() && !focused;
  const word = SEARCH_WORDS[index];
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className: cn("relative mx-auto w-full", className),
      style: { maxWidth }
    },
    /* @__PURE__ */ React.createElement("style", null, `
        @keyframes eboses-search-word {
          0% {
            opacity: 0;
            transform: translate3d(0, 100%, 0);
          }
          12% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
          80% {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
          100% {
            opacity: 0;
            transform: translate3d(0, -100%, 0);
          }
        }
      `),
    /* @__PURE__ */ React.createElement("div", { className: "relative h-11" }, /* @__PURE__ */ React.createElement(
      SearchIcon4,
      {
        className: "pointer-events-none absolute left-3.5 top-1/2 z-[2] size-[18px] -translate-y-1/2 text-neutral-600",
        strokeWidth: 2.25,
        "aria-hidden": true
      }
    ), showHint ? /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cn(
          "pointer-events-none absolute inset-0 z-[1] flex items-center pl-11 pr-4",
          TEXT,
          "text-neutral-500"
        ),
        "aria-hidden": true
      },
      /* @__PURE__ */ React.createElement("span", { className: "flex items-center whitespace-nowrap" }, /* @__PURE__ */ React.createElement("span", { className: "shrink-0" }, "Search for\xA0"), /* @__PURE__ */ React.createElement("span", { className: "relative inline-flex h-[1.25rem] items-center overflow-hidden" }, /* @__PURE__ */ React.createElement(
        "span",
        {
          className: "invisible whitespace-nowrap font-semibold",
          "aria-hidden": true
        },
        LONGEST_WORD
      ), /* @__PURE__ */ React.createElement(
        "span",
        {
          key: word,
          className: "absolute left-0 top-0 flex h-full w-full items-center whitespace-nowrap font-semibold text-neutral-900",
          style: reduceMotion ? void 0 : {
            animation: `eboses-search-word ${CYCLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`,
            willChange: "transform, opacity",
            backfaceVisibility: "hidden"
          }
        },
        word
      )))
    ) : null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "search",
        value,
        onChange: (e) => onChange(e.target.value),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        placeholder: focused && !value ? "Search\u2026" : "",
        "aria-label": "Search feed",
        className: cn(
          "absolute inset-0 h-11 w-full rounded-full border-[1.5px] border-solid border-[#d0d0d0] bg-white pl-11 pr-4",
          TEXT,
          "text-neutral-900 caret-neutral-900 shadow-none outline-none",
          "placeholder:text-neutral-500",
          "focus:border-[1.5px] focus:border-neutral-400 focus:ring-0",
          "[&::-webkit-search-cancel-button]:appearance-none",
          inputClassName
        )
      }
    ))
  );
}

// src/features/dashboard/components/resident-top-bar.tsx
var RESIDENT_FEED_MAX = 680;
var RESIDENT_SIDEBAR_W = 360;
var RESIDENT_RAIL_W = 288;
var RESIDENT_CONTENT_GAP = 24;
var RESIDENT_CONTENT_MAX = RESIDENT_FEED_MAX + RESIDENT_CONTENT_GAP + RESIDENT_RAIL_W;
var RESIDENT_LAYOUT_MIN = RESIDENT_SIDEBAR_W + RESIDENT_CONTENT_MAX;
var RESIDENT_DESKTOP_MIN_PX = 1024;
function ResidentContentGrid({
  children,
  className = "",
  align = "start"
}) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      className,
      style: {
        display: "grid",
        width: "100%",
        maxWidth: RESIDENT_CONTENT_MAX,
        marginLeft: "auto",
        marginRight: "auto",
        gridTemplateColumns: `minmax(0, ${RESIDENT_FEED_MAX}px) minmax(0, ${RESIDENT_RAIL_W}px)`,
        columnGap: RESIDENT_CONTENT_GAP,
        alignItems: align
      }
    },
    children
  );
}

// src/hooks/use-page-title.ts
import { useEffect as useEffect9 } from "react";
function usePageTitle(title, options = {}) {
  const { suffix = "E-Boses" } = options;
  useEffect9(() => {
    document.title = `${title} | ${suffix}`;
  }, [suffix, title]);
}

// src/features/dashboard/pages/home.tsx
var FS = {
  logo: "text-[20px]",
  place: "text-[19px]",
  search: "text-[16px]",
  composer: "text-[16px]",
  chip: "text-[15px]",
  author: "text-[16px]",
  meta: "text-[14px]",
  body: "text-[16px]",
  railTitle: "text-[16px]",
  railBody: "text-[15px]",
  railLink: "text-[13px]",
  engage: "text-[15px]",
  label: "text-[12px]",
  footer: "text-[15px]",
  /** Sidebar / primary nav + Report CTA */
  sidebar: "text-[16px]",
  section: "text-[17px]"
};
var IC = {
  /** 22px — sidebar / primary UI icons */
  md: "size-[22px]",
  /** 20px — engagement, search, chrome */
  sm: "size-5",
  /** 18px — meta / chevrons */
  xs: "size-[18px]",
  /** 16px — tiny meta (globe) */
  xxs: "size-4"
};
var STROKE = 1.5;
var reportReasons = [
  "Spam or off topic",
  "Hate speech or harassment",
  "False or misleading content",
  "Others (please specify)"
];
var FEED_TABS = [
  { id: "for_you", label: "For you" },
  { id: "recent", label: "Recent" },
  { id: "nearby", label: "Nearby" },
  { id: "trending", label: "Trending" }
];
function timeAgo2(value) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 6e4));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
function categoryLabel(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function UserAvatar({
  user,
  size = "md",
  className
}) {
  const sizeClass = size === "sm" ? "size-9 text-[16px]" : size === "lg" ? "size-11 text-[18px]" : "size-10 text-[17px]";
  const letter = (user?.full_name?.[0] || user?.initials?.[0] || "?").toUpperCase();
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      className: cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] font-semibold text-[#2c3a5a]",
        sizeClass,
        className
      )
    },
    letter
  );
}
var GET_STARTED_KEY = "eboses-home-get-started-dismissed";
var BARANGAY = "Marikina Heights";
var FEED_MAX = RESIDENT_FEED_MAX;
var RAIL_W = RESIDENT_RAIL_W;
var RAIL_CHEVRON = "size-7 shrink-0";
function streetLabelFromAddress(address) {
  if (!address?.trim()) return null;
  const first = address.split(",")[0]?.trim();
  if (!first || first.toLowerCase() === "pending") return null;
  return first;
}
function HomePage() {
  usePageTitle("Home");
  const { user, loading: authLoading } = useAuthSession();
  const { search, setSearch } = useResidentSearch();
  const [createOpen, setCreateOpen] = useState11(false);
  const [feedTab, setFeedTab] = useState11("for_you");
  const [loaded, setLoaded] = useState11(false);
  const [error, setError] = useState11("");
  const [announcements, setAnnouncements] = useState11([]);
  const [events, setEvents] = useState11([]);
  const [concerns, setConcerns] = useState11([]);
  const [getStartedOpen, setGetStartedOpen] = useState11(() => {
    try {
      return localStorage.getItem(GET_STARTED_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const [expandedComments, setExpandedComments] = useState11(/* @__PURE__ */ new Set());
  const [commentInputs, setCommentInputs] = useState11({});
  const [reportOpen, setReportOpen] = useState11(null);
  const [reportReason, setReportReason] = useState11("");
  const [reportOther, setReportOther] = useState11("");
  const [flaggingPost, setFlaggingPost] = useState11(null);
  const displayName = user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident" : "Resident";
  const streetLabel = streetLabelFromAddress(user?.address);
  const sessionUserAsPublic = user ? {
    id: user.id,
    full_name: displayName,
    role: user.role,
    initials: `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "?",
    last_seen_at: null,
    street: streetLabel ?? void 0,
    barangay: user.barangay || BARANGAY
  } : null;
  async function loadHome() {
    setError("");
    try {
      const [nextAnnouncements, nextConcerns, nextEvents] = await Promise.all([
        listAnnouncements(),
        listFeedConcerns("all", void 0, void 0, search || void 0),
        listTodayBarangayEvents()
      ]);
      setAnnouncements(nextAnnouncements);
      setConcerns(nextConcerns);
      setEvents(nextEvents);
    } catch {
      setError("Could not load home feed.");
    } finally {
      setLoaded(true);
    }
  }
  useEffect10(() => {
    if (authLoading) return;
    void loadHome();
    function refresh() {
      void loadHome();
    }
    const interval = window.setInterval(refresh, 3e4);
    window.addEventListener("eboses:report-created", refresh);
    window.addEventListener("eboses:concern-updated", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("eboses:report-created", refresh);
      window.removeEventListener("eboses:concern-updated", refresh);
    };
  }, [authLoading, search]);
  function dismissGetStarted() {
    setGetStartedOpen(false);
    try {
      localStorage.setItem(GET_STARTED_KEY, "1");
    } catch {
    }
  }
  async function handleVote(post) {
    const nextVote = post.user_vote === 1 ? 0 : 1;
    const result = await voteConcern(post.id, nextVote);
    setConcerns(
      (items) => items.map(
        (item) => item.id === post.id ? { ...item, user_vote: result.user_vote, vote_count: result.vote_count } : item
      )
    );
  }
  async function submitComment(postId) {
    const body = commentInputs[postId]?.trim();
    if (!body) return;
    await commentOnConcern(postId, { body });
    setCommentInputs((current) => ({ ...current, [postId]: "" }));
    await loadHome();
    setExpandedComments((current) => new Set(current).add(postId));
  }
  async function submitFlag(postId) {
    const reason = reportReason === "Others (please specify)" ? reportOther.trim() : reportReason;
    if (!reason) {
      toast2.error("Choose a reason before submitting.");
      return;
    }
    setFlaggingPost(postId);
    try {
      await flagConcern(postId, { reason, note: reportOther.trim() });
      toast2.success("Post flagged for review");
      setReportOpen(null);
      setReportReason("");
      setReportOther("");
    } catch (flagError) {
      toast2.error(flagError instanceof Error ? flagError.message : "Could not flag this post.");
    } finally {
      setFlaggingPost(null);
    }
  }
  const sortedConcerns = useMemo3(() => {
    const list = [...concerns];
    if (feedTab === "trending") {
      return list.sort(
        (a, b) => b.vote_count + b.comment_count - (a.vote_count + a.comment_count)
      );
    }
    return list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [concerns, feedTab]);
  if (!loaded) {
    return /* @__PURE__ */ React.createElement("div", { className: "min-h-0 flex-1 bg-white" }, /* @__PURE__ */ React.createElement("div", { className: "px-4 py-3" }, /* @__PURE__ */ React.createElement(Skeleton, { className: "mx-auto h-10 w-full max-w-md rounded-full" })), /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "mx-auto grid w-full gap-4 p-4 md:px-5",
        style: {
          maxWidth: FEED_MAX + RAIL_W + 16,
          gridTemplateColumns: `minmax(0, ${FEED_MAX}px) ${RAIL_W}px`
        }
      },
      /* @__PURE__ */ React.createElement("div", { className: "min-w-0 space-y-3" }, /* @__PURE__ */ React.createElement(Skeleton, { className: "h-14 w-full rounded-lg" }), /* @__PURE__ */ React.createElement(Skeleton, { className: "h-9 w-full rounded-md" }), /* @__PURE__ */ React.createElement(Skeleton, { className: "h-40 w-full rounded-lg" })),
      /* @__PURE__ */ React.createElement("div", { className: "hidden min-w-0 space-y-3 md:block" }, /* @__PURE__ */ React.createElement(Skeleton, { className: "h-24 w-full rounded-lg" }), /* @__PURE__ */ React.createElement(Skeleton, { className: "h-48 w-full rounded-lg" }))
    ));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "flex min-h-0 flex-1 flex-col bg-white" }, /* @__PURE__ */ React.createElement("style", null, `
        .resident-mobile-top { display: none; }
        .resident-mobile-only { display: none; }
        .resident-home-rail { min-width: 0; }
        @media (max-width: ${RESIDENT_DESKTOP_MIN_PX - 1}px) {
          .resident-mobile-top { display: block; }
          .resident-mobile-only { display: block; }
          .resident-home-desktop-grid { display: block !important; }
          .resident-home-rail { display: none !important; }
        }
      `), /* @__PURE__ */ React.createElement("header", { className: "resident-mobile-top sticky top-0 z-30 bg-white" }, /* @__PURE__ */ React.createElement("div", { className: "flex h-12 items-center gap-2 px-3" }, /* @__PURE__ */ React.createElement("p", { className: cn("min-w-0 flex-1 truncate font-bold tracking-tight text-neutral-900", FS.place) }, BARANGAY), /* @__PURE__ */ React.createElement(NotificationPopover, null), /* @__PURE__ */ React.createElement(ProfileAccountMenu, { placeLabel: BARANGAY })), /* @__PURE__ */ React.createElement("div", { className: "px-3 py-2" }, /* @__PURE__ */ React.createElement(
    RotatingSearchField,
    {
      value: search,
      onChange: setSearch,
      maxWidth: "100%",
      inputClassName: "h-10 bg-neutral-50"
    }
  ))), /* @__PURE__ */ React.createElement(ResidentContentGrid, { className: "resident-home-desktop-grid min-w-0 flex-1 pb-28 pt-3 md:pb-8" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0 w-full" }, /* @__PURE__ */ React.createElement("section", { className: "mb-2 w-full rounded-lg border-[1.5px] border-[#d0d0d0] bg-white px-3.5 py-3.5" }, /* @__PURE__ */ React.createElement("div", { className: "flex min-h-12 items-center gap-2.5" }, /* @__PURE__ */ React.createElement(UserAvatar, { user: sessionUserAsPublic, size: "md", className: "size-10 text-[17px]" }), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setCreateOpen(true),
      className: cn(
        "min-h-11 min-w-0 flex-1 rounded-md bg-neutral-100 px-4 py-2.5 text-left font-normal text-neutral-600 transition-colors hover:bg-neutral-200/70",
        "text-[15px]"
      )
    },
    "What's happening in your barangay?"
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setCreateOpen(true),
      className: "hidden size-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 sm:flex",
      "aria-label": "Add photo"
    },
    /* @__PURE__ */ React.createElement(ImageIcon2, { className: "size-5", strokeWidth: 1.75 })
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setCreateOpen(true),
      className: "h-10 shrink-0 rounded-[9999px] bg-[#ff6a1a] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#e85f12] active:scale-[0.98] sm:px-6"
    },
    "Report"
  ))), /* @__PURE__ */ React.createElement("div", { className: "mb-3 flex flex-wrap items-center gap-1.5" }, FEED_TABS.map((tab) => {
    const active = feedTab === tab.id;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        key: tab.id,
        type: "button",
        onClick: () => setFeedTab(tab.id),
        className: cn(
          "h-8 rounded-sm border-2 px-3.5 text-[13px] font-semibold transition-colors outline-none",
          "focus-visible:border-[#07145f] focus-visible:text-[#07145f]",
          active ? "border-[#07145f] bg-white text-[#07145f]" : "border-[#d0d0d0] bg-white text-neutral-600 hover:border-[#07145f] hover:bg-neutral-50 hover:text-[#07145f]"
        )
      },
      tab.label
    );
  })), getStartedOpen ? /* @__PURE__ */ React.createElement("section", { className: "mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "mb-1.5 flex items-center justify-between" }, /* @__PURE__ */ React.createElement("h2", { className: cn("font-bold text-neutral-900", FS.section) }, "Get started on E-Boses"), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: dismissGetStarted,
      className: "flex size-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100",
      "aria-label": "Dismiss"
    },
    /* @__PURE__ */ React.createElement(XIcon6, { className: IC.xs, strokeWidth: STROKE })
  )), /* @__PURE__ */ React.createElement("div", { className: "grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-3" }, /* @__PURE__ */ React.createElement(
    GetStartedCard,
    {
      icon: /* @__PURE__ */ React.createElement(PencilIcon, { className: IC.md, strokeWidth: STROKE }),
      title: "Report a concern",
      body: "Tell the barangay about issues near you.",
      cta: "Report",
      onClick: () => setCreateOpen(true)
    }
  ), /* @__PURE__ */ React.createElement(
    GetStartedCard,
    {
      icon: /* @__PURE__ */ React.createElement(FileTextIcon, { className: IC.md, strokeWidth: STROKE }),
      title: "Track your reports",
      body: "Follow status updates on what you submitted.",
      cta: "View reports",
      to: "/dashboard/reports"
    }
  ), /* @__PURE__ */ React.createElement(
    GetStartedCard,
    {
      icon: /* @__PURE__ */ React.createElement(AlertTriangleIcon3, { className: IC.md, strokeWidth: STROKE }),
      title: "Emergency SOS",
      body: "Get urgent help from barangay responders.",
      cta: "How it works",
      onClick: () => window.dispatchEvent(new Event("eboses:open-sos"))
    }
  ))) : null, events.length > 0 ? /* @__PURE__ */ React.createElement("section", { className: "resident-mobile-only mb-3 rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-[#07145f]" }, /* @__PURE__ */ React.createElement(CalendarDaysIcon, { className: "size-5", strokeWidth: STROKE }), /* @__PURE__ */ React.createElement("h2", { className: "text-[16px] font-bold" }, "Today in your barangay")), /* @__PURE__ */ React.createElement("div", { className: "mt-3 divide-y divide-neutral-200" }, events.map((event) => /* @__PURE__ */ React.createElement("div", { key: event.id, className: "py-3 first:pt-0 last:pb-0" }, /* @__PURE__ */ React.createElement("p", { className: "text-[15px] font-bold text-neutral-900" }, event.title), /* @__PURE__ */ React.createElement("p", { className: "mt-1 text-[14px] leading-5 text-neutral-600" }, event.detail), /* @__PURE__ */ React.createElement("p", { className: "mt-1 text-[13px] font-medium text-[#07145f]" }, new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(event.starts_at))))))) : null, error ? /* @__PURE__ */ React.createElement("p", { className: "mb-3 text-[15px] text-destructive" }, error) : null, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-2.5" }, announcements.map((announcement) => /* @__PURE__ */ React.createElement(
    "article",
    {
      key: `a-${announcement.id}`,
      className: "rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5"
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex gap-2.5" }, /* @__PURE__ */ React.createElement("span", { className: "flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fff1ea]" }, /* @__PURE__ */ React.createElement("img", { src: "/contents/announcements.png", alt: "", className: "size-5 object-contain" })), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("p", { className: cn("truncate font-bold text-neutral-900", FS.author) }, "Barangay Hall"), /* @__PURE__ */ React.createElement(
      "p",
      {
        className: cn(
          "flex flex-wrap items-center gap-1 text-neutral-500",
          FS.meta
        )
      },
      /* @__PURE__ */ React.createElement("span", null, BARANGAY),
      /* @__PURE__ */ React.createElement("span", null, "\xB7"),
      /* @__PURE__ */ React.createElement("span", null, announcement.date_label),
      /* @__PURE__ */ React.createElement(GlobeIcon2, { className: IC.xxs, strokeWidth: STROKE })
    )), /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cn(
          "shrink-0 rounded-md bg-[#fff1ea] px-1.5 py-0.5 font-bold uppercase text-[#ff6a1a]",
          FS.label
        )
      },
      announcement.tag || "Announcement"
    )), /* @__PURE__ */ React.createElement("h3", { className: cn("mt-2 font-bold leading-snug text-neutral-900", FS.body) }, announcement.title), /* @__PURE__ */ React.createElement("p", { className: cn("mt-1 leading-relaxed text-neutral-800", FS.body) }, announcement.body)))
  )), sortedConcerns.map((post) => {
    const isExpanded = expandedComments.has(post.id);
    const reporterStreet = streetLabelFromAddress(post.reporter.street);
    return /* @__PURE__ */ React.createElement(
      "article",
      {
        key: post.id,
        className: "overflow-hidden rounded-lg border-[1.5px] border-[#d0d0d0] bg-white"
      },
      /* @__PURE__ */ React.createElement("div", { className: "flex gap-2.5 p-3.5 pb-0" }, /* @__PURE__ */ React.createElement(UserAvatar, { user: post.reporter, size: "lg" }), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-start justify-between gap-2" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0" }, /* @__PURE__ */ React.createElement("p", { className: cn("truncate font-bold text-neutral-900", FS.author) }, post.reporter.full_name), /* @__PURE__ */ React.createElement(
        "p",
        {
          className: cn(
            "inline-flex max-w-full items-center gap-1 overflow-hidden text-neutral-500",
            FS.meta
          )
        },
        reporterStreet ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "min-w-0 truncate" }, reporterStreet), /* @__PURE__ */ React.createElement("span", { className: "shrink-0", "aria-hidden": true }, "\xB7")) : null,
        /* @__PURE__ */ React.createElement("span", { className: "shrink-0" }, categoryLabel(post.category)),
        /* @__PURE__ */ React.createElement("span", { className: "shrink-0", "aria-hidden": true }, "\xB7"),
        /* @__PURE__ */ React.createElement("span", { className: "shrink-0" }, timeAgo2(post.created_at)),
        /* @__PURE__ */ React.createElement(GlobeIcon2, { className: cn(IC.xxs, "shrink-0"), strokeWidth: STROKE })
      )), /* @__PURE__ */ React.createElement(
        Popover,
        {
          open: reportOpen === post.id,
          onOpenChange: (open) => {
            if (!open) {
              setReportOpen(null);
              setReportReason("");
              setReportOther("");
            } else setReportOpen(post.id);
          }
        },
        /* @__PURE__ */ React.createElement(
          PopoverTrigger,
          {
            className: "flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700",
            "aria-label": "More"
          },
          /* @__PURE__ */ React.createElement("span", { className: "text-[16px] leading-none" }, "\u22EF")
        ),
        /* @__PURE__ */ React.createElement(PopoverContent, { className: "w-72 p-0" }, /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-3 p-4" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(FlagIcon, { className: IC.xs, strokeWidth: STROKE }), /* @__PURE__ */ React.createElement("h4", { className: "text-[16px] font-semibold" }, "Report this post")), /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-1.5" }, reportReasons.map((reason) => /* @__PURE__ */ React.createElement(
          "label",
          {
            key: reason,
            className: "flex cursor-pointer items-center gap-2 text-[14px]"
          },
          /* @__PURE__ */ React.createElement(
            "input",
            {
              type: "radio",
              name: `report-home-${post.id}`,
              checked: reportReason === reason,
              onChange: () => setReportReason(reason)
            }
          ),
          reason
        ))), reportReason === "Others (please specify)" ? /* @__PURE__ */ React.createElement(
          Input,
          {
            value: reportOther,
            onChange: (e) => setReportOther(e.target.value),
            placeholder: "Please specify\u2026",
            className: "h-9 text-[14px]"
          }
        ) : null, /* @__PURE__ */ React.createElement(
          Button,
          {
            type: "button",
            variant: "destructive",
            size: "sm",
            className: "w-full text-[14px]",
            disabled: flaggingPost === post.id,
            onClick: () => void submitFlag(post.id)
          },
          flaggingPost === post.id ? "Submitting\u2026" : "Submit report"
        )))
      )), /* @__PURE__ */ React.createElement("p", { className: cn("mt-2 leading-relaxed text-neutral-900", FS.body) }, post.title, post.description ? /* @__PURE__ */ React.createElement(React.Fragment, null, " ", post.description) : null))),
      post.media.length > 0 && post.media[0].mime_type?.startsWith("image/") ? /* @__PURE__ */ React.createElement("div", { className: "mt-2.5 border-t border-neutral-200" }, /* @__PURE__ */ React.createElement(
        "img",
        {
          src: post.media[0].preview_url,
          alt: "",
          className: "max-h-80 w-full object-cover"
        }
      )) : null,
      /* @__PURE__ */ React.createElement("div", { className: "space-y-2.5 p-3.5 pt-3" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-1.5" }, /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          onClick: () => void handleVote(post),
          "aria-label": post.user_vote === 1 ? "Remove upvote" : "Upvote",
          "aria-pressed": post.user_vote === 1,
          className: cn(
            "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full px-2 text-neutral-500 transition-colors",
            "hover:text-neutral-800",
            "active:text-neutral-800",
            post.user_vote === 1 && "text-neutral-800"
          )
        },
        /* @__PURE__ */ React.createElement(
          ArrowBigUpIcon,
          {
            className: "size-5 shrink-0 fill-none",
            strokeWidth: STROKE
          }
        ),
        post.vote_count > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pr-0.5 text-[13px] font-semibold tabular-nums" }, post.vote_count) : null
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            setExpandedComments((prev) => {
              const next = new Set(prev);
              if (next.has(post.id)) next.delete(post.id);
              else next.add(post.id);
              return next;
            });
            window.requestAnimationFrame(() => {
              if (!isExpanded) {
                document.getElementById(`home-comment-${post.id}`)?.focus();
              }
            });
          },
          "aria-label": isExpanded ? "Hide comments" : "Show comments",
          "aria-expanded": isExpanded,
          className: cn(
            "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full px-2 text-neutral-500 transition-colors",
            "hover:text-neutral-800",
            "active:text-neutral-800",
            isExpanded && "text-neutral-800"
          )
        },
        /* @__PURE__ */ React.createElement(
          MessageCircleIcon,
          {
            className: "size-5 shrink-0 fill-none",
            strokeWidth: STROKE
          }
        ),
        post.comment_count > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pr-0.5 text-[13px] font-semibold tabular-nums" }, post.comment_count) : null
      )), isExpanded ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2.5" }, post.comments.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2 pt-0.5" }, post.comments.map((c) => /* @__PURE__ */ React.createElement("div", { key: c.id, className: "flex gap-2" }, /* @__PURE__ */ React.createElement(UserAvatar, { user: c.author, size: "sm", className: "size-8 text-[14px]" }), /* @__PURE__ */ React.createElement("div", { className: "min-w-0 flex-1 rounded-2xl bg-neutral-100 px-3 py-1.5" }, /* @__PURE__ */ React.createElement("p", { className: "text-[14px] font-bold text-neutral-900" }, c.author.full_name, " ", /* @__PURE__ */ React.createElement("span", { className: "font-medium text-neutral-400" }, timeAgo2(c.created_at))), /* @__PURE__ */ React.createElement("p", { className: "text-[15px] text-neutral-700" }, c.body))))) : null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
        UserAvatar,
        {
          user: sessionUserAsPublic,
          size: "sm",
          className: "size-8 text-[14px]"
        }
      ), /* @__PURE__ */ React.createElement("div", { className: "relative min-w-0 flex-1" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          id: `home-comment-${post.id}`,
          type: "text",
          value: commentInputs[post.id] ?? "",
          onChange: (e) => setCommentInputs((prev) => ({
            ...prev,
            [post.id]: e.target.value
          })),
          onKeyDown: (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submitComment(post.id);
            }
          },
          placeholder: "Add a comment...",
          className: cn(
            "h-10 w-full rounded-full border border-neutral-200 bg-white py-2 pl-4 pr-11 text-[15px] text-neutral-900 outline-none",
            "placeholder:text-neutral-400",
            "focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100"
          )
        }
      ), /* @__PURE__ */ React.createElement(
        "button",
        {
          type: "button",
          disabled: !(commentInputs[post.id] ?? "").trim(),
          onClick: () => void submitComment(post.id),
          "aria-label": "Send comment",
          className: cn(
            "absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
            (commentInputs[post.id] ?? "").trim() ? "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900" : "cursor-not-allowed text-neutral-300"
          )
        },
        /* @__PURE__ */ React.createElement(
          "span",
          {
            className: "inline-block size-5 bg-current",
            style: {
              WebkitMaskImage: "url(/contents/send-message.png)",
              maskImage: "url(/contents/send-message.png)",
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              maskPosition: "center"
            },
            "aria-hidden": true
          }
        )
      )))) : null)
    );
  }), announcements.length === 0 && sortedConcerns.length === 0 && !error ? /* @__PURE__ */ React.createElement("div", { className: "flex flex-col items-center rounded-lg border-[1.5px] border-solid border-[#d0d0d0] bg-white px-6 py-10 text-center" }, /* @__PURE__ */ React.createElement(
    "img",
    {
      src: "/contents/feed-header.png",
      alt: "",
      className: "mb-4 h-44 w-auto max-w-[90%] object-contain opacity-95 sm:h-52"
    }
  ), /* @__PURE__ */ React.createElement("p", { className: "text-[15px] font-semibold text-neutral-700" }, "Nothing in the feed yet."), /* @__PURE__ */ React.createElement("p", { className: "mt-1 text-[14px] text-neutral-500" }, "Be the first to post in ", BARANGAY, ".")) : null)), /* @__PURE__ */ React.createElement("aside", { className: "resident-home-rail flex w-full min-w-0 flex-col gap-2.5" }, /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-lg border-[1.5px] border-[#d0d0d0] bg-white" }, /* @__PURE__ */ React.createElement("div", { className: "min-w-0 px-3.5 py-3" }, /* @__PURE__ */ React.createElement("p", { className: cn("truncate font-semibold text-neutral-900", FS.railTitle) }, BARANGAY), streetLabel ? /* @__PURE__ */ React.createElement("p", { className: cn("truncate font-normal text-neutral-500", FS.meta) }, streetLabel) : null), /* @__PURE__ */ React.createElement(
    Link3,
    {
      to: "/dashboard/reports",
      className: cn(
        "flex items-center justify-between border-t border-[#ececec] px-3.5 py-2.5 font-semibold text-neutral-500 no-underline transition-colors hover:bg-neutral-50 hover:text-neutral-700",
        FS.railLink
      )
    },
    /* @__PURE__ */ React.createElement("span", null, "See all alerts"),
    /* @__PURE__ */ React.createElement(ChevronRightIcon2, { className: cn(RAIL_CHEVRON, "text-neutral-500"), strokeWidth: 2 })
  )), events.length > 0 ? /* @__PURE__ */ React.createElement("section", { className: "overflow-hidden rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 text-[#07145f]" }, /* @__PURE__ */ React.createElement(CalendarDaysIcon, { className: "size-5", strokeWidth: STROKE }), /* @__PURE__ */ React.createElement("h2", { className: cn("font-bold", FS.railTitle) }, "Today")), /* @__PURE__ */ React.createElement("div", { className: "mt-2 divide-y divide-neutral-200" }, events.slice(0, 3).map((event) => /* @__PURE__ */ React.createElement("div", { key: event.id, className: "py-2.5 first:pt-1 last:pb-0" }, /* @__PURE__ */ React.createElement("p", { className: cn("font-bold text-neutral-900", FS.railBody) }, event.title), /* @__PURE__ */ React.createElement("p", { className: cn("mt-0.5 text-neutral-500", FS.meta) }, new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(event.starts_at))))))) : null, /* @__PURE__ */ React.createElement("div", { className: "overflow-hidden rounded-lg border-[1.5px] border-[#d0d0d0] bg-white" }, /* @__PURE__ */ React.createElement("div", { className: "p-3" }, /* @__PURE__ */ React.createElement("div", { className: "aspect-[16/10] w-full overflow-hidden rounded-lg bg-[#e8f0fa]" }, /* @__PURE__ */ React.createElement(
    "img",
    {
      src: "/contents/marikina-area-2.png",
      alt: "Marikina City landmark",
      className: "h-full w-full object-cover"
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "px-3.5 pb-3" }, /* @__PURE__ */ React.createElement("p", { className: cn("font-bold text-neutral-900", FS.railTitle) }, "Report a local concern"), /* @__PURE__ */ React.createElement("p", { className: cn("mt-1 leading-relaxed text-neutral-600", FS.railBody) }, "Share issues with neighbors and barangay officials so they can take action.")), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => setCreateOpen(true),
      className: cn(
        "flex w-full items-center justify-between border-t border-[#ececec] px-3.5 py-2.5 text-left font-semibold text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700",
        FS.railLink
      )
    },
    /* @__PURE__ */ React.createElement("span", null, "Report"),
    /* @__PURE__ */ React.createElement(ChevronRightIcon2, { className: cn(RAIL_CHEVRON, "text-neutral-500"), strokeWidth: 2 })
  )), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: () => window.dispatchEvent(new Event("eboses:open-sos")),
      className: "flex w-full items-center justify-between rounded-lg border-[1.5px] border-red-400 bg-red-50/80 px-3.5 py-3 text-left transition-colors hover:border-red-500 hover:bg-red-50"
    },
    /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2.5" }, /* @__PURE__ */ React.createElement("span", { className: "flex size-8 items-center justify-center rounded-full bg-red-600 text-white" }, /* @__PURE__ */ React.createElement(AlertTriangleIcon3, { className: IC.xs, strokeWidth: STROKE })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: cn("font-bold text-red-900", FS.railTitle) }, "Emergency SOS"), /* @__PURE__ */ React.createElement("p", { className: cn("text-red-700/80", FS.meta) }, "Get help from responders"))),
    /* @__PURE__ */ React.createElement(ChevronRightIcon2, { className: cn(RAIL_CHEVRON, "text-red-400"), strokeWidth: 2 })
  ))), /* @__PURE__ */ React.createElement(CreateReportDialog, { open: createOpen, onOpenChange: setCreateOpen }));
}
function GetStartedCard({
  icon,
  title,
  body,
  cta,
  to,
  onClick
}) {
  const inner = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "flex size-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-700" }, icon), /* @__PURE__ */ React.createElement("p", { className: "mt-2.5 text-[15px] font-bold leading-snug text-neutral-900" }, title), /* @__PURE__ */ React.createElement("p", { className: "mt-1 flex-1 text-[14px] leading-relaxed text-neutral-500" }, body), /* @__PURE__ */ React.createElement("span", { className: "mt-3 inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-4 text-[14px] font-bold text-white" }, cta));
  const className = "flex min-w-0 flex-col rounded-lg border-[1.5px] border-[#d0d0d0] bg-white p-3.5 no-underline transition-colors hover:bg-neutral-50/80";
  if (to) {
    return /* @__PURE__ */ React.createElement(Link3, { to, className }, inner);
  }
  return /* @__PURE__ */ React.createElement("button", { type: "button", onClick, className: cn(className, "text-left") }, inner);
}
export {
  HomePage as default
};
