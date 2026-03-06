/**
 * One-off script to delete users by email from Firebase Auth and Firestore.
 *
 * Run from functions folder:
 *   node scripts/delete-users-by-email.js
 *
 * Requires credentials. Either:
 *   1. Set GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccountKey.json
 *      (Download from Firebase Console → Project Settings → Service Accounts → Generate new private key)
 *   2. Or run: gcloud auth application-default login
 *      (if you use Google Cloud SDK)
 */
const admin = require("firebase-admin");
const path = require("path");

// Try to load service account from common locations if no env var set
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const keyPath = path.join(__dirname, "..", "serviceAccountKey.json");
  try {
    require("fs").accessSync(keyPath);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
  } catch {}
}

const EMAILS_TO_DELETE = [
  "belen_luna_1801@hotmail.com",
  "mariabelenluna18@gmail.com",
];

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "rolling-crowdsourcing" });
  }
  const auth = admin.auth();
  const db = admin.firestore();

  for (const email of EMAILS_TO_DELETE) {
    try {
      const user = await auth.getUserByEmail(email);
      const uid = user.uid;
      console.log(`Found user: ${email} (uid: ${uid})`);

      // Delete from Firebase Auth
      await auth.deleteUser(uid);
      console.log(`  ✓ Deleted from Firebase Auth`);

      // Delete from Firestore users collection
      const userRef = db.collection("users").doc(uid);
      const snap = await userRef.get();
      if (snap.exists) {
        await userRef.delete();
        console.log(`  ✓ Deleted from Firestore users`);
      } else {
        console.log(`  (No Firestore user doc found)`);
      }

      console.log(`  Done: ${email}\n`);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        console.log(`User not found in Auth: ${email}`);
        // Still try to delete from Firestore by querying users by email
        const usersSnap = await db.collection("users").where("email", "==", email).get();
        for (const doc of usersSnap.docs) {
          await doc.ref.delete();
          console.log(`  ✓ Deleted Firestore user doc (uid: ${doc.id})`);
        }
      } else {
        console.error(`Error deleting ${email}:`, err.message);
      }
      console.log("");
    }
  }

  console.log("Finished.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
