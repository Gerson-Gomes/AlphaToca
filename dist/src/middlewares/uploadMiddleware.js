"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.conditionalPropertyPhotoUploadHandler = exports.propertyPhotoUploadHandler = exports.propertyPhotoUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 20;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const fileFilter = (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
        return;
    }
    cb(new Error('INVALID_FILE_TYPE'));
};
exports.propertyPhotoUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: MAX_FILE_COUNT,
    },
    fileFilter,
});
exports.propertyPhotoUploadHandler = exports.propertyPhotoUpload.array('photos', MAX_FILE_COUNT);
// PUT /properties/:id aceita application/json (caminho legado) E multipart/form-data
// (novo caminho para adicionar fotos via edição). Multer consome o stream do request,
// então só pode rodar quando o Content-Type é multipart — em JSON, ele derrubaria o
// body parser. Este wrapper despacha apenas quando o header bate.
const conditionalPropertyPhotoUploadHandler = (req, res, next) => {
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
        return (0, exports.propertyPhotoUploadHandler)(req, res, next);
    }
    return next();
};
exports.conditionalPropertyPhotoUploadHandler = conditionalPropertyPhotoUploadHandler;
