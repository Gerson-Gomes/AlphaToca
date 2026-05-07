import admin from "../config/firebase";
import { userService } from "./userService";
import { logger } from "../config/logger";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// Extrai o primeiro email de uma mensagem
function extractEmail(message: string): string | null {
  const match = message.match(EMAIL_REGEX);
  return match ? match[0].toLowerCase() : null;
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  let pwd = "";
  for (let i = 0; i < 16; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd;
}

export interface WhatsAppRegistrationResult {
  success: boolean;
  email?: string;
  message: string;
  alreadyRegistered?: boolean;
}

export const whatsappRegistration = {
  isEmail(message: string): string | null {
    return extractEmail(message);
  },

  async register(params: {
    phoneNumber: string;
    name: string;
    email: string;
  }): Promise<WhatsAppRegistrationResult> {
    const { phoneNumber, name, email } = params;

    try {
      // Verifica se já existe no Firebase
      try {
        const existing = await admin.auth().getUserByEmail(email);
        if (existing) {
          await userService.upsertUserFromFirebase({
            uid: existing.uid,
            name: existing.displayName || name,
            email,
            phone_number: phoneNumber,
            role: "TENANT",
          });

          // Gera link pra redefinir senha e manda no WhatsApp
          let resetLink = "";
          try {
            resetLink = await admin.auth().generatePasswordResetLink(email);
          } catch {
            // ignora
          }

          const resetMsg = resetLink
            ? `\u{1F511} Crie sua senha aqui: ${resetLink}\n\n`
            : "";

          return {
            success: true,
            email,
            message:
              "Seu e-mail já estava cadastrado! Vinculamos ao seu WhatsApp. \u2705\n\n" +
              resetMsg +
              "Como posso te ajudar com o aluguel?",
            alreadyRegistered: true,
          };
        }
      } catch {
        // Não existe ainda, vai criar
      }

      const password = generatePassword();

      await admin.auth().createUser({
        email,
        password,
        displayName: name,
        phoneNumber: `+${phoneNumber}`,
      });

      const firebaseUser = await admin.auth().getUserByEmail(email);
      const uid = firebaseUser.uid;

      await userService.upsertUserFromFirebase({
        uid,
        name,
        email,
        phone_number: phoneNumber,
        role: "TENANT",
      });

      // Gera link de redefinição de senha e envia direto no WhatsApp.
      // Mais confiável que depender do email da Firebase chegar no Gmail.
      let resetLink = "";
      try {
        resetLink = await admin.auth().generatePasswordResetLink(email);
      } catch {
        // ignora
      }

      logger.info(
        { phoneNumber, email },
        "[whatsappRegistration] user registered via WhatsApp"
      );

      const resetMsg = resetLink
        ? `\u{1F511} Crie sua senha agora: ${resetLink}\n\n`
        : "\u{1F4E9} Você receberá um e-mail para criar sua senha.\n";

      return {
        success: true,
        email,
        message:
          "Cadastro concluído! \u2705\n\n" +
          resetMsg +
          "Enquanto isso, como posso te ajudar com o aluguel? \u{1F3E0}",
      };
    } catch (err: any) {
      logger.error(
        { err, phoneNumber, email },
        "[whatsappRegistration] registration failed"
      );
      return {
        success: false,
        message:
          "Tive um problema ao finalizar seu cadastro. Um atendente vai te ajudar com isso, mas pode continuar me perguntando sobre imóveis enquanto isso!",
      };
    }
  },
};
