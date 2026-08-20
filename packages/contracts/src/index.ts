export type ServiceStatus = "ok" | "degraded" | "not_ready";

export type HealthResponse = {
  status: "ok";
  service: string;
  version: string;
};

export type ReadinessResponse = {
  status: ServiceStatus;
  service: string;
  version: string;
  dependencies: Record<string, { status: ServiceStatus; latencyMs?: number }>;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};
