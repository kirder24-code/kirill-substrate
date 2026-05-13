import type { CreateSignalInput, Signal } from "@linkedin-brand-os/shared";

export interface SignalsRepository {
  createSignal(input: CreateSignalInput): Promise<Signal>;
  listSignals(): Promise<Signal[]>;
  getSignalById(id: string): Promise<Signal | null>;
}

