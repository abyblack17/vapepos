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
exports.createLemonSqueezyCheckout = exports.lemonSqueezyWebhook = exports.deleteUser = exports.auditOnSaleDelete = exports.deactivateUser = exports.updateUserRole = exports.addEmployeeToStore = exports.registerBusiness = void 0;
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const LEMON_SQUEEZY_API_KEY = (0, params_1.defineSecret)('LEMON_SQUEEZY_API_KEY');
const LEMON_SQUEEZY_SIGNING_SECRET = (0, params_1.defineSecret)('LEMON_SQUEEZY_SIGNING_SECRET');
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
            plan: 'starter',
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
            after: { businessName: data.businessName.trim(), plan: 'starter' },
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
// 6. deleteUser — Admin elimina un usuario completamente
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
// 7. lemonSqueezyWebhook
// ══════════════════════════════════════════════════════════════
exports.lemonSqueezyWebhook = (0, https_1.onRequest)({
    region: 'us-central1',
    secrets: [LEMON_SQUEEZY_SIGNING_SECRET],
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }
        const signingSecret = LEMON_SQUEEZY_SIGNING_SECRET.value();
        const signature = req.headers['x-signature'];
        if (!signature) {
            res.status(400).send('Falta firma');
            return;
        }
        const crypto = require('crypto');
        const expectedSignature = crypto
            .createHmac('sha256', signingSecret)
            .update(req.rawBody)
            .digest('hex');
        if (signature !== expectedSignature) {
            res.status(403).send('Firma inválida');
            return;
        }
        const eventName = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.meta) === null || _b === void 0 ? void 0 : _b.event_name;
        const customData = ((_d = (_c = req.body) === null || _c === void 0 ? void 0 : _c.meta) === null || _d === void 0 ? void 0 : _d.custom_data) || {};
        const attributes = ((_f = (_e = req.body) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.attributes) || {};
        const subscriptionId = ((_h = (_g = req.body) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.id) || null;
        const businessId = customData.businessId;
        if (!businessId) {
            res.status(200).send('OK');
            return;
        }
        const now = new Date();
        const ts = admin.firestore.FieldValue.serverTimestamp();
        if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
            let planExpiresAt = null;
            if (attributes.renews_at) {
                planExpiresAt = new Date(attributes.renews_at);
            }
            else if (attributes.ends_at) {
                planExpiresAt = new Date(attributes.ends_at);
            }
            else {
                planExpiresAt = new Date(now);
                planExpiresAt.setDate(planExpiresAt.getDate() + 30);
            }
            await db.doc(`businesses/${businessId}`).set({
                plan: 'pro',
                planActivatedAt: now,
                planExpiresAt,
                degradedAt: null,
                lemonSqueezy: {
                    status: attributes.status || 'active',
                    renewsAt: attributes.renews_at ? new Date(attributes.renews_at) : null,
                    endsAt: attributes.ends_at ? new Date(attributes.ends_at) : null,
                    subscriptionId,
                    customerId: attributes.customer_id || null,
                    variantId: attributes.variant_id || null,
                    productId: attributes.product_id || null,
                    orderId: attributes.order_id || null,
                    updatedAt: ts,
                },
                updatedAt: ts,
            }, { merge: true });
        }
        if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
            await db.doc(`businesses/${businessId}`).set({
                plan: 'starter',
                planExpiresAt: attributes.ends_at ? new Date(attributes.ends_at) : null,
                degradedAt: now,
                lemonSqueezy: {
                    status: 'inactive',
                    renewsAt: null,
                    endsAt: attributes.ends_at ? new Date(attributes.ends_at) : null,
                    subscriptionId,
                    customerId: attributes.customer_id || null,
                    variantId: attributes.variant_id || null,
                    productId: attributes.product_id || null,
                    orderId: attributes.order_id || null,
                    updatedAt: ts,
                },
                updatedAt: ts,
            }, { merge: true });
        }
        res.status(200).send('OK');
    }
    catch (error) {
        console.error('Error en webhook Lemon Squeezy:', error);
        res.status(500).send('Error');
    }
});
// ══════════════════════════════════════════════════════════════
// 8. createLemonSqueezyCheckout
// ══════════════════════════════════════════════════════════════
exports.createLemonSqueezyCheckout = (0, https_1.onCall)({
    region: 'us-central1',
    secrets: [LEMON_SQUEEZY_API_KEY],
}, async (request) => {
    var _a, _b, _c, _d;
    try {
        const authUser = request.auth;
        if (!authUser) {
            throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión');
        }
        const { businessId, email } = request.data || {};
        if (!businessId) {
            throw new https_1.HttpsError('invalid-argument', 'Falta businessId');
        }
        const apiKey = LEMON_SQUEEZY_API_KEY.value();
        const storeId = 324232;
        const variantId = 1437338;
        console.log('CHECKOUT DEBUG 1');
        console.log(JSON.stringify({
            apiKeyExiste: !!apiKey,
            storeId,
            variantId,
            businessId,
            email: email || null,
        }));
        console.log('CHECKOUT DEBUG 1');
        console.log(JSON.stringify({
            apiKeyExiste: !!apiKey,
            storeId,
            variantId,
            businessId,
            email: email || null,
        }));
        const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
            method: 'POST',
            headers: {
                Accept: 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                data: {
                    type: 'checkouts',
                    attributes: {
                        checkout_data: {
                            email: email || undefined,
                            custom: {
                                businessId,
                            },
                        },
                    },
                    relationships: {
                        store: {
                            data: {
                                type: 'stores',
                                id: String(storeId),
                            },
                        },
                        variant: {
                            data: {
                                type: 'variants',
                                id: String(variantId),
                            },
                        },
                    },
                },
            }),
        });
        const json = await response.json();
        console.log('CHECKOUT DEBUG 2');
        console.log(JSON.stringify({
            ok: response.ok,
            status: response.status,
            json,
        }));
        if (!response.ok) {
            throw new https_1.HttpsError('internal', ((_b = (_a = json === null || json === void 0 ? void 0 : json.errors) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.detail) || 'No se pudo crear el checkout');
        }
        const checkoutUrl = (_d = (_c = json === null || json === void 0 ? void 0 : json.data) === null || _c === void 0 ? void 0 : _c.attributes) === null || _d === void 0 ? void 0 : _d.url;
        if (!checkoutUrl) {
            throw new https_1.HttpsError('internal', 'Lemon Squeezy no devolvió URL');
        }
        return { url: checkoutUrl };
    }
    catch (error) {
        console.error('CHECKOUT ERROR', error);
        throw new https_1.HttpsError('internal', (error === null || error === void 0 ? void 0 : error.message) || 'Error interno creando checkout');
    }
});
//# sourceMappingURL=index.js.map