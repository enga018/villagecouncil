import { ReactNode } from 'react';

export interface ModuleConfig {
  id: string;
  name: string;
  description: string;
  version: string;
  icon?: string;
  enabled: boolean;
  permissions?: string[];
  dataSchema?: Record<string, unknown>;
}

export interface Module {
  config: ModuleConfig;
  component: () => ReactNode;
  hooks?: Record<string, () => unknown>;
}

const modules: Map<string, Module> = new Map();

export function registerModule(module: Module) {
  modules.set(module.config.id, module);
}

export function getModule(moduleId: string): Module | undefined {
  return modules.get(moduleId);
}

export function getModulesByVC(vcId: string): Module[] {
  return Array.from(modules.values());
}

export function listModules(): Module[] {
  return Array.from(modules.values());
}

export function isModuleEnabled(moduleId: string, vcId: string): boolean {
  const module = modules.get(moduleId);
  return module?.config.enabled ?? false;
}
