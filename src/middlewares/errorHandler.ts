import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { logger } from '../config/logger';

export type ErrorResponse = {
    status: number;
    code: string;
    messages: any[];
};

const MULTER_ERROR_MAP: Record<string, { code: string; message: string }> = {
    LIMIT_FILE_SIZE: { code: 'FILE_TOO_LARGE', message: 'Arquivo excede 10MB' },
    LIMIT_FILE_COUNT: { code: 'TOO_MANY_FILES', message: 'Máximo de 20 fotos por propriedade' },
    LIMIT_UNEXPECTED_FILE: { code: 'UNEXPECTED_FILE_FIELD', message: 'Campo de arquivo inválido' },
};

export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    logger.error(
        { err, path: req.path, method: req.method },
        `[error-handler] ${err.name}: ${err.message}`,
    );

    let response: ErrorResponse = {
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        messages: [{ message: 'An unexpected error occurred.' }],
    };

    if (err instanceof ZodError) {
        response.status = 400;
        response.code = 'VALIDATION_ERROR';
        response.messages = err.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
        }));
    } else if (err instanceof multer.MulterError) {
        const mapped = MULTER_ERROR_MAP[err.code];
        response.status = 400;
        response.code = mapped?.code ?? 'UPLOAD_ERROR';
        response.messages = [{ message: mapped?.message ?? err.message }];
    } else if (err.message === 'INVALID_FILE_TYPE') {
        response.status = 400;
        response.code = 'INVALID_FILE_TYPE';
        response.messages = [{ message: 'Apenas JPEG ou PNG são aceitos' }];
    } else if (err.name === 'SyntaxError') { // Catch JSON parse errors
        response.status = 400;
        response.code = 'BAD_REQUEST';
        response.messages = [{ message: 'Invalid JSON payload.' }];
    } else {
        response.messages = [{ message: err.message }];
    }

    res.status(response.status).json(response);
};
