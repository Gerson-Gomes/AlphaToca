"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_WEIGHT = void 0;
exports.updateMessageStatus = updateMessageStatus;
const db_1 = __importDefault(require("../config/db"));
exports.STATUS_WEIGHT = {
    failed: 0,
    sent: 1,
    delivered: 2,
    read: 3,
};
async function updateMessageStatus(payload) {
    const { id: wamid, status: newStatus } = payload;
    const message = await db_1.default.message.findUnique({ where: { wamid } });
    if (!message) {
        console.log(`[StatusService] Mensagem com wamid ${wamid} não encontrada no banco.`);
        return;
    }
    const currentWeight = exports.STATUS_WEIGHT[message.status];
    const newWeight = exports.STATUS_WEIGHT[newStatus];
    if (newWeight <= currentWeight) {
        console.log(`[StatusService] Ignorado: status recebido "${newStatus}" (peso ${newWeight}) ` +
            `<= status atual "${message.status}" (peso ${currentWeight}) para wamid ${wamid}.`);
        return;
    }
    await db_1.default.message.update({
        where: { wamid },
        data: { status: newStatus },
    });
    console.log(`[StatusService] Atualizado: wamid ${wamid} de "${message.status}" → "${newStatus}".`);
}
