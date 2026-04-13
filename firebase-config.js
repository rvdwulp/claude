// ===== FIREBASE CONFIGURATIE =====
// Stap 1: Ga naar https://console.firebase.google.com
// Stap 2: Maak een nieuw project aan (bijv. "todo-planner")
// Stap 3: Klik "Web app toevoegen" en kopieer de config hieronder
// Stap 4: Ga naar Firestore Database → Maak database aan → Start in testmodus
//
// Vervang de waarden hieronder met jouw Firebase project config:

const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Initialiseer Firebase alleen als config ingevuld is
if (FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId) {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    console.log('Firebase verbonden');
  } catch(e) {
    console.log('Firebase init fout:', e.message);
  }
} else {
  console.log('Firebase niet geconfigureerd — lokale opslag actief');
}
