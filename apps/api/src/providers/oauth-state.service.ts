import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import {
  createOpaqueToken,
  digestToken,
} from "../infrastructure/security.utils.js";
import { CredentialVaultService } from "./credential-vault.service.js";
import { ProviderError } from "./provider.errors.js";
import type { ProviderId } from "@holymedia/contracts";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";

export type CreatedOAuthState = {
  state: string;
  authorizationState:
    | { codeVerifier: string; codeChallenge: string }
    | { codeVerifier?: never; codeChallenge?: never };
};

export type ConsumedOAuthState = {
  userId: string;
  workspaceId: string;
  provider: ProviderId;
  sessionId: string;
  codeVerifier?: string;
  connectionId: string | null;
};

@Injectable()
export class OAuthStateService {
  private readonly config = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CredentialVaultService)
    private readonly vault: CredentialVaultService,
  ) {}

  public async create(input: {
    principal: HumanPrincipal;
    workspaceId: string;
    provider: ProviderId;
    sessionId: string;
    usePkce: boolean;
    connectionId?: string;
  }): Promise<CreatedOAuthState> {
    const state = createOpaqueToken();
    const codeVerifier = input.usePkce ? createOpaqueToken() : undefined;
    const codeChallenge = codeVerifier
      ? createHash("sha256").update(codeVerifier).digest("base64url")
      : undefined;
    const encryptedVerifier = codeVerifier
      ? this.vault.encrypt({ codeVerifier })
      : undefined;

    await this.database.client.oAuthState.create({
      data: {
        stateDigest: digestToken(state, this.config.sessionHashSecret),
        userId: input.principal.userId,
        workspaceId: input.workspaceId,
        provider: input.provider as never,
        sessionId: input.sessionId,
        ...(encryptedVerifier
          ? {
              codeVerifierCiphertext: encryptedVerifier.ciphertext,
              codeVerifierEncryptionVersion:
                encryptedVerifier.encryptionVersion,
            }
          : {}),
        ...(codeChallenge ? { codeChallenge } : {}),
        ...(input.connectionId ? { connectionId: input.connectionId } : {}),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    return {
      state,
      authorizationState:
        codeVerifier && codeChallenge ? { codeVerifier, codeChallenge } : {},
    };
  }

  public async consume(input: {
    state: string;
    expected: {
      principal?: HumanPrincipal;
      workspaceId?: string;
      provider: ProviderId;
    };
  }): Promise<ConsumedOAuthState> {
    const digest = digestToken(input.state, this.config.sessionHashSecret);
    const record = await this.database.client.oAuthState.findUnique({
      where: { stateDigest: digest },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        provider: true,
        sessionId: true,
        codeVerifierCiphertext: true,
        codeVerifierEncryptionVersion: true,
        expiresAt: true,
        consumedAt: true,
        connectionId: true,
      },
    });
    if (
      !record ||
      (input.expected.principal &&
        (record.userId !== input.expected.principal.userId ||
          record.sessionId !== input.expected.principal.sessionId)) ||
      (input.expected.workspaceId &&
        record.workspaceId !== input.expected.workspaceId) ||
      record.provider !== input.expected.provider ||
      record.consumedAt ||
      record.expiresAt <= new Date()
    ) {
      throw new ProviderError(
        "invalid_oauth_state",
        "OAuth state is invalid or expired.",
      );
    }

    const consumed = await this.database.client.oAuthState.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new ProviderError(
        "invalid_oauth_state",
        "OAuth state is invalid or expired.",
      );
    }

    let codeVerifier: string | undefined;
    if (record.codeVerifierCiphertext) {
      const payload = this.vault.decrypt<{ codeVerifier?: string }>(
        record.codeVerifierCiphertext,
        record.codeVerifierEncryptionVersion ??
          this.config.providerCredentialCurrentKeyVersion,
      );
      codeVerifier = payload.codeVerifier;
    }
    return {
      userId: record.userId,
      workspaceId: record.workspaceId,
      provider: record.provider as ProviderId,
      sessionId: record.sessionId,
      ...(codeVerifier ? { codeVerifier } : {}),
      connectionId: record.connectionId,
    };
  }
}
