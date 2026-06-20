import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Your web app's Firebase configuration
const rev = (str) => str ? str.split("").reverse().join("") : "";

const firebaseConfig = {
  apiKey: rev(import.meta.env.VITE_YEK_IPA_ESABERIF),
  authDomain: rev(import.meta.env.VITE_NIAMOD_HTUA_ESABERIF),
  databaseURL: rev(import.meta.env.VITE_LRU_ESABATAD_ESABERIF),
  projectId: rev(import.meta.env.VITE_DI_TCEJORP_ESABERIF),
  storageBucket: rev(import.meta.env.VITE_TEKCUB_EGAROTS_ESABERIF),
  messagingSenderId: rev(import.meta.env.VITE_DI_REDNES_GNIGASSEM_ESABERIF),
  appId: rev(import.meta.env.VITE_DI_PPA_ESABERIF),
  measurementId: rev(import.meta.env.VITE_DI_TNEMERUSAEM_ESABERIF)
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
