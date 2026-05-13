"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPasswordReset = sendPasswordReset;
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = require("../config/logger");
let transporter = null;
function getTransporter() {
    if (transporter)
        return transporter;
    transporter = nodemailer_1.default.createTransport({
        host: process.env.MAIL_HOST || "smtp.gmail.com",
        port: Number(process.env.MAIL_PORT) || 587,
        secure: false,
        auth: {
            user: process.env.MAIL_USER,
            pass: (process.env.MAIL_PASS || "").replace(/\s/g, ""),
        },
    });
    logger_1.logger.info("[mailService] transporter initialized");
    return transporter;
}
const MAIL_FROM = process.env.MAIL_FROM || process.env.MAIL_USER || "I-Moveis";
async function sendPasswordReset(to, resetLink) {
    try {
        await getTransporter().sendMail({
            from: MAIL_FROM,
            to,
            subject: "Redefinicão de senha — I-Moveis",
            html: `
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
  <h2 style="color: #1a1a2e;">I-Moveis</h2>
  <p>Olá,</p>
  <p>Recebemos uma solicitação para redefinir a senha da sua conta no <strong>I-Moveis</strong>.</p>
  <p>Clique no botão abaixo para criar sua nova senha:</p>
  <p style="margin: 24px 0;">
    <a href="${resetLink}"
       style="background: #2563eb; color: #fff; padding: 12px 24px;
              border-radius: 6px; text-decoration: none; font-weight: bold;">
      Redefinir minha senha
    </a>
  </p>
  <p style="color: #666; font-size: 13px;">
    Se você não solicitou isso, pode ignorar este e-mail.
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="color: #999; font-size: 12px;">
    Atenciosamente,<br>Equipe I-Moveis
  </p>
</div>`.trim(),
        });
        logger_1.logger.info({ to }, "[mailService] password reset email sent");
        return true;
    }
    catch (err) {
        logger_1.logger.error({ err, to }, "[mailService] failed to send password reset email");
        return false;
    }
}
