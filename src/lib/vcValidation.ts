import { getSubdomainContext, redirectToVC } from './subdomain';
import type { UserProfile } from '@/types';

export function validateVCAccess(profile: UserProfile): boolean {
  const subdomain = getSubdomainContext();
  
  if (!subdomain.isMainDomain && profile.vc) {
    const vcNameFromSubdomain = subdomain.vcName?.toLowerCase().replace(/-/g, ' ');
    const userVcName = profile.vc.name.toLowerCase();
    
    if (vcNameFromSubdomain !== userVcName) {
      redirectToVC(profile.vc.name);
      return false;
    }
  }
  
  return true;
}
