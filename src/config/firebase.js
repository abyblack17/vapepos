import { initializeApp }  from 'firebase/app'
import { getAuth }        from 'firebase/auth'
import { getFirestore }   from 'firebase/firestore'
import { getFunctions }   from 'firebase/functions'
import { getStorage }     from 'firebase/storage'

const firebaseConfig = {
  apiKey:            "AIzaSyDvmt20bLH1UkMgXMrzGWHerai-kMKtQe4",
  authDomain:        "vape-pos-7819a.firebaseapp.com",
  projectId:         "vape-pos-7819a",
  storageBucket:     "vape-pos-7819a.firebasestorage.app",
  messagingSenderId: "220735440943",
  appId:             "1:220735440943:web:1e612755e4c9be31055eda",
}

const app = initializeApp(firebaseConfig)

export const auth      = getAuth(app)
export const db        = getFirestore(app)
export const functions = getFunctions(app, 'us-central1')
export const storage   = getStorage(app)

export default app
