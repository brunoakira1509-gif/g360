export const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const isEmail = v => typeof v === 'string' && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
export const strongPw = v => typeof v === 'string' && v.length >= 12 && v.length <= 128 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v);
export const body = async req => { try { return await req.json(); } catch { return {}; } };
