// src/firebase.js
const admin = require('firebase-admin');

let firebaseApp;

function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : null;

    if (serviceAccount) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('✅ Firebase Admin initialized');
    } else {
      // Dev mode — skip Firebase verification
      console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT not set — token verification disabled');
      firebaseApp = {
        auth: () => ({
          verifyIdToken: async (token) => {
            // In dev, accept any token and extract uid from it
            if (token.startsWith('demo_') || token.startsWith('local_')) {
              return { uid: token, phone_number: null, email: null };
            }
            throw new Error('Firebase not configured');
          },
        }),
      };
    }
  } catch (e) {
    console.error('Firebase init error:', e.message);
  }

  return firebaseApp;
}

module.exports = getFirebaseAdmin();
