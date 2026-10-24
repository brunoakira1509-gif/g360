const dev = process.env.NODE_ENV === 'development';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  'img-src \'self\' data: blob:',
  "font-src 'self' data:",
  'connect-src \'self\' https://*.supabase.co https://servicodados.ibge.gov.br https://huggingface.co https://*.huggingface.co https://*.hf.co',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export default { poweredByHeader:false, async headers(){ return [{ source:'/(.*)', headers:[
 {key:'Content-Security-Policy',value:csp},
 {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
 {key:'X-Frame-Options',value:'DENY'},{key:'X-Content-Type-Options',value:'nosniff'},
 {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
 {key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains; preload'},
 {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'}]}] } };
