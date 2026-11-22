import { json, type RequestHandler } from 'express';

const parseResumeJson = json({ limit: '100kb', inflate: false });

export const resumeBodyParser: RequestHandler = (req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'PUT') return next();
    if (!req.is('application/json')) {
        res.status(415).json({
            statusCode: 415,
            message: 'Send an application/json request body',
        });
        return;
    }
    parseResumeJson(req, res, (error: unknown) => {
        if (!error) return next();

        if (typeof error === 'object' && 'status' in error) {
            if (error.status === 413) {
                res.status(413).json({ statusCode: 413, message: 'Resume body exceeds 100 KB' });
                return;
            }
            if (error.status === 415) {
                res.status(415).json({ statusCode: 415, message: 'Unsupported JSON encoding' });
                return;
            }
        }
        res.status(400).json({ statusCode: 400, message: 'Invalid JSON body' });
    });
};
