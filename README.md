# ⚡ VapePOS — Sistema POS Multi-Tenant para Tiendas de Vape

---

## Inicio rápido (modo demo — sin Firebase)

```bash
npm install
npm run dev
# → http://localhost:5173
```

La app corre con datos de ejemplo sin configurar Firebase.

---

## Activar multi-tenant real (Firebase)

### Paso 1 — Crear proyecto Firebase
1. Ve a [console.firebase.google.com](https://console.firebase.google.com)
2. Crea un proyecto nuevo
3. Activa **Authentication > Email/Password**
4. Activa **Firestore Database** en modo producción
5. Activa **Cloud Functions** (requiere plan Blaze)

### Paso 2 — Configurar variables de entorno
```bash
cp .env.example .env
# Edita .env con tus credenciales de Firebase
```

### Paso 3 — Desplegar reglas y Cloud Functions
```bash
# Instalar Firebase CLI
npm install -g firebase-tools
firebase login

# Desde la raíz del proyecto
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes

# Instalar dependencias de Functions
cd functions && npm install && cd ..

# Desplegar Cloud Functions
firebase deploy --only functions
```

### Paso 4 — Primera tienda
1. Abre la app en el navegador
2. Haz clic en "Registrar mi tienda"
3. Completa el formulario (llama a `registerBusiness` Cloud Function)
4. Inicia sesión con las credenciales que registraste

---

## Arquitectura multi-tenant

```
/users/{uid}                           ← perfil global (businessId + role)
/businesses/{businessId}/              ← todos los datos del negocio
  settings/config                      ← configuración independiente
  products/{id}
  liquids/{id}
  sales/{id}
  customers/{id}
  suppliers/{id}
  cash_sessions/{id}
  users/{uid}                          ← copia interna para gestión
  audit_logs/{id}                      ← registro de acciones sensibles
  refill_history/{id}
  inventory_movements/{id}
```

### Aislamiento garantizado por
- **Firestore Rules**: `/businesses/{businessId}` solo accesible si `myProfile().businessId == businessId`
- **Cloud Functions**: creación de negocios y usuarios solo desde servidor
- **Validación de esquema**: campos obligatorios y tipos verificados en Rules
- **Bloqueo catch-all**: `match /{document=**} { allow read, write: if false }`

---

## Cloud Functions disponibles

| Función | Quién la llama | Qué hace |
|---|---|---|
| `registerBusiness` | Pantalla de registro | Crea negocio + admin en batch atómico |
| `addEmployeeToStore` | Admin en página Usuarios | Crea empleado con rol Cajero/Encargado |
| `updateUserRole` | Admin en página Usuarios | Cambia rol de un empleado |
| `deactivateUser` | Admin en página Usuarios | Desactiva cuenta + bloquea Auth |
| `auditOnSaleDelete` | Trigger automático | Log inmutable al eliminar venta |

---

## Permisos por rol

| Acción | Cajero | Encargado | Admin |
|---|---|---|---|
| Vender productos y recargas | ✅ | ✅ | ✅ |
| Ver inventario | ❌ | ✅ | ✅ |
| Agregar/editar productos | ❌ | ✅ | ✅ |
| Eliminar productos | ❌ | ❌ | ✅ |
| Abrir botella activa (≤10%) | ❌ | ✅ | ✅ |
| Editar precio/costo líquidos | ❌ | ✅ | ✅ |
| Abrir/cerrar su propia caja | ✅ | ✅ | ✅ |
| Cerrar caja de otro | ❌ | ✅ | ✅ |
| Ver reportes | ❌ | ✅ | ✅ |
| Eliminar ventas | ❌ | ❌ | ✅ |
| Gestionar usuarios | ❌ | ❌ | ✅ |
| Ver audit logs | ❌ | ❌ | ✅ |
| Cambiar configuración | ❌ | ❌ | ✅ |

---

## Plan de migración de audit_logs a Cloud Functions

**Fase actual (v1):** el cliente escribe logs validados por Firestore Rules.
- `userId` debe coincidir con `request.auth.uid`
- `role` debe coincidir con `myRole()` del perfil
- campos obligatorios verificados

**Fase 2 (cuando escales):** reemplazar con triggers:
```typescript
// Ejemplo: log automático al eliminar un producto
export const auditOnProductDelete = functions.firestore
  .document('businesses/{biz}/products/{id}')
  .onDelete(async (snap, ctx) => {
    // Este log viene del servidor — no manipulable
  })
```

Los logs existentes de v1 son compatibles con v2. No hay migración de datos necesaria.

---

## Estructura de archivos

```
src/
├── contexts/
│   ├── AuthContext.jsx      ← Auth + businessId + Cloud Functions
│   └── AppContext.jsx       ← Estado app + carga Firestore por businessId
├── services/
│   ├── firestoreService.js  ← Capa base tenant-aware (bizCol, bizDoc, etc.)
│   ├── auditService.js      ← Escritura de audit logs desde cliente
│   ├── salesService.js      ← Ventas con businessId
│   ├── inventoryService.js  ← Inventario con businessId
│   ├── liquidService.js     ← Líquidos con businessId
│   └── cashService.js       ← Caja con businessId
├── pages/auth/
│   ├── Login.jsx
│   └── Register.jsx         ← Llama a registerBusiness Cloud Function
functions/
├── src/index.ts             ← Todas las Cloud Functions
├── package.json
└── tsconfig.json
firestore.rules              ← Reglas de seguridad finales
firestore.indexes.json       ← Índices compuestos requeridos
firebase.json                ← Configuración de despliegue
```
