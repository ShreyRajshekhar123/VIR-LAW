// src/firebase.js

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBV_m0OgaHZddeGx2nk6-siSkjAG47BisI",
  authDomain: "virlaw.firebaseapp.com",
  projectId: "virlaw",
  storageBucket: "virlaw.appspot.com", // <-- FIXED small typo here (remove extra `.firestorage.app`)
  messagingSenderId: "1086709688426",
  appId: "1:1086709688426:web:4bd082228309d50f5c0213",
  measurementId: "G-KHB10WF5XR",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
const auth = getAuth(app);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("profile");
googleProvider.addScope("email");

// Export everything
export { auth, googleProvider, analytics, db, storage };
