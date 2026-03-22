"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateTrial = exports.reactivatePlan = exports.degradeExpiredPlans = exports.onBusinessPlanChange = exports.deleteUser = exports.auditOnSaleDelete = exports.deactivateUser = exports.updateUserRole = exports.addEmployeeToStore = exports.registerBusiness = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
// ── Validadores ───────────────────────────────────────────────
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePassword(pwd) {
    return typeof pwd === 'string' && pwd.length >= 6;
}
const BASIC_LIMITS = {
    products: 25,
    customers: 30,
    users: 1, // sin contar al admin
};
// ── Helper: degradar usuarios de un negocio ───────────────────
// Desactiva los empleados que exceden el límite del plan básico.
// Mantiene activo solo al primero (por fecha de creación) + el admin.
async function enforceUserLimit(bizId) {
    // Traer todos los usuarios sin filtros compuestos para evitar índices
    const usersSnap = await db.collection(`businesses/${bizId}/users`).get();
    // Filtrar y ordenar en código
    const nonAdminUsers = usersSnap.docs
        .filter(d => d.data().role !== 'Administrador' && !d.data().planLocked)
        .sort((a, b) => {
        var _a, _b, _c, _d;
        const aDate = ((_b = (_a = a.data().createdAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) || new Date(0);
        const bDate = ((_d = (_c = b.data().createdAt) === null || _c === void 0 ? void 0 : _c.toDate) === null || _d === void 0 ? void 0 : _d.call(_c)) || new Date(0);
        return aDate.getTime() - bDate.getTime();
    });
    if (nonAdminUsers.length <= BASIC_LIMITS.users)
        return;
    const toBlock = nonAdminUsers.slice(BASIC_LIMITS.users);
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();
    for (const doc of toBlock) {
        const uid = doc.data().uid || doc.id;
        try {
            await auth.updateUser(uid, { disabled: true });
        }
        catch (_a) { }
        batch.update(doc.ref, { planLocked: true, active: false, updatedAt: now });
        batch.update(db.doc(`users/${uid}`), { planLocked: true, active: false, updatedAt: now });
    }
    await batch.commit();
    console.log(`[enforceUserLimit] ${bizId}: bloqueados ${toBlock.length} usuarios`);
}
// ══════════════════════════════════════════════════════════════
// 1. registerBusiness
// ══════════════════════════════════════════════════════════════
exports.registerBusiness = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c, _d;
    const data = request.data;
    if (!data.email || !validateEmail(data.email)) {
        throw new https_1.HttpsError('invalid-argument', 'Correo electrónico inválido.');
    }
    if (!validatePassword(data.password)) {
        throw new https_1.HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');
    }
    if (!data.ownerName || data.ownerName.trim().length < 2) {
        throw new https_1.HttpsError('invalid-argument', 'El nombre del propietario es requerido.');
    }
    if (!data.businessName || data.businessName.trim().length < 2) {
        throw new https_1.HttpsError('invalid-argument', 'El nombre del negocio es requerido.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    try {
        const authUser = await auth.createUser({
            email: data.email.trim().toLowerCase(),
            password: data.password,
            displayName: data.ownerName.trim(),
        });
        const uid = authUser.uid;
        const bizRef = db.collection('businesses').doc();
        const businessId = bizRef.id;
        const defaultSettings = {
            businessName: data.businessName.trim(),
            phone: ((_a = data.phone) === null || _a === void 0 ? void 0 : _a.trim()) || '',
            address: ((_b = data.address) === null || _b === void 0 ? void 0 : _b.trim()) || '',
            currency: data.currency || 'RD$',
            taxRate: 18,
            defaultPointsR50: 10,
            defaultPointsR100: 20,
            defaultPointsR150: 30,
            defaultBottleCapacity: 100,
            lowStockThreshold: 5,
            lowBottleAlert: 10,
            invoiceHeader: `VapePOS — ${data.businessName.trim()}`,
            invoiceFooter: '¡Gracias por su compra! Vuelva pronto.',
            updatedAt: now,
        };
        const batch = db.batch();
        batch.set(bizRef, {
            name: data.businessName.trim(),
            phone: ((_c = data.phone) === null || _c === void 0 ? void 0 : _c.trim()) || '',
            address: ((_d = data.address) === null || _d === void 0 ? void 0 : _d.trim()) || '',
            ownerId: uid,
            plan: 'basic',
            active: true,
            createdAt: now,
            updatedAt: now,
        });
        batch.set(db.doc(`businesses/${businessId}/settings/config`), defaultSettings);
        batch.set(db.doc(`users/${uid}`), {
            businessId,
            role: 'Administrador',
            active: true,
            email: data.email.trim().toLowerCase(),
            displayName: data.ownerName.trim(),
            createdAt: now,
            updatedAt: now,
        });
        batch.set(db.doc(`businesses/${businessId}/users/${uid}`), {
            uid,
            businessId,
            role: 'Administrador',
            active: true,
            email: data.email.trim().toLowerCase(),
            displayName: data.ownerName.trim(),
            createdAt: now,
            updatedAt: now,
        });
        await batch.commit();
        await db.collection(`businesses/${businessId}/audit_logs`).add({
            action: 'REGISTER_BUSINESS',
            module: 'system',
            userId: uid,
            userName: data.ownerName.trim(),
            role: 'Administrador',
            targetId: businessId,
            targetName: data.businessName.trim(),
            before: null,
            after: { businessName: data.businessName.trim(), plan: 'basic' },
            businessId,
            createdAt: now,
        });
        return { success: true, businessId, uid };
    }
    catch (err) {
        if (err.code === 'auth/email-already-exists') {
            throw new https_1.HttpsError('already-exists', 'Ya existe una cuenta con ese correo.');
        }
        throw new https_1.HttpsError('internal', `Error al crear el negocio: ${err.message}`);
    }
});
// ══════════════════════════════════════════════════════════════
// 2. addEmployeeToStore
// ══════════════════════════════════════════════════════════════
exports.addEmployeeToStore = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const data = request.data;
    const callerUid = request.auth.uid;
    const callerProfile = await db.doc(`users/${callerUid}`).get();
    if (!callerProfile.exists || ((_a = callerProfile.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'Administrador') {
        throw new https_1.HttpsError('permission-denied', 'Solo el administrador puede agregar empleados.');
    }
    const businessId = (_b = callerProfile.data()) === null || _b === void 0 ? void 0 : _b.businessId;
    if (!businessId) {
        throw new https_1.HttpsError('failed-precondition', 'Negocio no encontrado.');
    }
    if (!['Cajero', 'Encargado'].includes(data.role)) {
        throw new https_1.HttpsError('invalid-argument', 'Rol inválido.');
    }
    if (!validateEmail(data.email)) {
        throw new https_1.HttpsError('invalid-argument', 'Correo inválido.');
    }
    if (!validatePassword(data.password)) {
        throw new https_1.HttpsError('invalid-argument', 'Contraseña muy corta.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    try {
        const newUser = await auth.createUser({
            email: data.email.trim().toLowerCase(),
            password: data.password,
            displayName: data.displayName.trim(),
        });
        const newUid = newUser.uid;
        const batch = db.batch();
        batch.set(db.doc(`users/${newUid}`), {
            businessId,
            role: data.role,
            active: true,
            email: data.email.trim().toLowerCase(),
            displayName: data.displayName.trim(),
            createdAt: now,
            updatedAt: now,
        });
        batch.set(db.doc(`businesses/${businessId}/users/${newUid}`), {
            uid: newUid,
            businessId,
            role: data.role,
            active: true,
            email: data.email.trim().toLowerCase(),
            displayName: data.displayName.trim(),
            createdAt: now,
            updatedAt: now,
        });
        await batch.commit();
        return { success: true, uid: newUid };
    }
    catch (err) {
        if (err.code === 'auth/email-already-exists') {
            throw new https_1.HttpsError('already-exists', 'Ya existe una cuenta con ese correo.');
        }
        throw new https_1.HttpsError('internal', err.message);
    }
});
// ══════════════════════════════════════════════════════════════
// 3. updateUserRole
// ══════════════════════════════════════════════════════════════
exports.updateUserRole = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'No autenticado.');
    }
    const data = request.data;
    const callerUid = request.auth.uid;
    const callerProfile = await db.doc(`users/${callerUid}`).get();
    if (!callerProfile.exists || ((_a = callerProfile.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'Administrador') {
        throw new https_1.HttpsError('permission-denied', 'Solo el administrador puede cambiar roles.');
    }
    const businessId = (_b = callerProfile.data()) === null || _b === void 0 ? void 0 : _b.businessId;
    if (data.targetUid === callerUid) {
        throw new https_1.HttpsError('invalid-argument', 'No puedes cambiar tu propio rol.');
    }
    if (!['Cajero', 'Encargado', 'Administrador'].includes(data.newRole)) {
        throw new https_1.HttpsError('invalid-argument', 'Rol inválido.');
    }
    const targetProfile = await db.doc(`users/${data.targetUid}`).get();
    if (!targetProfile.exists || ((_c = targetProfile.data()) === null || _c === void 0 ? void 0 : _c.businessId) !== businessId) {
        throw new https_1.HttpsError('not-found', 'Usuario no pertenece a este negocio.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.doc(`users/${data.targetUid}`).update({ role: data.newRole, updatedAt: now });
    await db.doc(`businesses/${businessId}/users/${data.targetUid}`).update({ role: data.newRole, updatedAt: now });
    return { success: true };
});
// ══════════════════════════════════════════════════════════════
// 4. deactivateUser
// ══════════════════════════════════════════════════════════════
exports.deactivateUser = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'No autenticado.');
    }
    const data = request.data;
    const callerUid = request.auth.uid;
    const callerProfile = await db.doc(`users/${callerUid}`).get();
    if (!callerProfile.exists || ((_a = callerProfile.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'Administrador') {
        throw new https_1.HttpsError('permission-denied', 'Solo el administrador puede desactivar usuarios.');
    }
    const businessId = (_b = callerProfile.data()) === null || _b === void 0 ? void 0 : _b.businessId;
    if (data.targetUid === callerUid) {
        throw new https_1.HttpsError('invalid-argument', 'No puedes desactivarte a ti mismo.');
    }
    const targetProfile = await db.doc(`users/${data.targetUid}`).get();
    if (!targetProfile.exists || ((_c = targetProfile.data()) === null || _c === void 0 ? void 0 : _c.businessId) !== businessId) {
        throw new https_1.HttpsError('not-found', 'Usuario no pertenece a este negocio.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    await auth.updateUser(data.targetUid, { disabled: true });
    await db.doc(`users/${data.targetUid}`).update({ active: false, updatedAt: now });
    await db.doc(`businesses/${businessId}/users/${data.targetUid}`).update({ active: false, updatedAt: now });
    return { success: true };
});
// ══════════════════════════════════════════════════════════════
// 5. auditOnSaleDelete (trigger)
// ══════════════════════════════════════════════════════════════
exports.auditOnSaleDelete = (0, firestore_1.onDocumentDeleted)({
    document: 'businesses/{businessId}/sales/{saleId}',
    region: 'us-central1',
}, async (event) => {
    var _a;
    const { businessId, saleId } = event.params;
    const deletedSale = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    await db.collection(`businesses/${businessId}/audit_logs`).add({
        action: 'DELETE_SALE',
        module: 'sales',
        userId: (deletedSale === null || deletedSale === void 0 ? void 0 : deletedSale.userId) || 'unknown',
        userName: 'Sistema (trigger)',
        role: 'system',
        targetId: saleId,
        targetName: (deletedSale === null || deletedSale === void 0 ? void 0 : deletedSale.saleNumber) || saleId,
        before: deletedSale || null,
        after: null,
        businessId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
});
// ══════════════════════════════════════════════════════════════
// 6. deleteUser
// ══════════════════════════════════════════════════════════════
exports.deleteUser = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'No autenticado.');
    }
    const data = request.data;
    const callerUid = request.auth.uid;
    const callerProfile = await db.doc(`users/${callerUid}`).get();
    if (!callerProfile.exists || ((_a = callerProfile.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'Administrador') {
        throw new https_1.HttpsError('permission-denied', 'Solo el administrador puede eliminar usuarios.');
    }
    const businessId = (_b = callerProfile.data()) === null || _b === void 0 ? void 0 : _b.businessId;
    if (data.targetUid === callerUid) {
        throw new https_1.HttpsError('invalid-argument', 'No puedes eliminarte a ti mismo.');
    }
    const targetProfile = await db.doc(`users/${data.targetUid}`).get();
    if (!targetProfile.exists || ((_c = targetProfile.data()) === null || _c === void 0 ? void 0 : _c.businessId) !== businessId) {
        throw new https_1.HttpsError('not-found', 'Usuario no pertenece a este negocio.');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    await auth.deleteUser(data.targetUid);
    await db.doc(`users/${data.targetUid}`).delete();
    await db.doc(`businesses/${businessId}/users/${data.targetUid}`).delete();
    await db.collection(`businesses/${businessId}/audit_logs`).add({
        action: 'DELETE_USER',
        module: 'users',
        userId: callerUid,
        userName: ((_d = callerProfile.data()) === null || _d === void 0 ? void 0 : _d.displayName) || 'Admin',
        role: 'Administrador',
        targetId: data.targetUid,
        targetName: ((_e = targetProfile.data()) === null || _e === void 0 ? void 0 : _e.displayName) || data.targetUid,
        before: { role: (_f = targetProfile.data()) === null || _f === void 0 ? void 0 : _f.role, email: (_g = targetProfile.data()) === null || _g === void 0 ? void 0 : _g.email },
        after: null,
        businessId,
        createdAt: now,
    });
    return { success: true };
});
// ══════════════════════════════════════════════════════════════
// 7. onBusinessPlanChange — TRIGGER AUTOMÁTICO
// ══════════════════════════════════════════════════════════════
// Se dispara cada vez que se actualiza el documento del negocio.
// Si el plan cambió de 'pro' a 'basic', aplica los límites
// inmediatamente sin esperar al scheduler nocturno.
// ══════════════════════════════════════════════════════════════
exports.onBusinessPlanChange = (0, firestore_1.onDocumentUpdated)({
    document: 'businesses/{businessId}',
    region: 'us-central1',
}, async (event) => {
    var _a, _b;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    const bizId = event.params.businessId;
    // Solo actuar si el plan bajó de pro a basic
    const planDowngraded = (before === null || before === void 0 ? void 0 : before.plan) === 'pro' && (after === null || after === void 0 ? void 0 : after.plan) === 'basic';
    if (!planDowngraded)
        return;
    console.log(`[onBusinessPlanChange] Plan degradado a basic para ${bizId}`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    // ── Bloquear productos extra ──────────────────────────
    const productsSnap = await db.collection(`businesses/${bizId}/products`)
        .where('active', '==', true)
        .orderBy('createdAt', 'asc')
        .get();
    if (productsSnap.docs.length > BASIC_LIMITS.products) {
        const toBlock = productsSnap.docs.slice(BASIC_LIMITS.products);
        for (const doc of toBlock) {
            batch.update(doc.ref, { planLocked: true, updatedAt: now });
        }
        console.log(`[onBusinessPlanChange] ${bizId}: bloqueados ${toBlock.length} productos`);
    }
    // ── Bloquear clientes extra ───────────────────────────
    const customersSnap = await db.collection(`businesses/${bizId}/customers`)
        .orderBy('createdAt', 'asc')
        .get();
    if (customersSnap.docs.length > BASIC_LIMITS.customers) {
        const toBlock = customersSnap.docs.slice(BASIC_LIMITS.customers);
        for (const doc of toBlock) {
            batch.update(doc.ref, { planLocked: true, updatedAt: now });
        }
        console.log(`[onBusinessPlanChange] ${bizId}: bloqueados ${toBlock.length} clientes`);
    }
    await batch.commit();
    // ── Bloquear usuarios extra (fuera del batch por auth.updateUser) ──
    await enforceUserLimit(bizId);
    // Audit log
    await db.collection(`businesses/${bizId}/audit_logs`).add({
        action: 'PLAN_DOWNGRADED',
        module: 'system',
        userId: 'system',
        userName: 'Sistema automático',
        role: 'system',
        targetId: bizId,
        targetName: (after === null || after === void 0 ? void 0 : after.name) || bizId,
        before: { plan: 'pro' },
        after: { plan: 'basic' },
        businessId: bizId,
        createdAt: now,
    });
});
// ══════════════════════════════════════════════════════════════
// 8. degradeExpiredPlans — Scheduler nocturno (2am)
// ══════════════════════════════════════════════════════════════
const GRACE_PERIOD_DAYS = 3;
exports.degradeExpiredPlans = (0, scheduler_1.onSchedule)({ schedule: '0 2 * * *', region: 'us-central1', timeZone: 'America/Santo_Domingo' }, async () => {
    var _a, _b;
    const now = new Date();
    const bizSnap = await db.collection('businesses').where('plan', '==', 'pro').get();
    for (const bizDoc of bizSnap.docs) {
        const biz = bizDoc.data();
        const bizId = bizDoc.id;
        const expires = (_b = (_a = biz.planExpiresAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a);
        if (!expires)
            continue;
        const diffDays = Math.floor((now.getTime() - expires.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays <= GRACE_PERIOD_DAYS)
            continue;
        console.log(`[degradePlan] Degradando ${bizId} — vencido hace ${diffDays} días`);
        const batch = db.batch();
        // Cambiar plan a basic (esto dispara onBusinessPlanChange automáticamente)
        batch.update(db.doc(`businesses/${bizId}`), {
            plan: 'basic',
            degradedAt: now,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await batch.commit();
        // onBusinessPlanChange se encarga del resto (productos, clientes, usuarios)
    }
    console.log(`[degradePlan] Completado — revisados ${bizSnap.docs.length} negocios Pro`);
});
// ══════════════════════════════════════════════════════════════
// 9. reactivatePlan — SuperAdmin aprueba upgrade
// ══════════════════════════════════════════════════════════════
exports.reactivatePlan = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado.');
    const callerProfile = await db.doc(`users/${request.auth.uid}`).get();
    if (((_a = callerProfile.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'superadmin') {
        throw new https_1.HttpsError('permission-denied', 'Solo el superadmin puede reactivar planes.');
    }
    const { businessId } = request.data;
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 30);
    const batch = db.batch();
    batch.update(db.doc(`businesses/${businessId}`), {
        plan: 'pro',
        planExpiresAt: expiresAt,
        planActivatedAt: now,
        degradedAt: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Desbloquear productos
    const productsSnap = await db.collection(`businesses/${businessId}/products`)
        .where('planLocked', '==', true).get();
    for (const doc of productsSnap.docs) {
        batch.update(doc.ref, { planLocked: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    // Desbloquear clientes
    const customersSnap = await db.collection(`businesses/${businessId}/customers`)
        .where('planLocked', '==', true).get();
    for (const doc of customersSnap.docs) {
        batch.update(doc.ref, { planLocked: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    // Desbloquear y reactivar usuarios — sin filtro para asegurar que los encuentra
    const allUsersSnap = await db.collection(`businesses/${businessId}/users`).get();
    const lockedUsers = allUsersSnap.docs.filter(d => d.data().planLocked === true);
    console.log(`[reactivatePlan] Usuarios totales: ${allUsersSnap.docs.length}, bloqueados: ${lockedUsers.length}`);
    for (const doc of lockedUsers) {
        const uid = doc.data().uid || doc.id;
        console.log(`[reactivatePlan] Desbloqueando uid: ${uid}`);
        try {
            await auth.updateUser(uid, { disabled: false });
            console.log(`[reactivatePlan] Auth habilitado para ${uid}`);
        }
        catch (e) {
            console.warn(`[reactivatePlan] Auth falló para ${uid}:`, e.message);
        }
        batch.update(doc.ref, { planLocked: false, active: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        batch.update(db.doc(`users/${uid}`), { planLocked: false, active: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    await batch.commit();
    console.log(`[reactivatePlan] Plan Pro reactivado para ${businessId} — ${lockedUsers.length} usuarios desbloqueados`);
    return { success: true, expiresAt, usersUnlocked: lockedUsers.length };
});
// ══════════════════════════════════════════════════════════════
// 10. activateTrial — Activa prueba gratuita de 21 días
// Reemplaza el updateDoc directo del cliente para garantizar
// que los usuarios bloqueados se reactiven correctamente.
// ══════════════════════════════════════════════════════════════
exports.activateTrial = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c, _d, _e;
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'No autenticado.');
    const callerUid = request.auth.uid;
    const callerProfile = await db.doc(`users/${callerUid}`).get();
    if (!callerProfile.exists) {
        throw new https_1.HttpsError('not-found', 'Usuario no encontrado.');
    }
    if (((_a = callerProfile.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'Administrador') {
        throw new https_1.HttpsError('permission-denied', 'Solo el administrador puede activar la prueba.');
    }
    const businessId = (_b = callerProfile.data()) === null || _b === void 0 ? void 0 : _b.businessId;
    if (!businessId)
        throw new https_1.HttpsError('failed-precondition', 'Negocio no encontrado.');
    // Verificar que no haya usado la prueba antes
    const bizDoc = await db.doc(`businesses/${businessId}`).get();
    if (!bizDoc.exists)
        throw new https_1.HttpsError('not-found', 'Negocio no encontrado.');
    if (((_c = bizDoc.data()) === null || _c === void 0 ? void 0 : _c.trialUsed) === true) {
        throw new https_1.HttpsError('failed-precondition', 'Ya usaste tu prueba gratuita.');
    }
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 21);
    const ts = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    // 1. Actualizar plan del negocio
    batch.update(db.doc(`businesses/${businessId}`), {
        plan: 'pro',
        planExpiresAt: expiresAt,
        planActivatedAt: now,
        trialUsed: true,
        trialStartedAt: now,
        updatedAt: ts,
    });
    // 2. Desbloquear productos
    const productsSnap = await db.collection(`businesses/${businessId}/products`)
        .where('planLocked', '==', true).get();
    for (const doc of productsSnap.docs) {
        batch.update(doc.ref, { planLocked: false, updatedAt: ts });
    }
    // 3. Desbloquear clientes
    const customersSnap = await db.collection(`businesses/${businessId}/customers`)
        .where('planLocked', '==', true).get();
    for (const doc of customersSnap.docs) {
        batch.update(doc.ref, { planLocked: false, updatedAt: ts });
    }
    // 4. Desbloquear usuarios
    const allUsersSnap = await db.collection(`businesses/${businessId}/users`).get();
    const lockedUsers = allUsersSnap.docs.filter(d => d.data().planLocked === true);
    for (const doc of lockedUsers) {
        const uid = doc.data().uid || doc.id;
        try {
            await auth.updateUser(uid, { disabled: false });
        }
        catch (e) {
            console.warn(`[activateTrial] Auth falló para ${uid}:`, e.message);
        }
        batch.update(doc.ref, { planLocked: false, active: true, updatedAt: ts });
        batch.update(db.doc(`users/${uid}`), { planLocked: false, active: true, updatedAt: ts });
    }
    await batch.commit();
    // 5. Audit log
    await db.collection(`businesses/${businessId}/audit_logs`).add({
        action: 'TRIAL_ACTIVATED',
        module: 'system',
        userId: callerUid,
        userName: ((_d = callerProfile.data()) === null || _d === void 0 ? void 0 : _d.displayName) || 'Admin',
        role: 'Administrador',
        targetId: businessId,
        before: { plan: ((_e = bizDoc.data()) === null || _e === void 0 ? void 0 : _e.plan) || 'basic' },
        after: { plan: 'pro', trial: true, expiresAt },
        businessId,
        createdAt: ts,
    });
    console.log(`[activateTrial] Trial activado para ${businessId} — ${lockedUsers.length} usuarios desbloqueados`);
    return { success: true, expiresAt, usersUnlocked: lockedUsers.length };
});
//# sourceMappingURL=index.js.map