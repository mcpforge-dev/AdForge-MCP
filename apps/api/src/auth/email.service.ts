import { Injectable } from "@nestjs/common";
import { createLogger } from "@holymedia/observability";

@Injectable()
export class EmailService {
  private readonly logger = createLogger("holymedia-mcp-v2-email");

  public async sendVerification(email: string, token: string): Promise<void> {
    await this.queue("email_verification", email, token);
  }

  public async sendPasswordReset(email: string, token: string): Promise<void> {
    await this.queue("password_reset", email, token);
  }

  public async sendInvitation(email: string, token: string): Promise<void> {
    await this.queue("workspace_invitation", email, token);
  }

  private async queue(
    kind: string,
    email: string,
    token: string,
  ): Promise<void> {
    void token;
    this.logger.info(
      { kind, recipientDomain: email.split("@")[1] ?? "unknown" },
      "email delivery queued",
    );
  }
}
