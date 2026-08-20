import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../infrastructure/database.service.js";

type AuditActorType = "HUMAN" | "SERVICE";

export type AuditInput = {
  eventType: string;
  success?: boolean;
  actorType?: AuditActorType;
  actorUserId?: string;
  workspaceId?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

@Injectable()
export class AuditService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public async record(input: AuditInput): Promise<void> {
    await this.database.client.auditEvent.create({
      data: {
        eventType: input.eventType,
        success: input.success ?? true,
        actorType: input.actorType ?? "HUMAN",
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.targetType ? { targetType: input.targetType } : {}),
        ...(input.targetId ? { targetId: input.targetId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  }
}
