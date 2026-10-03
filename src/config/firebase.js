import { initializeApp }  from 'firebase/app'
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getFunctions }   from 'firebase/functions'
import { getStorage }     from 'firebase/storage'
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

for (const [key, value] of Object.entries(firebaseConfig)) {
  if (!value) throw new Error(`Falta la variable Firebase: ${key}`)
}

const app = initializeApp(firebaseConfig)

// App Check protege Firestore, Storage y Functions contra clientes no autorizados.
// En desarrollo se puede definir VITE_APPCHECK_DEBUG=true y registrar el token
// que aparece en la consola del navegador dentro de Firebase App Check.
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY
if (typeof window !== 'undefined' && appCheckSiteKey) {
  if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG === 'true') {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  const provider = import.meta.env.VITE_FIREBASE_APPCHECK_PROVIDER === 'v3'
    ? new ReCaptchaV3Provider(appCheckSiteKey)
    : new ReCaptchaEnterpriseProvider(appCheckSiteKey)
  initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true })
} else if (import.meta.env.PROD) {
  console.error('App Check no se inicializó: falta VITE_FIREBASE_APPCHECK_SITE_KEY')
}

export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
export const functions = getFunctions(app, 'us-central1')
export const storage   = getStorage(app)

export default app
