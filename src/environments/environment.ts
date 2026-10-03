// ── Backend URL config ────────────────────────────────────────────────────────
// Set BACKEND_URL to your backend server address.
//
//   Dev (ng serve, same machine):   ''                        ← proxy handles it
//   LAN (other devices):            'http://192.168.1.3:3000'
// ─────────────────────────────────────────────────────────────────────────────
export const environment = {
  BACKEND_URL: 'http://localhost:3000',  // ← ONLY change this one value
};
