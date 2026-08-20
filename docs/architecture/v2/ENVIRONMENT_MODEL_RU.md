# V2 environment model

| Environment | Config source              | Database            | Redis                | Deploy status          |
| ----------- | -------------------------- | ------------------- | -------------------- | ---------------------- |
| development | .env.v2 ignored by Git     | local v2 PostgreSQL | local v2 Redis       | local only             |
| test        | CI/test process env        | ephemeral/test DB   | ephemeral/test Redis | CI                     |
| staging     | future dedicated v2 env    | dedicated v2 DB     | dedicated v2 Redis   | not created in Phase 1 |
| production  | secret manager/runtime env | dedicated v2 DB     | dedicated v2 Redis   | not created in Phase 1 |

No environment inherits v1 secrets or storage. Production-like config rejects placeholder/local dependency URLs. The configuration package exposes parsed values only; credentials are not logged.
