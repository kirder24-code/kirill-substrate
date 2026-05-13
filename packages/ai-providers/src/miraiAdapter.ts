import type { ProviderAvailability } from "./types";
import type {
  MiraiTransportConfig,
  MiraiTransportRequest,
  MiraiTransportResponse
} from "./miraiTransport";
import { MiraiNodeTransport } from "./miraiTransport";
import { MiraiSdkTransport } from "./miraiSdkTransport";

export interface MiraiAdapterConfig extends MiraiTransportConfig {
  endpoint?: string;
  modelRepo?: string;
}

export interface MiraiTransportClient {
  getAvailability(): ProviderAvailability;
  generateText(
    request: MiraiTransportRequest
  ): Promise<MiraiTransportResponse>;
  getSummary(): string;
}

export interface MiraiAdapterOptions {
  config?: MiraiAdapterConfig;
  transport?: MiraiTransportClient;
}

export class MiraiAdapter {
  private readonly config: MiraiAdapterConfig;
  private readonly transport: MiraiTransportClient;

  constructor(options: MiraiAdapterOptions = {}) {
    this.config = options.config ?? {};
    this.transport =
      options.transport ??
      (this.config.transport === "sdk"
        ? new MiraiSdkTransport(this.config)
        : new MiraiNodeTransport(this.config));
  }

  getAvailability(): ProviderAvailability {
    return this.transport.getAvailability();
  }

  async generateText(
    request: MiraiTransportRequest
  ): Promise<MiraiTransportResponse> {
    return this.transport.generateText(request);
  }

  getSummary(): string {
    if (this.config.endpoint) {
      return `${this.config.model ?? "mirai-default"}@${this.config.endpoint}`;
    }

    return this.transport.getSummary();
  }
}
