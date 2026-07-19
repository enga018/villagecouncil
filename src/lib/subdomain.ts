export interface SubdomainContext {
  isMainDomain: boolean;
  subdomain: string | null;
  vcName: string | null;
}

export function getSubdomainContext(hostname: string = ''): SubdomainContext {
  if (!hostname && typeof window !== 'undefined') {
    hostname = window.location.hostname;
  }

  const parts = hostname.split('.');

  // localhost or IP address
  if (parts.length <= 1 || /^\d+$/.test(parts[0])) {
    return { isMainDomain: true, subdomain: null, vcName: null };
  }

  // Main domain (villagecouncil.enga.in)
  if (parts.length === 3 && parts[1] === 'enga' && parts[2] === 'in') {
    const subdomain = parts[0];
    const isMainDomain = subdomain === 'villagecouncil' || subdomain === 'www';
    return {
      isMainDomain,
      subdomain: isMainDomain ? null : subdomain,
      vcName: isMainDomain ? null : subdomain,
    };
  }

  // vc.villagecouncil.localhost or similar (dev/staging)
  if (parts.includes('villagecouncil') && parts.includes('localhost')) {
    const vcIndex = parts.findIndex((p) => p === 'villagecouncil');
    if (vcIndex > 0) {
      const subdomain = parts[vcIndex - 1];
      const isMainDomain = subdomain === 'www';
      return {
        isMainDomain,
        subdomain: isMainDomain ? null : subdomain,
        vcName: isMainDomain ? null : subdomain,
      };
    }
  }

  return { isMainDomain: true, subdomain: null, vcName: null };
}

export function getFullSubdomainUrl(vcName: string, path: string = ''): string {
  if (typeof window === 'undefined') return '';

  const protocol = window.location.protocol;
  const baseUrl = `${protocol}//${vcName}.villagecouncil.enga.in`;
  return path ? `${baseUrl}${path}` : baseUrl;
}

export function redirectToVC(vcName: string, path: string = '/') {
  if (typeof window === 'undefined') return;
  window.location.href = getFullSubdomainUrl(vcName, path);
}

export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.local')
  );
}
