function httpError(status, message, extra) {
    const error = new Error(message);
    error.status = status;
    if (extra) Object.assign(error, extra);
    return error;
}

function sendError(res, error, method) {
    const status = error.status || 500;
    if (status >= 500) console.error(`[${method}]`, error);
    const body = { error: status >= 500 ? "Internal error" : error.message };
    if (error.missing) body.missing = error.missing;
    res.status(status).json(body);
}

module.exports = { httpError, sendError };
