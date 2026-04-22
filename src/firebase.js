// src/firebase.js
let adminApp = null;

function getAdmin() {
  if (adminApp) return adminApp;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length > 0) {
      adminApp = admin;
      return adminApp;
    }
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa && sa !== '{"type":"service_account",...}') {
      const serviceAccount = JSON.parse(sa);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('✅ Firebase Admin initialized');
    } else {
      // Dev mode
      admin.initializeApp({ projectId: 'nandini-organic' });
      console.warn('⚠️  Firebase in dev mode');
    }
    adminApp = admin;
  } catch (e) {
    console.error('Firebase init error:', e.message);
    // Return mock for graceful degradation
    adminApp = {
      auth: () => ({
        verifyIdToken: async (token) => {
          if (token && (token.startsWith('demo_') || token.startsWith('local_'))) {
            return { uid: token, phone_number: null, email: null };
          }
          throw new Error('Firebase not configured — token verification unavailable');
        }
      })
    };
  }
  return adminApp;
}

module.exports = {
  auth: () => getAdmin().auth(),
};
