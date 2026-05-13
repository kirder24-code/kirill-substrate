import type { TextProvider, VisualProvider } from "./types";

export class ProviderRegistry {
  private readonly textProviders = new Map<string, TextProvider>();
  private readonly visualProviders = new Map<string, VisualProvider>();

  registerTextProvider(provider: TextProvider): void {
    this.textProviders.set(provider.id, provider);
  }

  registerVisualProvider(provider: VisualProvider): void {
    this.visualProviders.set(provider.id, provider);
  }

  getTextProvider(id: string | null | undefined): TextProvider | null {
    if (!id) return null;
    return this.textProviders.get(id) ?? null;
  }

  getVisualProvider(id: string | null | undefined): VisualProvider | null {
    if (!id) return null;
    return this.visualProviders.get(id) ?? null;
  }
}
