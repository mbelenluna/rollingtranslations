/**
 * Portal auth — Firebase Auth (email/password) + session
 * Shared by portal and admin pages.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRrDn3p9alXlLjZN7SoBkJSodcSk2uZs8",
  authDomain: "rolling-crowdsourcing.firebaseapp.com",
  projectId: "rolling-crowdsourcing",
  storageBucket: "rolling-crowdsourcing.firebasestorage.app",
  messagingSenderId: "831997390366",
  appId: "1:831997390366:web:a86f5223fa22cc250b480f",
  measurementId: "G-77E7560XRX",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

(async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {}
})();

const CF_BASE = "https://us-central1-rolling-crowdsourcing.cloudfunctions.net";

export async function checkServerReachable() {
  try {
    const r = await fetch(`${CF_BASE}/healthCheck`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(true);
}

export async function register(emailOrOpts, password) {
  const opts = typeof emailOrOpts === "object"
    ? emailOrOpts
    : { email: emailOrOpts, password };
  const { email, fullName, company } = opts;
  const pw = opts.password || password;
  const cred = await createUserWithEmailAndPassword(auth, email, pw);
  if (fullName) {
    try {
      await updateProfile(cred.user, { displayName: fullName });
    } catch (e) {
      console.warn("updateProfile failed:", e?.message || e);
    }
  }
  try {
    await ensureUserProfile(cred.user, { fullName, company });
  } catch (e) {
    console.warn("ensureUserProfile failed:", e?.message || e);
  }
  return cred.user;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  try {
    await ensureUserProfile(cred.user);
  } catch (e) {
    console.warn("ensureUserProfile failed:", e?.message || e);
  }
  return cred.user;
}

export function logout() {
  return signOut(auth);
}

export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUser() {
  return auth.currentUser;
}

/** Call backend to ensure users/{uid} doc exists (notificationsEnabled, role, fullName, company) */
async function ensureUserProfile(user, extra = {}) {
  const token = await user.getIdToken();
  const r = await fetch(`${CF_BASE}/ensureUserProfile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: user.email,
      fullName: extra.fullName || user.displayName,
      company: extra.company,
    }),
  });
  if (!r.ok) {
    const text = await r.text();
    let msg = text || "Failed to ensure user profile";
    try {
      const j = JSON.parse(text);
      if (j.message) msg = j.message;
      else if (j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function apiCall(path, options = {}) {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  const res = await fetch(`${CF_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text || `Request failed: ${res.status}`;
    try {
      const j = JSON.parse(text);
      if (j.message) msg = j.message;
      else if (j.error) msg = j.error;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    err.errorCode = (() => {
      try {
        const j = JSON.parse(text);
        return j.error;
      } catch {
        return null;
      }
    })();
    throw err;
  }
  const ct = res.headers.get("content-type");
  if (ct && ct.includes("application/json")) return res.json();
  return res.text();
}

/** Send verification email (after registration). Requires auth. */
export async function sendVerificationEmail() {
  return apiCall("/sendVerificationEmail", { method: "POST" });
}

/** Verify email with token (no auth). Used when user clicks link. */
export async function verifyEmailToken(token) {
  const res = await fetch(`${CF_BASE}/verifyEmail?token=${encodeURIComponent(token)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `Verification failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/** Resend verification email. Requires auth. */
export async function resendVerificationEmail() {
  return apiCall("/resendVerificationEmail", { method: "POST" });
}
