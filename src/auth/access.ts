import { createRemoteJWKSet, jwtVerify } from 'jose';

// O Cloudflare Access (OAuth gerenciado) fica na frente do Worker. Mesmo assim o Worker valida o JWT:
// sem isso, qualquer caminho que pulasse o Access cairia aberto.
export interface AccessEnv {
  ACCESS_TEAM_DOMAIN: string; // ex. "seu-time.cloudflareaccess.com"
  ACCESS_AUD: string; // "Application Audience (AUD) Tag" da aplicação Access
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Devolve o e-mail autenticado, ou null se o JWT faltar, for inválido ou o Access não estiver configurado. */
export async function accessIdentity(request: Request, env: AccessEnv): Promise<string | null> {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let jwks = jwksCache.get(issuer);
  if (!jwks) jwksCache.set(issuer, (jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
    return typeof payload.email === 'string' ? payload.email : String(payload.sub ?? 'desconhecido');
  } catch {
    return null;
  }
}
