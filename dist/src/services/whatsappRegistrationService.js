"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappRegistration = void 0;
const firebase_1 = __importDefault(require("../config/firebase"));
const userService_1 = require("./userService");
const mailService_1 = require("./mailService");
const logger_1 = require("../config/logger");
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
function extractEmail(message) {
    const match = message.match(EMAIL_REGEX);
    return match ? match[0].toLowerCase() : null;
}
function generatePassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
    let pwd = "";
    for (let i = 0; i < 16; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    return pwd;
}
// Cache de links de reset por phoneNumber (TTL 15 min).
// Se o usuario falar "nao chegou", reenvia o link pelo WhatsApp.
const resetLinkCache = new Map();
const RESET_LINK_TTL_MS = 15 * 60_000;
function cacheResetLink(phoneNumber, link) {
    resetLinkCache.set(phoneNumber, { link, expiresAt: Date.now() + RESET_LINK_TTL_MS });
}
function onResetLink(email, phoneNumber, resetLink) {
    cacheResetLink(phoneNumber, resetLink);
    (0, mailService_1.sendPasswordReset)(email, resetLink)
        .then((ok) => {
        if (ok)
            logger_1.logger.info({ email }, "[registration] password reset email sent");
        else
            logger_1.logger.warn({ email }, "[registration] password reset email failed");
    })
        .catch(() => { });
}
exports.whatsappRegistration = {
    isEmail(message) {
        return extractEmail(message);
    },
    /** Se usuario falar "nao chegou" / "nao recebi", devolve o link direto */
    getResetLink(phoneNumber) {
        const cached = resetLinkCache.get(phoneNumber);
        if (!cached || Date.now() > cached.expiresAt) {
            resetLinkCache.delete(phoneNumber);
            return null;
        }
        return cached.link;
    },
    async register(params) {
        const { phoneNumber, name, email } = params;
        try {
            // Verifica se ja existe no Firebase
            try {
                const existing = await firebase_1.default.auth().getUserByEmail(email);
                if (existing) {
                    await userService_1.userService.upsertUserFromFirebase({
                        uid: existing.uid,
                        name: existing.displayName || name,
                        email,
                        phone_number: phoneNumber,
                        role: "TENANT",
                    });
                    let resetLink = "";
                    try {
                        resetLink = await firebase_1.default.auth().generatePasswordResetLink(email);
                    }
                    catch { /* ignora */ }
                    if (resetLink) {
                        onResetLink(email, phoneNumber, resetLink);
                    }
                    return {
                        success: true,
                        email,
                        message: "Seu e-mail ja estava cadastrado! Vinculamos ao seu WhatsApp. \u2705\n\n" +
                            "\u{1F4E7} Enviamos um link no seu e-mail pra criar sua senha. " +
                            "Da uma olhada la (e no spam)! Se nao chegar, me avisa que eu te mando por aqui.\n\n" +
                            "Como posso te ajudar com o aluguel?",
                        alreadyRegistered: true,
                    };
                }
            }
            catch (err) {
                if (err?.code !== "auth/user-not-found") {
                    throw err;
                }
            }
            const password = generatePassword();
            logger_1.logger.info({ email, phoneNumber }, "[registration] creating Firebase user");
            await firebase_1.default.auth().createUser({
                email,
                password,
                displayName: name,
                phoneNumber: `+${phoneNumber}`,
            });
            logger_1.logger.info({ email }, "[registration] Firebase user created, fetching uid");
            const firebaseUser = await firebase_1.default.auth().getUserByEmail(email);
            const uid = firebaseUser.uid;
            logger_1.logger.info({ email, uid }, "[registration] linking Firebase uid to local DB");
            const localUser = await userService_1.userService.upsertUserFromFirebase({
                uid,
                name,
                email,
                phone_number: phoneNumber,
                role: "TENANT",
            });
            logger_1.logger.info({ phoneNumber, email, uid, localUserId: localUser.id }, "[registration] local DB updated with firebaseUid");
            let resetLink = "";
            try {
                resetLink = await firebase_1.default.auth().generatePasswordResetLink(email);
            }
            catch { /* ignora */ }
            if (resetLink) {
                onResetLink(email, phoneNumber, resetLink);
            }
            logger_1.logger.info({ phoneNumber, email }, "[registration] user registered via WhatsApp");
            return {
                success: true,
                email,
                message: "Cadastro concluido! \u2705\n\n" +
                    "\u{1F4E7} Enviamos um link no seu e-mail para voce criar sua senha de acesso. " +
                    "Da uma olhada na caixa de entrada (e no spam)!\n\n" +
                    "Se nao chegar em alguns minutos, me avisa que eu te mando o link por aqui.\n\n" +
                    "Enquanto isso, como posso te ajudar com o aluguel? \u{1F3E0}",
            };
        }
        catch (err) {
            const firebaseCode = err?.code || err?.errorInfo?.code || "unknown";
            logger_1.logger.error({ err, phoneNumber, email, firebaseCode }, "[registration] Firebase registration failed");
            return {
                success: false,
                message: "Tive um problema ao finalizar seu cadastro (" + firebaseCode +
                    "). Um atendente vai te ajudar, mas pode continuar me perguntando sobre imoveis enquanto isso!",
            };
        }
    },
};
